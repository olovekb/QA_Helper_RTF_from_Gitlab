import JSON5 from 'json5';
import config from './config.json' assert { type: 'json' };
import { callWithCloudRuFallback } from './cloudruClient.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const HARD_ITERATION_CAP = 8;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_TOKENS = 180000;
const MAX_TOOL_CALLS = 8;
const MAX_FETCH_CONTEXT_CALLS = 5;

/**
 * Универсальный цикл обработки tool-calling.
 *
 * @param {Object} params
 * @param {Array} params.initialMessages - начальные сообщения [{role, content}]
 * @param {Array} params.tools - описания инструментов для LLM (совместимые с OpenAI)
 * @param {Object} params.toolHandlers - обработчики инструментов { toolName: async (args) => any }
 * @param {Array<string>} [params.finalToolNames=[]] - инструменты, сигнализирующие о финальном ответе
 * @param {number} [params.maxIterations=12] - максимум итераций
 * @param {Object} [params.modelOptions={}] - дополнительные опции для callWithCloudRuFallback
 * @returns {Promise<{status: 'final-tool-call'|'assistant-message', toolName?: string, args?: any, message?: Object, response: Object, messages: Array}>}
 */
export async function runInteractiveLLM({
    initialMessages = [],
    tools = [],
    toolHandlers = {},
    finalToolNames = [],
    maxIterations = 12,
    modelOptions = {}
} = {}) {
    if (!Array.isArray(initialMessages) || !initialMessages.length) {
        throw new Error('runInteractiveLLM: initialMessages must be a non-empty array');
    }

    const conversation = [...initialMessages];
    const finalNames = Array.isArray(finalToolNames) ? finalToolNames : [];
    const iterationLimit = Math.min(maxIterations, HARD_ITERATION_CAP);
    const maxContextTokens = modelOptions?.maxContextTokens || MAX_CONTEXT_TOKENS;
    const maxToolCalls = modelOptions?.maxToolCalls || MAX_TOOL_CALLS;

    let fetchContextCallCount = 0;
    let totalToolCalls = 0;
    // ✅ Отслеживание повторяющихся вызовов fetch_context_chunk для защиты от зацикливания
    const fetchContextCallHistory = new Map(); // key: JSON.stringify(args) → count

    const estimateTokens = () => Math.ceil(JSON.stringify(conversation).length / APPROX_CHARS_PER_TOKEN);

    // ✅ Функция очистки истории: оставляет system prompt + последние N сообщений
    const compressHistory = (messages, keepLastN = 6) => {
        if (messages.length <= keepLastN + 1) {
            return messages; // Нечего сжимать
        }

        // Находим system prompt (обычно первое сообщение)
        const systemMessages = messages.filter(m => m.role === 'system');
        const nonSystemMessages = messages.filter(m => m.role !== 'system');

        // Оставляем последние N сообщений
        const recentMessages = nonSystemMessages.slice(-keepLastN);

        // Удаляем дубликаты ошибок от инструментов (если есть несколько одинаковых ошибок подряд)
        const deduplicated = [];
        let lastError = null;
        for (const msg of recentMessages) {
            if (msg.role === 'tool' && msg.content) {
                try {
                    const content = JSON.parse(msg.content);
                    if (content.error && content.error === lastError) {
                        continue; // Пропускаем дубликат ошибки
                    }
                    lastError = content.error || null;
                } catch {
                    // Не JSON, пропускаем проверку
                }
            } else {
                lastError = null; // Сбрасываем при не-ошибке
            }
            deduplicated.push(msg);
        }

        const compressed = [...systemMessages, ...deduplicated];
        const originalSize = messages.length;
        const compressedSize = compressed.length;
        
        if (compressedSize < originalSize) {
            console.log(`[interactiveLLM] 🗜️ Сжата история: ${originalSize} → ${compressedSize} сообщений (удалено ${originalSize - compressedSize})`);
        }

        return compressed;
    };

    const requestFinalAnswer = async (reason) => {
        if (reason) {
            console.warn(`[interactiveLLM] ⛔ ${reason}. Запрашиваю финальный ответ без инструментов.`);
            conversation.push({
                role: 'system',
                content: '⚠️ Достигнут лимит контекста/инструментов. Не используй tools. Верни финальный ответ строго в требуемом JSON-формате.'
            });
        }

        const finalResponse = await callWithCloudRuFallback(
            OPENROUTER_URL,
            conversation,
            config.openRouterAiKey,
            {
                tools: [],
                temperature: 0,
                ...modelOptions
            }
        );

        const finalMessage = finalResponse.choices?.[0]?.message || {};
        if (!finalMessage.role) {
            finalMessage.role = 'assistant';
        }
        conversation.push(finalMessage);

        return {
            status: 'assistant-message',
            message: finalMessage,
            response: finalResponse,
            messages: conversation
        };
    };

    for (let iteration = 0; iteration < iterationLimit; iteration++) {
        // ✅ Очистка истории перед каждой итерацией, если она слишком большая
        const estimatedTokens = estimateTokens();
        const TOKEN_THRESHOLD_FOR_COMPRESSION = Math.floor(maxContextTokens * 0.7); // 70% от лимита
        
        if (estimatedTokens > TOKEN_THRESHOLD_FOR_COMPRESSION && conversation.length > 8) {
            console.log(`[interactiveLLM] ⚠️ История большая (${estimatedTokens} токенов, ${conversation.length} сообщений), сжимаю...`);
            const compressed = compressHistory(conversation, 6); // Оставляем последние 6 сообщений
            conversation.length = 0;
            conversation.push(...compressed);
            console.log(`[interactiveLLM] ✅ После сжатия: ${estimateTokens()} токенов, ${conversation.length} сообщений`);
        }

        if (estimatedTokens >= maxContextTokens) {
            return await requestFinalAnswer(`Лимит контекста превышен (${estimatedTokens} токенов ≥ ${maxContextTokens})`);
        }

        console.log(`[interactiveLLM] 🔁 Итерация ${iteration + 1}/${iterationLimit}, messages=${conversation.length}, estimatedTokens=${estimatedTokens}, fetchContextCalls=${fetchContextCallCount}, toolCalls=${totalToolCalls}`);

        const response = await callWithCloudRuFallback(
            OPENROUTER_URL,
            conversation,
            config.openRouterAiKey,
            {
                tools,
                temperature: 0,
                ...modelOptions
            }
        );

        const assistantMessage = response.choices?.[0]?.message || {};
        if (!assistantMessage.role) {
            assistantMessage.role = 'assistant';
        }

        conversation.push(assistantMessage);

        const toolCalls = assistantMessage.tool_calls;

        if (Array.isArray(toolCalls) && toolCalls.length) {
            totalToolCalls += toolCalls.length;
            let finalCallPayload = null;

            for (const toolCall of toolCalls) {
                const toolName = toolCall?.function?.name;
                const rawArgs = toolCall?.function?.arguments;

                if (!toolName) {
                    console.warn('[interactiveLLM] ⚠️ Получен tool_call без имени функции');
                    continue;
                }

                if (finalNames.includes(toolName)) {
                    let parsedArgs = {};
                    try {
                        parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
                    } catch (err) {
                        console.warn(`[interactiveLLM] ⚠️ Не удалось распарсить аргументы final tool ${toolName}: ${err.message}`);
                        try {
                            parsedArgs = rawArgs ? JSON5.parse(rawArgs) : {};
                        } catch {
                            parsedArgs = {};
                        }
                    }

                    finalCallPayload = {
                        status: 'final-tool-call',
                        toolName,
                        args: parsedArgs,
                        response,
                        messages: conversation
                    };

                    // Не отправляем результат обратно модели, завершаем цикл
                    continue;
                }

                const handler = typeof toolHandlers[toolName] === 'function' ? toolHandlers[toolName] : null;
                let handlerArgs = {};

                if (rawArgs) {
                    try {
                        handlerArgs = JSON.parse(rawArgs);
                    } catch (err) {
                        try {
                            handlerArgs = JSON5.parse(rawArgs);
                        } catch (json5Err) {
                            console.warn(`[interactiveLLM] ⚠️ Не удалось распарсить аргументы для ${toolName}:`, json5Err.message);
                            handlerArgs = {};
                        }
                    }
                }

                if (!handler) {
                    console.warn(`[interactiveLLM] ⚠️ Обработчик для инструмента "${toolName}" не реализован`);
                    conversation.push({
                        role: 'tool',
                        name: toolName,
                        content: JSON.stringify({
                            error: `Tool "${toolName}" is not implemented on backend.`
                        })
                    });
                    continue;
                }

                try {
                    // Отслеживаем вызовы fetch_context_chunk
                    if (toolName === 'fetch_context_chunk') {
                        fetchContextCallCount++;
                        
                        // ✅ Защита от повторяющихся вызовов с одинаковыми параметрами
                        const callKey = JSON.stringify(handlerArgs);
                        const repeatCount = (fetchContextCallHistory.get(callKey) || 0) + 1;
                        fetchContextCallHistory.set(callKey, repeatCount);
                        
                        if (repeatCount >= 3) {
                            console.warn(`[interactiveLLM] ⚠️ Обнаружен повторный вызов fetch_context_chunk с теми же параметрами (${repeatCount} раз), прерываю зацикливание`);
                            conversation.push({
                                role: 'tool',
                                name: toolName,
                                content: JSON.stringify({
                                    error: `Этот контекст уже был запрошен ${repeatCount} раз. Используй уже полученный контекст из предыдущих ответов для генерации модели. НЕ запрашивай fetch_context_chunk повторно.`
                                })
                            });
                            continue;
                        }
                        
                        if (fetchContextCallCount > MAX_FETCH_CONTEXT_CALLS) {
                            console.warn(`[interactiveLLM] ⚠️ Превышен лимит вызовов fetch_context_chunk (${fetchContextCallCount} > ${MAX_FETCH_CONTEXT_CALLS}), возвращаем ошибку`);
                            conversation.push({
                                role: 'tool',
                                name: toolName,
                                content: JSON.stringify({
                                    error: `Превышен лимит вызовов fetch_context_chunk (${MAX_FETCH_CONTEXT_CALLS}). Используй уже полученный контекст для генерации модели.`
                                })
                            });
                            continue;
                        }
                    }
                    
                    const result = await handler(handlerArgs);
                    conversation.push({
                        role: 'tool',
                        name: toolName,
                        content: JSON.stringify(result == null ? {} : result)
                    });
                } catch (err) {
                    console.error(`[interactiveLLM] ❌ Ошибка в обработчике инструмента "${toolName}": ${err.message}`);
                    // ✅ Для повторяющихся ошибок не добавляем в историю, чтобы не раздувать её
                    const errorKey = `${toolName}:${err.message}`;
                    const errorCount = fetchContextCallHistory.get(errorKey) || 0;
                    
                    if (errorCount < 2) {
                        // Добавляем ошибку только первые 2 раза
                        fetchContextCallHistory.set(errorKey, errorCount + 1);
                        conversation.push({
                            role: 'tool',
                            name: toolName,
                            content: JSON.stringify({
                                error: err.message || 'Unhandled tool error'
                            })
                        });
                    } else {
                        // После 2 раз просто логируем, но не добавляем в историю
                        console.warn(`[interactiveLLM] ⚠️ Пропускаю повторяющуюся ошибку "${errorKey}" (уже ${errorCount + 1} раз), чтобы не раздувать историю`);
                    }
                }
            }

            if (finalCallPayload) {
                return finalCallPayload;
            }

            if (totalToolCalls >= maxToolCalls) {
                return await requestFinalAnswer(`Достигнут лимит tool_calls (${totalToolCalls} ≥ ${maxToolCalls})`);
            }

            // Если были tool_calls, продолжаем цикл: отправляем контекст назад модели
            continue;
        }

        // Нет tool_calls — значит модель вернула финальное сообщение
        return {
            status: 'assistant-message',
            message: assistantMessage,
            response,
            messages: conversation
        };
    }

    throw new Error(`runInteractiveLLM: превышено количество итераций (${iterationLimit}) без финального ответа`);
}



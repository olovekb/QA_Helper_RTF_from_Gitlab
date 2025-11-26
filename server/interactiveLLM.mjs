import JSON5 from 'json5';
import config from './config.json' assert { type: 'json' };
import { callWithCloudRuFallback } from './cloudruClient.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
    
    // 🚨 ЗАЩИТА ОТ ЗАЦИКЛИВАНИЯ: отслеживаем размер промпта и количество fetch_context_chunk
    const MAX_PROMPT_TOKENS = 200000; // Лимит входных токенов (оставляем запас для completion)
    const MAX_FETCH_CONTEXT_CALLS = 5; // Максимум вызовов fetch_context_chunk
    let fetchContextCallCount = 0;
    let toolsToUse = [...tools]; // Копия для модификации

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Оцениваем размер промпта (примерно 4 символа = 1 токен)
        const currentPromptSize = JSON.stringify(conversation).length;
        const estimatedPromptTokens = Math.ceil(currentPromptSize / 4);
        
        console.log(`[interactiveLLM] 🔁 Итерация ${iteration + 1}/${maxIterations}, messages=${conversation.length}, estimatedTokens=${estimatedPromptTokens}, fetchContextCalls=${fetchContextCallCount}`);
        
        // Если промпт слишком большой или слишком много fetch_context_chunk - отключаем его
        if (estimatedPromptTokens > MAX_PROMPT_TOKENS || fetchContextCallCount >= MAX_FETCH_CONTEXT_CALLS) {
            const hasFetchContext = toolsToUse.some(t => t.function?.name === 'fetch_context_chunk');
            if (hasFetchContext) {
                toolsToUse = toolsToUse.filter(t => t.function?.name !== 'fetch_context_chunk');
                console.warn(`[interactiveLLM] 🔒 Отключен fetch_context_chunk (estimatedTokens=${estimatedPromptTokens} > ${MAX_PROMPT_TOKENS} или calls=${fetchContextCallCount} >= ${MAX_FETCH_CONTEXT_CALLS})`);
            }
        }

        const response = await callWithCloudRuFallback(
            OPENROUTER_URL,
            conversation,
            config.openRouterAiKey,
            {
                tools: toolsToUse,
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
                    conversation.push({
                        role: 'tool',
                        name: toolName,
                        content: JSON.stringify({
                            error: err.message || 'Unhandled tool error'
                        })
                    });
                }
            }

            if (finalCallPayload) {
                return finalCallPayload;
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

    throw new Error(`runInteractiveLLM: превышено количество итераций (${maxIterations}) без финального ответа`);
}



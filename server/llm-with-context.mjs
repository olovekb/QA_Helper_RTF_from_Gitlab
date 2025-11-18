/**
 * Обёртка для вызова LLM с персистентным контекстом диалога
 * Решает проблему потери контекста между вызовами
 */

import { runInteractiveLLM } from './interactiveLLM.mjs';
import {
    getConversationContext,
    createConversationContext,
    addMessageToContext,
    addErrorToContext,
    clearErrors,
    compressContextIfNeeded,
    estimateTokenCount
} from './conversation-context.mjs';
import config from './config.json' assert { type: 'json' };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Вызвать LLM с персистентным контекстом диалога
 * @param {Object} options - Опции для вызова
 * @param {string} options.taskId - ID задачи (обязательно)
 * @param {string} options.userPrompt - Пользовательский промпт
 * @param {string} [options.systemPrompt] - Системный промпт (если контекст не существует, будет использован для инициализации)
 * @param {Array} [options.tools] - Инструменты для LLM
 * @param {Object} [options.toolHandlers] - Обработчики инструментов
 * @param {Array<string>} [options.finalToolNames] - Имена инструментов, сигнализирующих о финальном ответе
 * @param {Object} [options.modelOptions] - Опции модели
 * @param {number} [options.maxTokens=150000] - Максимальное количество токенов для сжатия контекста
 * @param {Function} [options.summarizeFn] - Функция для создания summary старых сообщений
 * @returns {Promise<Object>} - Результат вызова LLM с полной историей диалога
 */
export async function runTestCaseLLMWithContext(options = {}) {
    const {
        taskId,
        userPrompt,
        systemPrompt = null,
        tools = [],
        toolHandlers = {},
        finalToolNames = [],
        modelOptions = {},
        maxTokens = 150000,
        summarizeFn = null,
        responseFormat = null
    } = options;

    if (!taskId) {
        throw new Error('[llm-with-context] taskId обязателен для сохранения контекста');
    }

    if (!userPrompt || typeof userPrompt !== 'string') {
        throw new Error('[llm-with-context] userPrompt обязателен и должен быть строкой');
    }

    // Получаем существующий контекст или создаём новый
    let context = getConversationContext(taskId);

    if (!context) {
        if (!systemPrompt) {
            throw new Error('[llm-with-context] Если контекст не существует, необходимо указать systemPrompt для инициализации');
        }

        // Создаём новый контекст
        context = createConversationContext(taskId, {
            systemPrompt,
            metadata: {
                attemptNumber: 0,
                previousErrors: []
            }
        });
        
        console.log(`[llm-with-context] Создан новый контекст для taskId: ${taskId}`);
    } else {
        console.log(`[llm-with-context] Используется существующий контекст для taskId: ${taskId} (${context.messages.length} сообщений)`);
    }

    // Добавляем пользовательский промпт в историю
    addMessageToContext(taskId, 'user', userPrompt);

    // Проверяем размер контекста и сжимаем при необходимости
    await compressContextIfNeeded(taskId, maxTokens, summarizeFn);

    // Получаем обновлённый контекст (после сжатия)
    context = getConversationContext(taskId);

    // Подготавливаем сообщения для LLM (вся история!)
    const messagesForLLM = [...context.messages];

    console.log(`[llm-with-context] Вызов LLM с ${messagesForLLM.length} сообщениями (${estimateTokenCount(messagesForLLM)} токенов)`);

    try {
        // Вызываем LLM с полной историей диалога
        const result = await runInteractiveLLM({
            initialMessages: messagesForLLM,
            tools,
            toolHandlers,
            finalToolNames,
            maxIterations: modelOptions.maxIterations || 12,
            modelOptions: {
                models: config.cloudruModels,
                temperature: 0,
                max_tokens: 45000,
                ...modelOptions,
                ...(responseFormat ? { response_format: responseFormat } : {})
            }
        });

        // Извлекаем ответ ассистента
        let assistantContent = '';
        
        if (result.status === 'assistant-message' && result.message?.content) {
            assistantContent = result.message.content;
        } else if (result.status === 'final-tool-call' && result.toolName && result.args) {
            // Если ответ через tool, сериализуем аргументы
            assistantContent = JSON.stringify(result.args, null, 2);
        } else if (result.response?.choices?.[0]?.message?.content) {
            assistantContent = result.response.choices[0].message.content;
        }

        // Сохраняем ответ ассистента в историю
        if (assistantContent) {
            addMessageToContext(taskId, 'assistant', assistantContent);
            console.log(`[llm-with-context] Ответ LLM сохранён в контекст taskId: ${taskId}`);
        }

        // Возвращаем результат с информацией о контексте
        return {
            ...result,
            context: {
                taskId,
                messagesCount: context.messages.length,
                attemptNumber: context.metadata.attemptNumber,
                tokenCount: estimateTokenCount(context.messages)
            }
        };

    } catch (error) {
        // Записываем ошибку в контекст для следующей попытки
        addErrorToContext(taskId, error.message, userPrompt);
        console.error(`[llm-with-context] Ошибка вызова LLM для taskId: ${taskId}:`, error.message);
        throw error;
    }
}

/**
 * Валидация исправленных тест-кейсов перед применением
 * @param {Array} fixedCases - Исправленные тест-кейсы
 * @param {Array} originalCases - Исходные тест-кейсы
 * @returns {Object} - Результат валидации { valid: boolean, errors: [] }
 */
export function validateFixedCases(fixedCases, originalCases) {
    const validation = {
        valid: true,
        errors: []
    };

    if (!Array.isArray(fixedCases)) {
        validation.valid = false;
        validation.errors.push('fixedCases должен быть массивом');
        return validation;
    }

    // Проверяем, что все исходные ТК присутствуют (по id)
    const originalIds = new Set(originalCases.map(tc => tc.id));
    const fixedIds = new Set(fixedCases.map(tc => tc.id));

    // Проверяем, что все id сохранены
    for (const id of originalIds) {
        if (!fixedIds.has(id)) {
            validation.valid = false;
            validation.errors.push(`Тест-кейс с id="${id}" отсутствует в исправленном списке`);
        }
    }

    // Проверяем, что нет новых id
    for (const id of fixedIds) {
        if (!originalIds.has(id)) {
            validation.valid = false;
            validation.errors.push(`Обнаружен новый тест-кейс с id="${id}", которого не было в исходном списке`);
        }
    }

    // Проверяем обязательные поля
    for (const fixedCase of fixedCases) {
        if (!fixedCase.id) {
            validation.valid = false;
            validation.errors.push('Обнаружен тест-кейс без id');
        }
        if (!fixedCase.title) {
            validation.valid = false;
            validation.errors.push(`Тест-кейс с id="${fixedCase.id}" не имеет title`);
        }
        if (!fixedCase.feature) {
            validation.valid = false;
            validation.errors.push(`Тест-кейс с id="${fixedCase.id}" не имеет feature`);
        }
        if (!fixedCase.story) {
            validation.valid = false;
            validation.errors.push(`Тест-кейс с id="${fixedCase.id}" не имеет story`);
        }
    }

    return validation;
}


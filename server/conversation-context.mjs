/**
 * Модуль для управления персистентным контекстом диалогов с LLM
 * Решает проблему потери контекста между вызовами LLM
 */

/**
 * Хранилище истории диалогов для каждой задачи
 * taskId -> { messages: [], metadata: {} }
 */
const conversationStore = new Map();

/**
 * Хранилище снимков состояний для отката
 * taskId -> [{ timestamp, label, testCases, conversationLength }]
 */
const stateHistory = new Map();

/**
 * Получить контекст диалога для задачи
 * @param {string} taskId - ID задачи
 * @returns {Object|null} - Контекст диалога или null
 */
export function getConversationContext(taskId) {
    return conversationStore.get(taskId) || null;
}

/**
 * Создать новый контекст диалога для задачи
 * @param {string} taskId - ID задачи
 * @param {Object} options - Опции для инициализации
 * @param {string} options.systemPrompt - Системный промпт
 * @param {Object} options.metadata - Метаданные (modelStructure, requirements, projectId и т.д.)
 * @returns {Object} - Созданный контекст
 */
export function createConversationContext(taskId, { systemPrompt, metadata = {} }) {
    const context = {
        messages: [
            {
                role: "system",
                content: systemPrompt
            }
        ],
        metadata: {
            attemptNumber: 0,
            previousErrors: [],
            fixAttempts: [],
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            ...metadata
        }
    };

    conversationStore.set(taskId, context);
    console.log(`[conversation-context] Создан новый контекст для taskId: ${taskId}`);

    return context;
}

/**
 * Добавить сообщение в историю диалога
 * @param {string} taskId - ID задачи
 * @param {string} role - Роль сообщения ('user' или 'assistant')
 * @param {string} content - Содержимое сообщения
 * @returns {Object} - Обновленный контекст
 */
export function addMessageToContext(taskId, role, content) {
    const context = conversationStore.get(taskId);

    if (!context) {
        throw new Error(`[conversation-context] Контекст для taskId ${taskId} не найден. Сначала создайте контекст через createConversationContext().`);
    }

    context.messages.push({
        role,
        content
    });

    context.metadata.lastUpdated = new Date().toISOString();

    if (role === 'assistant') {
        context.metadata.attemptNumber++;
    }

    console.log(`[conversation-context] Добавлено сообщение ${role} в контекст taskId: ${taskId} (всего сообщений: ${context.messages.length})`);

    return context;
}

/**
 * Добавить ошибку в историю попыток
 * @param {string} taskId - ID задачи
 * @param {string} error - Описание ошибки
 * @param {string} [userRequest] - Запрос пользователя, который вызвал ошибку
 */
export function addErrorToContext(taskId, error, userRequest = null) {
    const context = conversationStore.get(taskId);

    if (!context) {
        console.warn(`[conversation-context] Контекст для taskId ${taskId} не найден, ошибка не будет сохранена`);
        return;
    }

    const errorEntry = {
        timestamp: new Date().toISOString(),
        error: String(error),
        ...(userRequest && { userRequest: String(userRequest) })
    };

    context.metadata.previousErrors.push(errorEntry);
    context.metadata.lastUpdated = new Date().toISOString();

    if (context.metadata.previousErrors.length > 10) {
        context.metadata.previousErrors.shift();
    }

    console.log(`[conversation-context] Добавлена ошибка в контекст taskId: ${taskId} (всего ошибок: ${context.metadata.previousErrors.length})`);
}

/**
 * Очистить историю ошибок
 * @param {string} taskId - ID задачи
 */
export function clearErrors(taskId) {
    const context = conversationStore.get(taskId);
    if (context) {
        context.metadata.previousErrors = [];
        console.log(`[conversation-context] Очищена история ошибок для taskId: ${taskId}`);
    }
}

/**
 * Сохранить снимок состояния
 * @param {string} taskId - ID задачи
 * @param {Array} testCases - Массив тест-кейсов для сохранения
 * @param {string} label - Метка снимка (например, 'after-generation', 'after-fix')
 */
export function saveStateSnapshot(taskId, testCases, label) {
    if (!stateHistory.has(taskId)) {
        stateHistory.set(taskId, []);
    }

    const context = conversationStore.get(taskId);
    const conversationLength = context ? context.messages.length : 0;

    const snapshot = {
        timestamp: Date.now(),
        label: String(label),
        testCases: JSON.parse(JSON.stringify(testCases)),
        conversationLength
    };

    stateHistory.get(taskId).push(snapshot);

    const history = stateHistory.get(taskId);
    if (history.length > 10) {
        history.shift();
    }

    console.log(`[conversation-context] Сохранён снимок состояния для taskId: ${taskId}, label: "${label}" (всего снимков: ${history.length})`);
}

/**
 * Откатить к предыдущему снимку состояния
 * @param {string} taskId - ID задачи
 * @param {number} snapshotIndex - Индекс снимка (по умолчанию -1, последний)
 * @returns {Object|null} - Восстановленное состояние или null
 */
export function rollbackToSnapshot(taskId, snapshotIndex = -1) {
    const history = stateHistory.get(taskId);

    if (!history || history.length === 0) {
        throw new Error(`[conversation-context] Нет снимков состояния для taskId: ${taskId}`);
    }

    const index = snapshotIndex >= 0 ? snapshotIndex : history.length + snapshotIndex;

    if (index < 0 || index >= history.length) {
        throw new Error(`[conversation-context] Невалидный индекс снимка: ${index} (всего снимков: ${history.length})`);
    }

    const snapshot = history[index];

    const restoredCases = JSON.parse(JSON.stringify(snapshot.testCases));

    const context = conversationStore.get(taskId);
    if (context) {
        context.messages = context.messages.slice(0, snapshot.conversationLength);
        context.metadata.lastUpdated = new Date().toISOString();
    }

    console.log(`[conversation-context] Откат к снимку для taskId: ${taskId}, label: "${snapshot.label}" (индекс: ${index})`);

    return {
        testCases: restoredCases,
        snapshot: snapshot,
        contextLength: snapshot.conversationLength
    };
}

/**
 * Получить список снимков состояния
 * @param {string} taskId - ID задачи
 * @returns {Array} - Массив снимков
 */
export function getStateSnapshots(taskId) {
    return stateHistory.get(taskId) || [];
}

/**
 * Оценить количество токенов в сообщениях
 * @param {Array} messages - Массив сообщений
 * @returns {number} - Примерное количество токенов
 */
export function estimateTokenCount(messages) {
    const text = messages.map(m => m.content || '').join(' ');
    return Math.ceil(text.length / 4);
}

/**
 * Сжать контекст при переполнении (сохранить system + последние N сообщений + summary старых)
 * @param {string} taskId - ID задачи
 * @param {number} maxTokens - Максимальное количество токенов (по умолчанию 100000)
 * @param {Function} summarizeFn - Функция для создания summary старых сообщений (опционально)
 * @returns {Promise<boolean>} - true если сжатие было выполнено
 */
export async function compressContextIfNeeded(taskId, maxTokens = 100000, summarizeFn = null) {
    const context = conversationStore.get(taskId);

    if (!context) {
        return false;
    }

    const estimatedTokens = estimateTokenCount(context.messages);
    const threshold = maxTokens * 0.8;

    if (estimatedTokens <= threshold) {
        return false;
    }

    console.log(`[conversation-context] Контекст приближается к лимиту: ${estimatedTokens}/${maxTokens} токенов. Выполняю сжатие...`);

    const systemMsg = context.messages[0];
    const recentMessages = context.messages.slice(-10);
    const oldMessages = context.messages.slice(1, -10);

    if (oldMessages.length === 0) {
        return false;
    }

    let summary = '';

    if (summarizeFn && typeof summarizeFn === 'function') {
        try {
            summary = await summarizeFn(oldMessages);
        } catch (err) {
            console.warn(`[conversation-context] Ошибка создания summary: ${err.message}, использую простое резюме`);
            summary = `[Сжато ${oldMessages.length} предыдущих сообщений из-за ограничения размера контекста. Основные моменты сохранены в последних сообщениях.]`;
        }
    } else {
        const userMessages = oldMessages.filter(m => m.role === 'user').map(m => m.content.substring(0, 200));
        const assistantMessages = oldMessages.filter(m => m.role === 'assistant').length;
        summary = `[Сжато ${oldMessages.length} предыдущих сообщений (${userMessages.length} запросов пользователя, ${assistantMessages} ответов LLM) из-за ограничения размера контекста. Сохранены последние 10 сообщений для продолжения диалога.]`;
    }

    context.messages = [
        systemMsg,
        {
            role: "system",
            content: `SUMMARY ПРЕДЫДУЩЕГО ДИАЛОГА (сжато для экономии контекста):\n\n${summary}`
        },
        ...recentMessages
    ];

    const newTokenCount = estimateTokenCount(context.messages);
    context.metadata.lastUpdated = new Date().toISOString();

    console.log(`[conversation-context] Контекст сжат: ${estimatedTokens} → ${newTokenCount} токенов (сжато ${oldMessages.length} сообщений)`);

    return true;
}

/**
 * Удалить контекст задачи (очистка после завершения)
 * @param {string} taskId - ID задачи
 */
export function deleteConversationContext(taskId) {
    conversationStore.delete(taskId);
    stateHistory.delete(taskId);
    console.log(`[conversation-context] Удалён контекст для taskId: ${taskId}`);
}

/**
 * Очистить старые контексты (старше указанного времени)
 * @param {number} maxAgeMs - Максимальный возраст в миллисекундах (по умолчанию 24 часа)
 */
export function cleanupOldContexts(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, context] of conversationStore.entries()) {
        const lastUpdated = new Date(context.metadata.lastUpdated).getTime();
        const age = now - lastUpdated;

        if (age > maxAgeMs) {
            conversationStore.delete(taskId);
            stateHistory.delete(taskId);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`[conversation-context] Очищено ${cleaned} старых контекстов (старше ${maxAgeMs / 1000 / 60 / 60} часов)`);
    }

    return cleaned;
}

/**
 * Получить статистику по контекстам
 * @returns {Object} - Статистика
 */
export function getContextStats() {
    const stats = {
        activeContexts: conversationStore.size,
        totalSnapshots: 0,
        totalMessages: 0,
        totalErrors: 0
    };

    for (const context of conversationStore.values()) {
        stats.totalMessages += context.messages.length;
        stats.totalErrors += context.metadata.previousErrors.length;
    }

    for (const snapshots of stateHistory.values()) {
        stats.totalSnapshots += snapshots.length;
    }

    return stats;
}

if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        cleanupOldContexts();
    }, 6 * 60 * 60 * 1000);
}


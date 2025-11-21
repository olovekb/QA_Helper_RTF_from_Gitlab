/**
 * Модульная система промптов для композиции системных промптов
 * Позволяет сократить размер промптов через переиспользование компонентов
 */

/**
 * Базовые модули промптов
 */
export const PROMPTS = {
    /**
     * Базовый промпт (короткий, ~500 символов)
     */
    base: `Ты — SDET (Software Development Engineer in Test), генерирующий тест-кейсы на основе requirements в формате Allure TestOps.

Твоя задача: создавать качественные тест-кейсы, строго следуя правилам стайл-гайда и используя только элементы из тестовой модели.`,

    /**
     * Правила валидации и структуры (~1500 символов)
     */
    rules: `
═══════════════════════════════════════════════════════════════
🚨 КРИТИЧЕСКИ ВАЖНО: ПРАВИЛА ВАЛИДАЦИИ
═══════════════════════════════════════════════════════════════

❌ ЗАПРЕЩЕНО:
- Создавать НОВЫЕ feature, story или scenario (используй ТОЛЬКО из модели!)
- Добавлять поле "requirement" в тест-кейсы (это поле только в модели!)
- Использовать плейсхолдеры {{Параметр}} в названии тест-кейса
- Использовать слово "Проверить" в steps (проверка = Expected Result)
- Создавать дубликаты — используй параметризацию!
- ❗❗❗ Создавать тест-кейсы с пустым массивом steps: [] — ЗАПРЕЩЕНО!

✅ ОБЯЗАТЕЛЬНО:
- Используй ТОЛЬКО элементы из enum в tool definition (feature, story, scenario, code)
- Для параметризации используй parameters + examples (не дубликаты!)
- Expected должен быть конкретным и в форме причастия прошедшего времени
- E2E тесты: только feature + story (БЕЗ scenario!)
- Integration тесты: feature + story + scenario (ОБЯЗАТЕЛЬНО scenario!)
- ❗❗❗ КАЖДЫЙ тест-кейс ДОЛЖЕН иметь минимум 3 детализированных шага в поле steps!
- ❌ ЗАПРЕЩЕНО: steps: [] или steps: ["Проверить функциональность"]
- ✅ ПРАВИЛЬНО: steps должны быть КОНКРЕТНЫМИ и ДЕТАЛИЗИРОВАННЫМИ (например, "Авторизоваться в системе", "Перейти в раздел 'Платежи'", "Нажать кнопку 'Создать платеж'")
`,

    /**
     * Правила для E2E тестов (~800 символов)
     */
    e2eRules: `
═══════════════════════════════════════════════════════════════
🎯 E2E TESTS (Black Box, уровень C1)
═══════════════════════════════════════════════════════════════

✅ ДОЛЖНЫ:
- Полный пользовательский путь (авторизация → действие → результат)
- Шаги начинаются с авторизации/навигации
- Проверяют ФОРМЫ и взаимодействие с ними
- Конкретные действия из requirements
- Тег "M" обязателен
- ❗❗❗ Минимум 3-5 детализированных шагов (например: "Авторизоваться в системе", "Перейти в раздел 'Платежи'", "Нажать кнопку 'Создать платеж'", "Заполнить поле 'Сумма' значением '1000.00'", "Нажать кнопку 'Отправить'")

❌ НЕ ДОЛЖНЫ:
- Содержать scenario поле
- Содержать технические детали (HTTP, API, статус-коды)
- Называться "Полный цикл..." или "E2E: ..."
- Иметь технические precondition'ы ("Сервер доступен")
- ❗❗❗ Иметь пустой массив steps: [] — ЗАПРЕЩЕНО!
- ❗❗❗ Иметь менее 3 шагов — недостаточно для E2E теста!
`,

    /**
     * Правила для Integration тестов (~800 символов)
     */
    integrationRules: `
═══════════════════════════════════════════════════════════════
🎯 INTEGRATION TESTS (White Box, уровень C3)
═══════════════════════════════════════════════════════════════

✅ ДОЛЖНЫ:
- Атомарная проверка компонента/API
- Шаги начинаются сразу с действия (БЕЗ авторизации)
- Содержать scenario поле (ОБЯЗАТЕЛЬНО!)
- Frontend: тег "M" обязателен
- Backend: может быть технический precondition
- ❗❗❗ Минимум 1-2 детализированных шага (для Integration может быть меньше, но шаги должны быть конкретными!)
- ❌ ЗАПРЕЩЕНО: steps: [] — даже для Integration тестов нужен хотя бы 1 шаг!

❌ НЕ ДОЛЖНЫ:
- Содержать полный пользовательский путь
- Frontend: содержать API-запросы явно
- Backend: содержать UI-действия
- ❗❗❗ Иметь пустой массив steps: [] — ЗАПРЕЩЕНО!
`,

    /**
     * Техники тест-дизайна (обязательно к применению)
     */
    testDesign: `
═══════════════════════════════════════════════════════════════
🧠 ТЕХНИКИ ТЕСТ-ДИЗАЙНА (ОБЯЗАТЕЛЬНО К ПРИМЕНЕНИЮ)
═══════════════════════════════════════════════════════════════

Ты — злобный QA, который хочет сломать систему. Happy Path недостаточно.

Для каждой Story примени следующие техники:

1. **Граничные значения (Boundary Values):**
   - Если есть диапазон (сумма, длина), создай тесты для: Min-1, Min, Max, Max+1.
   - Пример: Лимит 1 млн. Тесты: 1 000 000 (ОК), 1 000 000.01 (Ошибка).
   - Для Integration frontend: тесты на валидацию граничных значений в UI.
   - Для Integration backend: тесты на обработку граничных значений API.

2. **Классы эквивалентности (Equivalence Partitioning):**
   - Пустые значения там, где они запрещены.
   - Спецсимволы, пробелы, emoji в текстовых полях.
   - Нули и отрицательные числа в суммах.
   - Невалидные форматы (email без @, дата в неправильном формате).

3. **Таблица состояний (State Transition):**
   - Как ведет себя UI, если API вернул пустой список? (Скелетная загрузка, Алерт)
   - Что если API вернул ошибку 500?
   - Что если API вернул только 1 элемент (автозаполнение)?
   - Что если API вернул null или undefined?

4. **Зависимости полей:**
   - Переключение свитчеров/чекбоксов. Проверь, что поля появляются/исчезают и очищаются.
   - Если выбран чекбокс А, то поле Б становится обязательным.
   - Если поле А заполнено, то поле Б становится доступным.

5. **Негативные сценарии (ОБЯЗАТЕЛЬНО!):**
   - Для каждого поля с валидацией создай Integration frontend тест на нарушение.
   - Для каждого API создай Integration backend тест на ошибки (400, 500, таймаут).
   - Для каждой логики "Если... то... иначе..." создай тест на ветку "Иначе".

🚨 КРИТИЧНО: Негативные тесты — это ОСНОВНОЙ упор! Happy Path — только 1-2 E2E теста.
   Основная бизнес-логика должна быть покрыта Integration тестами (frontend + backend)!

🎯 ПРИОРИТЕТЫ:
   - 1-2 E2E теста на Story (позитивный + 1 негативный)
   - 8-12 Integration тестов на Scenario (основной упор на негативные и граничные значения)
   - Для форм с валидацией: ОБЯЗАТЕЛЬНО тесты на нарушение валидации
   - Для UI логики (скрытие/очистка): ОБЯЗАТЕЛЬНО тесты на проверку этой логики
`,

    /**
     * Контекст требований (динамический)
     */
    requirements: (reqs) => {
        if (!reqs || typeof reqs !== 'string' || !reqs.trim()) {
            return '';
        }
        const truncated = reqs.length > 5000 ? reqs.substring(0, 5000) + '...' : reqs;
        return `
═══════════════════════════════════════════════════════════════
📋 ТРЕБОВАНИЯ
═══════════════════════════════════════════════════════════════

${truncated}
`;
    },

    /**
     * Идеальные примеры (динамический, few-shot learning)
     */
    examples: (examples) => {
        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return '';
        }

        const examplesByLayer = {
            e2e: examples.filter(ex => ex.layer === 'E2E Tests'),
            integration_fe: examples.filter(ex => ex.layer === 'Integration frontend Tests'),
            integration_be: examples.filter(ex => ex.layer === 'Integration backend Tests')
        };

        let section = `
═══════════════════════════════════════════════════════════════
⭐ ИДЕАЛЬНЫЕ ПРИМЕРЫ (ИСПОЛЬЗУЙ КАК ЭТАЛОН!)
═══════════════════════════════════════════════════════════════

🚨 ВАЖНО: Эти примеры созданы QA и проверены — они показывают ИДЕАЛЬНЫЙ формат тест-кейсов!
При генерации СТРОГО следуй формату из этих примеров!

`;

        if (examplesByLayer.e2e.length > 0) {
            section += `\n## E2E ТЕСТЫ (${examplesByLayer.e2e.length} пример${examplesByLayer.e2e.length > 1 ? 'а' : ''})\n\n`;
            examplesByLayer.e2e.slice(0, 2).forEach((ex, i) => {
                section += `### Пример ${i + 1}: ${ex.title}\n\n`;
                section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
            });
        }

        if (examplesByLayer.integration_fe.length > 0) {
            section += `\n## INTEGRATION FRONTEND (${examplesByLayer.integration_fe.length} пример${examplesByLayer.integration_fe.length > 1 ? 'а' : ''})\n\n`;
            examplesByLayer.integration_fe.slice(0, 2).forEach((ex, i) => {
                section += `### Пример ${i + 1}: ${ex.title}\n\n`;
                section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
            });
        }

        if (examplesByLayer.integration_be.length > 0) {
            section += `\n## INTEGRATION BACKEND (${examplesByLayer.integration_be.length} пример${examplesByLayer.integration_be.length > 1 ? 'а' : ''})\n\n`;
            examplesByLayer.integration_be.slice(0, 2).forEach((ex, i) => {
                section += `### Пример ${i + 1}: ${ex.title}\n\n`;
                section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
            });
        }

        section += `\n🚨 КРИТИЧЕСКИ ВАЖНО: Твои тест-кейсы должны быть ТОЧНО в таком же формате!`;
        
        return section;
    },

    /**
     * История ошибок из предыдущих попыток (динамический)
     */
    errors: (errorHistory) => {
        if (!errorHistory || !Array.isArray(errorHistory) || errorHistory.length === 0) {
            return '';
        }

        const recentErrors = errorHistory.slice(-5); // Последние 5 ошибок

        return `
═══════════════════════════════════════════════════════════════
⚠️ ОШИБКИ ИЗ ПРЕДЫДУЩИХ ПОПЫТОК (НЕ ПОВТОРЯЙ!)
═══════════════════════════════════════════════════════════════

${recentErrors.map((err, i) => `${i + 1}. ${err.error}${err.userRequest ? ` (запрос: "${err.userRequest.substring(0, 100)}...")` : ''}`).join('\n')}

❗ КРИТИЧЕСКИ ВАЖНО: Убедись, что не повторяешь эти ошибки!
`;
    },

    /**
     * Режим исправления тест-кейсов (для fixTestCasesAsync)
     */
    fixMode: `
═══════════════════════════════════════════════════════════════
🔧 РЕЖИМ ИСПРАВЛЕНИЯ ТЕСТ-КЕЙСОВ
═══════════════════════════════════════════════════════════════

🚨🚨🚨 КРИТИЧЕСКИ ВАЖНО — ЧИТАЙ ВНИМАТЕЛЬНО! 🚨🚨🚨

Ты — РОБОТ-ПРОЦЕССОР JSON. Твоя задача — применить ТОЛЬКО указанные изменения к полям тест-кейсов.
Любое изменение, не описанное явно в промпте пользователя, является КРИТИЧЕСКОЙ ОШИБКОЙ.
Не рассуждай, не улучшай, не переписывай — выполняй инструкции буквально.

❌ ЗАПРЕЩЕНО делать агрессивные правки:
- НЕ меняй поля, которые НЕ указаны в промпте пользователя!
- НЕ переписывай шаги, если они не требуют изменений!
- НЕ меняй expected, если он корректен!
- НЕ меняй структуру (feature, story, scenario), если она правильная!
- НЕ удаляй параметры и примеры, если они не упомянуты в промпте!

✅ ДОЗВОЛЕНО исправлять ТОЛЬКО:
- То, что явно указано в промпте пользователя
- Те поля, которые требуют исправления согласно промпту

✅ ОБЯЗАТЕЛЬНО сохранять БЕЗ ИЗМЕНЕНИЙ:
- id тест-кейса (КРИТИЧНО!)
- feature, story (если не требуется изменение)
- steps (если не требуют изменений согласно промпту)
- expected (если корректен)
- parameters, examples (если не упомянуты в промпте)
- tags (кроме случаев, когда требуется добавить/изменить)
- priority, version, links, jiraIssue
`
};

/**
 * Построить системный промпт на основе модулей
 * @param {Object} options - Опции для построения
 * @param {string} options.mode - Режим: 'generation' или 'fix'
 * @param {string} [options.requirements] - Требования (динамический)
 * @param {Array} [options.examples] - Идеальные примеры (динамический)
 * @param {Array} [options.errorHistory] - История ошибок (динамический)
 * @param {boolean} [options.includeE2ERules=true] - Включить правила E2E
 * @param {boolean} [options.includeIntegrationRules=true] - Включить правила Integration
 * @param {boolean} [options.includeTestDesign=true] - Включить техники тест-дизайна
 * @param {string} [options.logicConstraints] - Форматированные ограничения логики (из logic-extractor)
 * @returns {string} - Скомпилированный системный промпт
 */
export function buildSystemPrompt(options = {}) {
    const {
        mode = 'generation',
        requirements = null,
        examples = null,
        errorHistory = null,
        includeE2ERules = true,
        includeIntegrationRules = true,
        includeTestDesign = true,
        logicConstraints = null
    } = options;

    const parts = [PROMPTS.base, PROMPTS.rules];

    if (mode === 'fix') {
        parts.push(PROMPTS.fixMode);
    }

    if (includeE2ERules) {
        parts.push(PROMPTS.e2eRules);
    }

    if (includeIntegrationRules) {
        parts.push(PROMPTS.integrationRules);
    }

    if (includeTestDesign && mode === 'generation') {
        parts.push(PROMPTS.testDesign);
    }

    if (logicConstraints) {
        parts.push(logicConstraints);
    }

    if (requirements) {
        const reqSection = PROMPTS.requirements(requirements);
        if (reqSection) {
            parts.push(reqSection);
        }
    }

    if (examples && examples.length > 0) {
        const examplesSection = PROMPTS.examples(examples);
        if (examplesSection) {
            parts.push(examplesSection);
        }
    }

    if (errorHistory && errorHistory.length > 0) {
        const errorsSection = PROMPTS.errors(errorHistory);
        if (errorsSection) {
            parts.push(errorsSection);
        }
    }

    return parts.join('\n\n');
}

/**
 * Добавить идеальные примеры в messages как few-shot learning (user → assistant пары)
 * @param {Array} messages - Массив сообщений для дополнения
 * @param {Array} perfectExamples - Массив идеальных примеров
 * @param {number} maxExamples - Максимальное количество примеров каждого типа (по умолчанию 2)
 * @returns {Array} - Обновленный массив сообщений с few-shot примерами
 */
export function addPerfectExamplesAsFewShot(messages, perfectExamples, maxExamples = 2) {
    if (!perfectExamples || !Array.isArray(perfectExamples) || perfectExamples.length === 0) {
        return messages;
    }

    const examplesByLayer = {
        e2e: perfectExamples.filter(ex => ex.layer === 'E2E Tests').slice(0, maxExamples),
        integration_fe: perfectExamples.filter(ex => ex.layer === 'Integration frontend Tests').slice(0, maxExamples),
        integration_be: perfectExamples.filter(ex => ex.layer === 'Integration backend Tests').slice(0, maxExamples)
    };

    const newMessages = [...messages];

    // Добавляем E2E примеры как few-shot
    for (const example of examplesByLayer.e2e) {
        newMessages.push({
            role: "user",
            content: `Сгенерируй E2E тест-кейс для feature="${example.feature}", story="${example.story}"`
        });
        newMessages.push({
            role: "assistant",
            content: JSON.stringify(example, null, 2)
        });
    }

    // Добавляем Integration frontend примеры
    for (const example of examplesByLayer.integration_fe) {
        newMessages.push({
            role: "user",
            content: `Сгенерируй Integration frontend тест-кейс для feature="${example.feature}", story="${example.story}", scenario="${example.scenario}"`
        });
        newMessages.push({
            role: "assistant",
            content: JSON.stringify(example, null, 2)
        });
    }

    // Добавляем Integration backend примеры
    for (const example of examplesByLayer.integration_be) {
        newMessages.push({
            role: "user",
            content: `Сгенерируй Integration backend тест-кейс для feature="${example.feature}", story="${example.story}", scenario="${example.scenario}"`
        });
        newMessages.push({
            role: "assistant",
            content: JSON.stringify(example, null, 2)
        });
    }

    console.log(`[prompt-composer] Добавлено ${examplesByLayer.e2e.length + examplesByLayer.integration_fe.length + examplesByLayer.integration_be.length} few-shot примеров в messages`);

    return newMessages;
}


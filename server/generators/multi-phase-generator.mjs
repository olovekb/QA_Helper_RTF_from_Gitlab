/**
 * Многофазный генератор тест-кейсов
 * Разделяет генерацию на отдельные фазы для каждого слоя
 * Это улучшает качество и уменьшает размер контекста
 */

// ═══════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ ФАЗ
// ═══════════════════════════════════════════════════════════════

export const PHASES = {
    E2E: {
        name: 'E2E Tests',
        order: 1,
        description: 'Генерация E2E тестов (полный путь пользователя)',
        contextRequired: ['testModel', 'requirements', 'sharedSteps'],
        maxTokens: 8000,
        temperature: 0
    },
    INTEGRATION_FRONTEND: {
        name: 'Integration Frontend Tests',
        order: 2,
        description: 'Генерация Integration Frontend тестов (атомарные UI проверки)',
        contextRequired: ['testModel', 'requirements', 'e2eTests'],
        maxTokens: 12000,
        temperature: 0
    },
    INTEGRATION_BACKEND: {
        name: 'Integration Backend Tests',
        order: 3,
        description: 'Генерация Integration Backend тестов (API проверки)',
        contextRequired: ['testModel', 'requirements', 'apiSpec'],
        maxTokens: 10000,
        temperature: 0
    },
    UNIT_FRONTEND: {
        name: 'Unit Frontend Tests',
        order: 4,
        description: 'Генерация Unit Frontend тестов (заглушки для каждого Code)',
        contextRequired: ['testModel'],
        maxTokens: 5000,
        temperature: 0
    }
};

// ═══════════════════════════════════════════════════════════════
// ПРОМПТЫ ДЛЯ КАЖДОЙ ФАЗЫ
// ═══════════════════════════════════════════════════════════════

export function buildPhasePrompt(phase, context) {
    const basePrompt = `
Ты — Senior SDET, генерирующий ${phase.name} тесты.

═══════════════════════════════════════════════════════════════
🎯 ЗАДАЧА ЭТОЙ ФАЗЫ: ${phase.description}
═══════════════════════════════════════════════════════════════

`;

    switch (phase.name) {
        case 'E2E Tests':
            return basePrompt + buildE2EPrompt(context);
        case 'Integration Frontend Tests':
            return basePrompt + buildIntegrationFrontendPrompt(context);
        case 'Integration Backend Tests':
            return basePrompt + buildIntegrationBackendPrompt(context);
        case 'Unit Frontend Tests':
            return basePrompt + buildUnitFrontendPrompt(context);
        default:
            return basePrompt;
    }
}

// ═══════════════════════════════════════════════════════════════
// E2E ПРОМПТ
// ═══════════════════════════════════════════════════════════════

function buildE2EPrompt(context) {
    return `
ПРАВИЛА E2E ТЕСТОВ:

1. **Полный путь пользователя:** от входа до результата
2. **Минимум 3 шага:** авторизация → навигация → действие → результат
3. **БЕЗ HTTP-методов:** это UI тесты, а не API!
4. **Начинается с shared step "Авторизоваться в системе"** (если он есть в доступных)
5. **Обязательные поля:**
   - id: "tc-e2e-XXX"
   - layer: "E2E Tests"
   - priority: "High"
   - precondition: "Пользователь не авторизован"
   - expected: "**Отображается** ..."
   - tags: ["M"], ["D"] или ["PWA"]
   - version: "stable"
   - scenario: ОТСУТСТВУЕТ (null)
   - code: ОТСУТСТВУЕТ (null)

ДОСТУПНЫЕ SHARED STEPS:
${formatSharedSteps(context.sharedSteps)}

ТЕСТОВАЯ МОДЕЛЬ:
${formatTestModel(context.testModel, 'E2E')}

Сгенерируй 1-2 E2E теста на каждую Story.
Верни ТОЛЬКО JSON массив тест-кейсов.
`;
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATION FRONTEND ПРОМПТ
// ═══════════════════════════════════════════════════════════════

function buildIntegrationFrontendPrompt(context) {
    return `
ПРАВИЛА INTEGRATION FRONTEND ТЕСТОВ:

1. **Атомарные UI проверки:** один Scenario = один тест
2. **Обязательно указывать scenario** из модели
3. **БЕЗ HTTP-методов:** это UI тесты!
4. **Максимум 5 шагов:** компактные и понятные тесты
5. **Обязательные поля:**
   - id: "tc-if-XXX"
   - layer: "Integration frontend Tests"
   - scenario: "номер + текст" из модели
   - priority: "Medium"
   - precondition: "Пользователь авторизован"
   - expected: "**Отображается**" или "**Скрывается**"
   - tags: ["D"]
   - version: "stable"
   - code: ОТСУТСТВУЕТ (null)

ТЕСТОВАЯ МОДЕЛЬ:
${formatTestModel(context.testModel, 'Integration Frontend')}

УЖЕ СГЕНЕРИРОВАННЫЕ E2E (для избегания дублирования):
${formatExistingTests(context.e2eTests)}

Сгенерируй 2-3 Integration Frontend теста на каждый Scenario.
Верни ТОЛЬКО JSON массив тест-кейсов.
`;
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATION BACKEND ПРОМПТ
// ═══════════════════════════════════════════════════════════════

function buildIntegrationBackendPrompt(context) {
    return `
ПРАВИЛА INTEGRATION BACKEND ТЕСТОВ:

1. **API проверки:** каждый Code с type="backend" = минимум 1 тест
2. **Обязательно указывать scenario** из модели
3. **Шаги начинаются с "Выполнить GET/POST **/api/...**"**
4. **Максимум 3 шага:** атомарные API вызовы
5. **Обязательные поля:**
   - id: "tc-ib-XXX"
   - layer: "Integration backend Tests"
   - scenario: "номер + текст" из модели
   - code: ID code из модели (опционально)
   - priority: "Medium" или "High"
   - precondition: "Сервер доступен"
   - expected: "**Возвращается** {код ответа} ..."
   - tags: ["A"]
   - version: "stable"

API СПЕЦИФИКАЦИЯ (СТРОГО СЛЕДУЙ!):
${formatAPISpec(context.apiSpec)}

ТЕСТОВАЯ МОДЕЛЬ:
${formatTestModel(context.testModel, 'Integration Backend')}

Сгенерируй 2-3 Integration Backend теста на каждый Code с type="backend".
Верни ТОЛЬКО JSON массив тест-кейсов.
`;
}

// ═══════════════════════════════════════════════════════════════
// UNIT FRONTEND ПРОМПТ
// ═══════════════════════════════════════════════════════════════

function buildUnitFrontendPrompt(context) {
    return `
ПРАВИЛА UNIT FRONTEND ТЕСТОВ:

1. **1 тест-заглушка на КАЖДЫЙ Code с type="frontend"**
2. **Обязательные поля:**
   - id: "tc-uf-XXX"
   - layer: "Unit frontend Tests"
   - title: "Unit: {название code}"
   - scenario: текст Scenario из модели
   - code: ID code из модели (ОБЯЗАТЕЛЬНО!)
   - steps: ["Вызвать компонент/функцию ..."]
   - expected: "**Выполнено** без ошибок"
   - tags: ["D", "U"]
   - version: "stable"
   - priority: "Medium"
   - precondition: "Компонент инициализирован"

ТЕСТОВАЯ МОДЕЛЬ (только frontend codes):
${formatTestModelFrontendCodes(context.testModel)}

Сгенерируй РОВНО 1 Unit тест на КАЖДЫЙ frontend Code из списка выше.
Верни ТОЛЬКО JSON массив тест-кейсов.
`;
}

// ═══════════════════════════════════════════════════════════════
// ФОРМАТИРОВАНИЕ КОНТЕКСТА
// ═══════════════════════════════════════════════════════════════

function formatSharedSteps(sharedSteps) {
    if (!sharedSteps || sharedSteps.length === 0) {
        return 'Нет доступных shared steps.';
    }
    return sharedSteps.map(ss => `- [${ss.id}] ${ss.name}`).join('\n');
}

function formatTestModel(testModel, filterFor) {
    if (!testModel || testModel.length === 0) {
        return 'Модель пуста.';
    }

    let output = '';
    for (const feature of testModel) {
        output += `\nFeature: ${feature.text}\n`;
        for (const story of feature.stories || []) {
            output += `  Story: ${story.text}\n`;
            for (const scenario of story.scenarios || []) {
                output += `    Scenario: ${scenario.text}\n`;
                
                if (filterFor === 'Integration Backend') {
                    // Показываем только backend коды
                    const backendCodes = (scenario.codes || []).filter(c => c.type === 'backend');
                    if (backendCodes.length > 0) {
                        output += `      Backend Codes:\n`;
                        backendCodes.forEach(c => {
                            output += `        - [${c.id}] ${c.text}\n`;
                        });
                    }
                } else {
                    // Показываем все коды
                    (scenario.codes || []).forEach(c => {
                        output += `      Code (${c.type}): ${c.text}\n`;
                    });
                }
            }
        }
    }
    return output;
}

function formatTestModelFrontendCodes(testModel) {
    if (!testModel || testModel.length === 0) {
        return 'Модель пуста.';
    }

    let output = '';
    let counter = 1;
    
    for (const feature of testModel) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                const frontendCodes = (scenario.codes || []).filter(c => c.type === 'frontend');
                
                if (frontendCodes.length > 0) {
                    output += `\nScenario: ${scenario.text}\n`;
                    frontendCodes.forEach(c => {
                        output += `  ${counter}. [${c.id}] ${c.text}\n`;
                        counter++;
                    });
                }
            }
        }
    }
    
    return output || 'Нет frontend кодов.';
}

function formatAPISpec(apiSpec) {
    if (!apiSpec || !apiSpec.endpoints || apiSpec.endpoints.length === 0) {
        return 'API спецификация отсутствует.';
    }

    let output = '';
    for (const endpoint of apiSpec.endpoints) {
        output += `${endpoint.method} **${endpoint.url}**\n`;
        if (endpoint.parameters && endpoint.parameters.length > 0) {
            output += `  Параметры: ${endpoint.parameters.map(p => `${p.name} (${p.type})`).join(', ')}\n`;
        }
        if (endpoint.responses && endpoint.responses.length > 0) {
            endpoint.responses.forEach(r => {
                output += `  → ${r.statusCode}: ${JSON.stringify(r.body)}\n`;
            });
        }
        output += '\n';
    }
    return output;
}

function formatExistingTests(tests) {
    if (!tests || tests.length === 0) {
        return 'Нет уже сгенерированных тестов.';
    }
    return tests.map(t => `- ${t.title}`).join('\n');
}

// ═══════════════════════════════════════════════════════════════
// ПЛАНИРОВАНИЕ ФАЗ
// ═══════════════════════════════════════════════════════════════

/**
 * Планирует очерёдность выполнения фаз
 * @param {object} context - Контекст (testModel, requirements, apiSpec)
 * @returns {object[]} Массив фаз для выполнения
 */
export function planPhases(context) {
    const phases = [];

    // Фаза 1: E2E (всегда первая)
    phases.push({
        ...PHASES.E2E,
        context: {
            testModel: context.testModel,
            requirements: context.requirements,
            sharedSteps: context.sharedSteps || []
        }
    });

    // Фаза 2: Integration Frontend
    phases.push({
        ...PHASES.INTEGRATION_FRONTEND,
        context: {
            testModel: context.testModel,
            requirements: context.requirements,
            e2eTests: [] // Будет заполнено после фазы 1
        }
    });

    // Фаза 3: Integration Backend
    phases.push({
        ...PHASES.INTEGRATION_BACKEND,
        context: {
            testModel: context.testModel,
            requirements: context.requirements,
            apiSpec: context.apiSpec || { endpoints: [] }
        }
    });

    // Фаза 4: Unit Frontend
    phases.push({
        ...PHASES.UNIT_FRONTEND,
        context: {
            testModel: context.testModel
        }
    });

    console.log(`[planPhases] Запланировано ${phases.length} фаз генерации`);
    return phases;
}

/**
 * Обновляет контекст фазы на основе результатов предыдущих фаз
 * @param {object[]} phases - Массив фаз
 * @param {number} currentPhaseIndex - Индекс текущей фазы
 * @param {object[]} previousResults - Результаты предыдущих фаз
 */
export function updatePhaseContext(phases, currentPhaseIndex, previousResults) {
    if (currentPhaseIndex === 1 && previousResults.length > 0) {
        // Фаза 2: добавляем E2E тесты в контекст
        phases[currentPhaseIndex].context.e2eTests = previousResults[0] || [];
    }
}


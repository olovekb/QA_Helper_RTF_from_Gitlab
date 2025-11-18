/**
 * Жёсткие JSON Schema для валидации тест-кейсов по слоям
 * Используется для строгой проверки структуры перед сохранением
 */

// ═══════════════════════════════════════════════════════════════
// БАЗОВАЯ СХЕМА (общая для всех тестов)
// ═══════════════════════════════════════════════════════════════

const BASE_TEST_SCHEMA = {
    type: "object",
    required: ["id", "title", "layer", "steps", "expected", "feature", "story", "tags", "version", "priority"],
    properties: {
        id: {
            type: "string",
            pattern: "^(tc-(e2e|if|ib|uf)-\\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$",
            description: "UUID или tc-{layer}-{number}"
        },
        title: {
            type: "string",
            minLength: 10,
            maxLength: 200,
            description: "Название тест-кейса"
        },
        steps: {
            type: "array",
            minItems: 1,
            items: {
                oneOf: [
                    { type: "string", minLength: 5 },
                    {
                        type: "object",
                        required: ["sharedStepId"],
                        properties: {
                            sharedStepId: { type: "number" }
                        }
                    }
                ]
            },
            description: "Шаги теста (строки или shared steps)"
        },
        expected: {
            type: "string",
            pattern: "^\\*\\*(Отображается|Возвращается|Скрывается|Создан|Удалён|Обновлён|Выполнено)\\*\\*",
            minLength: 10,
            description: "Ожидаемый результат (ОБЯЗАТЕЛЬНО с жирным ключевым словом)"
        },
        layer: {
            type: "string",
            enum: ["E2E Tests", "Integration frontend Tests", "Integration backend Tests", "Unit frontend Tests"],
            description: "Слой тестирования"
        },
        feature: {
            type: "string",
            minLength: 5,
            description: "Название Feature"
        },
        story: {
            type: "string",
            minLength: 5,
            description: "Название Story"
        },
        tags: {
            type: "array",
            minItems: 1,
            items: {
                type: "string",
                enum: ["M", "D", "A", "S", "U", "PWA"]
            },
            description: "Теги окружения (M=Mobile, D=Desktop, A=Automation, S=Smoke, U=Unit, PWA)"
        },
        version: {
            type: "string",
            enum: ["stable", "canary", "beta"],
            description: "Версия функциональности"
        },
        priority: {
            type: "string",
            enum: ["High", "Medium", "Low"],
            description: "Приоритет тест-кейса"
        },
        precondition: {
            type: "string",
            description: "Предусловия для выполнения теста"
        },
        links: {
            type: "array",
            items: { type: "string" },
            default: []
        },
        parameters: {
            type: "array",
            default: []
        },
        examples: {
            type: "array",
            default: []
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// E2E ТЕСТЫ - Строгая схема
// ═══════════════════════════════════════════════════════════════

export const E2E_TEST_SCHEMA = {
    ...BASE_TEST_SCHEMA,
    properties: {
        ...BASE_TEST_SCHEMA.properties,
        layer: {
            type: "string",
            const: "E2E Tests"
        },
        steps: {
            type: "array",
            minItems: 3, // E2E должен иметь минимум 3 шага (авторизация + навигация + действие)
            items: {
                oneOf: [
                    { 
                        type: "string", 
                        minLength: 5,
                        not: {
                            pattern: "Выполнить (GET|POST|PUT|DELETE)" // E2E не должен содержать HTTP-методы!
                        }
                    },
                    {
                        type: "object",
                        required: ["sharedStepId"],
                        properties: {
                            sharedStepId: { type: "number" }
                        }
                    }
                ]
            }
        },
        scenario: {
            type: "null",
            description: "E2E тесты НЕ должны иметь scenario (полный путь пользователя)"
        },
        code: {
            type: "null",
            description: "E2E тесты НЕ должны иметь code"
        },
        priority: {
            type: "string",
            enum: ["High"],
            description: "E2E всегда High priority"
        },
        precondition: {
            type: "string",
            pattern: "^Пользователь не авторизован",
            description: "E2E обычно начинается с неавторизованного состояния"
        },
        expected: {
            type: "string",
            pattern: "^\\*\\*(Отображается|Создан|Удалён|Обновлён)\\*\\*",
            not: {
                pattern: "\\*\\*Возвращается\\*\\*" // E2E не должен проверять HTTP-ответы!
            },
            description: "E2E проверяет UI, а не API ответы"
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// INTEGRATION FRONTEND - Строгая схема
// ═══════════════════════════════════════════════════════════════

export const INTEGRATION_FRONTEND_SCHEMA = {
    ...BASE_TEST_SCHEMA,
    required: [...BASE_TEST_SCHEMA.required, "scenario"],
    properties: {
        ...BASE_TEST_SCHEMA.properties,
        layer: {
            type: "string",
            const: "Integration frontend Tests"
        },
        scenario: {
            type: "string",
            minLength: 10,
            pattern: "^\\d+\\. (Нажать|Ввести|Выбрать|Кликнуть|Открыть|Перейти|Заполнить|Загрузить)",
            description: "Scenario ОБЯЗАТЕЛЕН и должен начинаться с номера и глагола действия"
        },
        steps: {
            type: "array",
            minItems: 1,
            maxItems: 5, // Integration frontend - атомарные проверки, не должны быть длинными
            items: {
                type: "string",
                minLength: 5,
                not: {
                    pattern: "Выполнить (GET|POST|PUT|DELETE)" // Frontend НЕ должен содержать HTTP-методы!
                }
            }
        },
        code: {
            type: "null",
            description: "Integration frontend НЕ должен иметь code (это не Unit тест)"
        },
        priority: {
            type: "string",
            enum: ["Medium"],
            description: "Integration frontend всегда Medium priority"
        },
        precondition: {
            type: "string",
            pattern: "^Пользователь авторизован",
            description: "Integration frontend обычно требует авторизации"
        },
        expected: {
            type: "string",
            pattern: "^\\*\\*(Отображается|Скрывается)\\*\\*",
            not: {
                pattern: "\\*\\*Возвращается\\*\\*" // Frontend не проверяет HTTP-ответы!
            },
            description: "Integration frontend проверяет только UI (отображение/скрытие)"
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// INTEGRATION BACKEND - Строгая схема
// ═══════════════════════════════════════════════════════════════

export const INTEGRATION_BACKEND_SCHEMA = {
    ...BASE_TEST_SCHEMA,
    required: [...BASE_TEST_SCHEMA.required, "scenario"],
    properties: {
        ...BASE_TEST_SCHEMA.properties,
        layer: {
            type: "string",
            const: "Integration backend Tests"
        },
        scenario: {
            type: "string",
            minLength: 10,
            description: "Scenario ОБЯЗАТЕЛЕН для Integration backend"
        },
        steps: {
            type: "array",
            minItems: 1,
            maxItems: 3, // Integration backend - атомарные API вызовы
            items: {
                type: "string",
                pattern: "^Выполнить (GET|POST|PUT|DELETE|PATCH) \\*\\*/",
                description: "Backend шаги ОБЯЗАТЕЛЬНО начинаются с 'Выполнить {METHOD} **/api/...**'"
            }
        },
        code: {
            oneOf: [
                { type: "string" },
                { type: "null" }
            ],
            description: "Integration backend МОЖЕТ иметь code (ссылка на Code из модели)"
        },
        priority: {
            type: "string",
            enum: ["Medium", "High"],
            description: "Integration backend обычно Medium, High для критичных API"
        },
        precondition: {
            type: "string",
            pattern: "^Сервер доступен",
            description: "Integration backend всегда требует доступный сервер"
        },
        expected: {
            type: "string",
            pattern: "^\\*\\*Возвращается\\*\\* (\\d{3}|\\{Код ответа\\})",
            description: "Integration backend ОБЯЗАТЕЛЬНО проверяет HTTP-ответ с кодом"
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// UNIT FRONTEND - Строгая схема
// ═══════════════════════════════════════════════════════════════

export const UNIT_FRONTEND_SCHEMA = {
    ...BASE_TEST_SCHEMA,
    required: [...BASE_TEST_SCHEMA.required, "scenario", "code"],
    properties: {
        ...BASE_TEST_SCHEMA.properties,
        layer: {
            type: "string",
            const: "Unit frontend Tests"
        },
        title: {
            type: "string",
            pattern: "^Unit:",
            minLength: 15,
            description: "Unit тесты ОБЯЗАТЕЛЬНО начинаются с 'Unit:'"
        },
        scenario: {
            type: "string",
            minLength: 10,
            description: "Scenario ОБЯЗАТЕЛЕН для Unit тестов (ссылка на Scenario из модели)"
        },
        code: {
            type: "string",
            minLength: 5,
            description: "Code ОБЯЗАТЕЛЕН для Unit тестов (ID кода из модели)"
        },
        steps: {
            type: "array",
            minItems: 1,
            maxItems: 2, // Unit тесты - простые заглушки
            items: {
                type: "string",
                pattern: "^Вызвать (компонент|функцию|метод)",
                description: "Unit шаги ОБЯЗАТЕЛЬНО начинаются с 'Вызвать компонент/функцию/метод'"
            }
        },
        priority: {
            type: "string",
            enum: ["Medium"],
            description: "Unit тесты всегда Medium priority"
        },
        precondition: {
            type: "string",
            pattern: "^(Компонент|Функция|Модуль)",
            description: "Unit тесты требуют инициализации компонента/функции"
        },
        expected: {
            type: "string",
            pattern: "^\\*\\*Выполнено\\*\\*",
            description: "Unit тесты всегда проверяют выполнение без ошибок"
        },
        tags: {
            type: "array",
            items: {
                type: "string",
                enum: ["D", "U"]
            },
            description: "Unit тесты обычно D (Desktop) или U (Unit)"
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// МАППИНГ СХЕМ ПО СЛОЯМ
// ═══════════════════════════════════════════════════════════════

export const SCHEMA_BY_LAYER = {
    "E2E Tests": E2E_TEST_SCHEMA,
    "Integration frontend Tests": INTEGRATION_FRONTEND_SCHEMA,
    "Integration backend Tests": INTEGRATION_BACKEND_SCHEMA,
    "Unit frontend Tests": UNIT_FRONTEND_SCHEMA
};

// ═══════════════════════════════════════════════════════════════
// ВАЛИДАТОР
// ═══════════════════════════════════════════════════════════════

/**
 * Валидирует тест-кейс по жёсткой схеме для его слоя
 * @param {object} testCase - Тест-кейс для валидации
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTestCase(testCase) {
    const schema = SCHEMA_BY_LAYER[testCase.layer];
    if (!schema) {
        return {
            valid: false,
            errors: [`Unknown layer: ${testCase.layer}`]
        };
    }

    const errors = [];

    // Проверяем required поля
    for (const field of schema.required) {
        if (!testCase[field]) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    // Проверяем каждое поле по схеме
    for (const [key, propSchema] of Object.entries(schema.properties)) {
        const value = testCase[key];
        
        if (value === undefined || value === null) {
            if (schema.required.includes(key)) {
                errors.push(`Required field ${key} is missing`);
            }
            continue;
        }

        // Проверка типа
        if (propSchema.type && typeof value !== propSchema.type && propSchema.type !== 'null') {
            if (propSchema.type === 'array' && !Array.isArray(value)) {
                errors.push(`Field ${key} must be an array, got ${typeof value}`);
            }
        }

        // Проверка const
        if (propSchema.const !== undefined && value !== propSchema.const) {
            errors.push(`Field ${key} must be "${propSchema.const}", got "${value}"`);
        }

        // Проверка enum
        if (propSchema.enum && !propSchema.enum.includes(value)) {
            errors.push(`Field ${key} must be one of [${propSchema.enum.join(', ')}], got "${value}"`);
        }

        // Проверка pattern (regex)
        if (propSchema.pattern && typeof value === 'string') {
            const regex = new RegExp(propSchema.pattern);
            if (!regex.test(value)) {
                errors.push(`Field ${key} does not match pattern ${propSchema.pattern}. Value: "${value}"`);
            }
        }

        // Проверка minLength
        if (propSchema.minLength && typeof value === 'string' && value.length < propSchema.minLength) {
            errors.push(`Field ${key} must be at least ${propSchema.minLength} characters, got ${value.length}`);
        }

        // Проверка minItems для массивов
        if (propSchema.minItems && Array.isArray(value) && value.length < propSchema.minItems) {
            errors.push(`Field ${key} must have at least ${propSchema.minItems} items, got ${value.length}`);
        }

        // Проверка maxItems для массивов
        if (propSchema.maxItems && Array.isArray(value) && value.length > propSchema.maxItems) {
            errors.push(`Field ${key} must have at most ${propSchema.maxItems} items, got ${value.length}`);
        }

        // Проверка not (отрицание паттерна)
        if (propSchema.not?.pattern && typeof value === 'string') {
            const regex = new RegExp(propSchema.not.pattern);
            if (regex.test(value)) {
                errors.push(`Field ${key} must NOT match pattern ${propSchema.not.pattern}. Value: "${value}"`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Валидирует массив тест-кейсов
 * @param {object[]} testCases - Массив тест-кейсов
 * @returns {{valid: boolean, totalErrors: number, failedTests: object[]}}
 */
export function validateTestCases(testCases) {
    const results = testCases.map((tc, idx) => ({
        index: idx,
        title: tc.title,
        layer: tc.layer,
        ...validateTestCase(tc)
    }));

    const failedTests = results.filter(r => !r.valid);
    const totalErrors = failedTests.reduce((sum, r) => sum + r.errors.length, 0);

    return {
        valid: failedTests.length === 0,
        totalErrors,
        failedTests,
        allResults: results
    };
}


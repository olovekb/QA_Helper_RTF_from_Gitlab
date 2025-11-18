/**
 * Модуль автоматической отладки и улучшения агента генерации тест-кейсов
 * Автоматически тестирует генерацию, сравнивает с эталоном, анализирует отклонения и корректирует промпты
 */

import axios from 'axios';

// ═══════════════════════════════════════════════════════════════
// ИМПОРТ НОВОЙ АРХИТЕКТУРЫ V2
// ═══════════════════════════════════════════════════════════════
import { validateTestCases } from './schemas/test-case-schemas.mjs';
import { parseAPISpecification, validateCodeAgainstAPISpec, formatAPISpecForPrompt, checkBlacklist } from './parsers/api-spec-parser.mjs';
import { normalizeTestCases, splitCompositeCodesInModel } from './normalizers/test-case-normalizer.mjs';
import { reviewTestCases, mergeReviewResults } from './agents/review-agent.mjs';
import { validateUntilClean } from './agents/post-generation-validator.mjs';

// ============================================================================
// ЭТАЛОННЫЕ СТРУКТУРЫ (на основе требований пользователя)
// ============================================================================

/**
 * Эталонная структура тестовой модели
 * Должна содержать: Feature → Story → Scenario → Code (frontend/backend)
 */
export const REFERENCE_TEST_MODEL_STRUCTURE = {
    features: {
        required: true,
        minCount: 1,
        structure: {
            id: { required: true, type: 'uuid' },
            text: { required: true, type: 'string', minLength: 5 },
            stories: {
                required: true,
                minCount: 1,
                structure: {
                    id: { required: true, type: 'uuid' },
                    text: { required: true, type: 'string', minLength: 5 },
                    scenarios: {
                        required: true,
                        minCount: 1,
                        structure: {
                            id: { required: true, type: 'uuid' },
                            text: { required: true, type: 'string', minLength: 5 },
                            codes: {
                                required: true,
                                minCount: 1,
                                structure: {
                                    id: { required: true, type: 'uuid' },
                                    text: { required: true, type: 'string', minLength: 5 },
                                    type: { required: true, enum: ['frontend', 'backend'] }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};

/**
 * Эталонная структура тест-кейсов
 */
export const REFERENCE_TEST_CASE_STRUCTURE = {
    id: { required: true, type: 'string' },
    feature: { required: true, type: 'string', minLength: 3 },
    story: { required: true, type: 'string', minLength: 3 },
    title: { required: true, type: 'string', minLength: 5 },
    layer: { required: true, enum: ['E2E Tests', 'Integration frontend Tests', 'Integration backend Tests'] },
    precondition: { required: false, type: 'string' },
    steps: { required: true, type: 'array', minLength: 1 },
    expected: { required: true, type: 'string', minLength: 3 },
    tags: { required: true, type: 'array', minLength: 1 },
    priority: { required: true, enum: ['High', 'Medium', 'Low'] },
    version: { required: true, type: 'string' },
    scenario: { required: false, type: 'string' },
    parameters: { required: false, type: 'array' },
    examples: { required: false, type: 'array' }
};

/**
 * Правила для валидации тест-модели
 */
export const TEST_MODEL_VALIDATION_RULES = {
    // Feature должен содержать минимум 3 Stories
    minStoriesPerFeature: 3,
    // Story должна содержать минимум 2 Scenarios
    minScenariosPerStory: 2,
    // Scenario должен содержать минимум 2 Codes
    minCodesPerScenario: 2,
    // Code должен иметь тип frontend или backend
    codeTypes: ['frontend', 'backend'],
    // Должна быть балансировка frontend/backend кодов (минимум 30% каждого)
    minFrontendRatio: 0.3,
    minBackendRatio: 0.3,
    // В каждом Scenario должны быть и frontend, и backend коды
    requireBothTypesInScenario: true
};

/**
 * Правила для валидации тест-кейсов
 */
export const TEST_CASE_VALIDATION_RULES = {
    // E2E тесты должны иметь минимум 3 шага
    e2eMinSteps: 3,
    // Integration тесты должны иметь минимум 1 шаг
    integrationMinSteps: 1,
    // Expected result не должен начинаться с глагола в инфинитиве
    expectedResultPattern: /^(Отображается|Возвращается|Создан|Добавлен|Удален|Скрывается|Закрывается)/i,
    // Steps должны быть конкретными (не "Проверить функциональность")
    vagueStepPatterns: [
        /^проверить$/i,
        /^тест$/i,
        /^действие$/i,
        /^проверка$/i,
        /^проверить\s+функциональность$/i
    ],
    // E2E тесты не должны содержать технических деталей
    technicalDetailsPatterns: [
        /(GET|POST|PUT|DELETE|PATCH)\s+\/api/i,
        /статус[-_\s]?код|status\s+code/i,
        /\b(200|201|400|401|403|404|500)\s+OK|Bad Request|Not Found/i,
        /эндпоинт|endpoint/i
    ],
    // Проверка соответствия тест-кейсов тестовой модели
    requireScenarioMatch: true
};

// ============================================================================
// ФУНКЦИИ СРАВНЕНИЯ И ВАЛИДАЦИИ
// ============================================================================

/**
 * Валидирует структуру тестовой модели
 */
export function validateTestModelStructure(testModel) {
    const errors = [];
    const warnings = [];
    const stats = {
        featuresCount: 0,
        storiesCount: 0,
        scenariosCount: 0,
        codesCount: 0,
        frontendCodesCount: 0,
        backendCodesCount: 0
    };
    
    // Массивы для детального логирования
    const errorExamples = [];

    if (!testModel || !Array.isArray(testModel)) {
        errors.push('Тестовая модель должна быть массивом');
        return { valid: false, errors, warnings, stats, errorExamples };
    }

    testModel.forEach((feature, fIdx) => {
        stats.featuresCount++;

        // Проверка Feature
        if (!feature.id) {
            errors.push(`Feature #${fIdx + 1}: отсутствует id`);
        }
        if (!feature.text || feature.text.length < 3) {
            errors.push(`Feature #${fIdx + 1}: text пустой или слишком короткий`);
        }
        if (!feature.stories || !Array.isArray(feature.stories)) {
            errors.push(`Feature #${fIdx + 1}: отсутствует массив stories`);
            return;
        }

        if (feature.stories.length < TEST_MODEL_VALIDATION_RULES.minStoriesPerFeature) {
            warnings.push(`Feature "${feature.text}": содержит ${feature.stories.length} stories, рекомендуется минимум ${TEST_MODEL_VALIDATION_RULES.minStoriesPerFeature}`);
        }

        feature.stories.forEach((story, sIdx) => {
            stats.storiesCount++;

            // Проверка Story
            if (!story.id) {
                errors.push(`Feature #${fIdx + 1}, Story #${sIdx + 1}: отсутствует id`);
            }
            if (!story.text || story.text.length < 3) {
                errors.push(`Feature #${fIdx + 1}, Story #${sIdx + 1}: text пустой или слишком короткий`);
            }
            
            // 🚨 КРИТИЧНАЯ ПРОВЕРКА 1: Story БЕЗ технических терминов
            if (story.text && /проверка|тестирование|api|валидация/i.test(story.text)) {
                const badWords = story.text.match(/проверка|тестирование|api|валидация/gi);
                errors.push(`Story "${story.text}": содержит запрещенные технические термины: ${badWords.join(', ')}`);
                errorExamples.push({
                    type: 'story_bad_words',
                    current: story.text,
                    problem: `Содержит технические термины: ${badWords.join(', ')}`,
                    correct: story.text.replace(/проверка|тестирование|api|валидация/gi, '').trim() || 'Переформулируйте без технических терминов',
                    location: `Feature "${feature.text}" → Story #${sIdx + 1}`,
                    fix: 'server.js → buildTestModelPrompt() → ПРАВИЛА STORY: Story = пользовательская история (ЧТО хочет получить пользователь), а НЕ техническая реализация'
                });
            }
            
            if (!story.scenarios || !Array.isArray(story.scenarios)) {
                errors.push(`Feature #${fIdx + 1}, Story #${sIdx + 1}: отсутствует массив scenarios`);
                return;
            }

            if (story.scenarios.length < TEST_MODEL_VALIDATION_RULES.minScenariosPerStory) {
                warnings.push(`Story "${story.text}": содержит ${story.scenarios.length} scenarios, рекомендуется минимум ${TEST_MODEL_VALIDATION_RULES.minScenariosPerStory}`);
            }

            story.scenarios.forEach((scenario, scIdx) => {
                stats.scenariosCount++;

                // Проверка Scenario
                if (!scenario.id) {
                    errors.push(`Story "${story.text}", Scenario #${scIdx + 1}: отсутствует id`);
                }
                if (!scenario.text || scenario.text.length < 3) {
                    errors.push(`Story "${story.text}", Scenario #${scIdx + 1}: text пустой или слишком короткий`);
                }
                
                // 🚨 КРИТИЧНАЯ ПРОВЕРКА 2: Scenario начинается с действия пользователя
                if (scenario.text && scenario.text.length >= 3) {
                    // Убираем номер в начале ("1. " -> "")
                    const textWithoutNumber = scenario.text.replace(/^\d+\.\s*/, '');
                    if (!/^(нажать|ввести|выбрать|кликнуть|открыть|перейти|заполнить|отсканировать|подтвердить)/i.test(textWithoutNumber)) {
                        errors.push(`Scenario "${scenario.text}": НЕ начинается с действия пользователя (должен начинаться с: Нажать, Ввести, Выбрать, Кликнуть, Открыть, Перейти, Заполнить)`);
                        errorExamples.push({
                            type: 'scenario_wrong_start',
                            current: scenario.text,
                            problem: 'НЕ начинается с глагола действия пользователя',
                            correct: `Нажать/Ввести/Выбрать/Кликнуть... (начинайте с конкретного действия)`,
                            location: `Story "${story.text}" → Scenario #${scIdx + 1}`,
                            fix: 'server.js → buildTestModelPrompt() → ПРАВИЛА SCENARIOS: Scenarios = пользовательские действия, начинаются с глагола: "Нажать", "Выбрать", "Ввести", "Открыть"'
                        });
                    }
                }
                
                if (!scenario.codes || !Array.isArray(scenario.codes)) {
                    errors.push(`Story "${story.text}", Scenario #${scIdx + 1}: отсутствует массив codes`);
                    return;
                }

                if (scenario.codes.length < TEST_MODEL_VALIDATION_RULES.minCodesPerScenario) {
                    warnings.push(`Scenario "${scenario.text}": содержит ${scenario.codes.length} codes, рекомендуется минимум ${TEST_MODEL_VALIDATION_RULES.minCodesPerScenario}`);
                }

                let hasFrontend = false;
                let hasBackend = false;

                scenario.codes.forEach((code, cIdx) => {
                    stats.codesCount++;

                    // Проверка Code
                    if (!code.id) {
                        errors.push(`Scenario "${scenario.text}", Code #${cIdx + 1}: отсутствует id`);
                    }
                    if (!code.text || code.text.length < 3) {
                        errors.push(`Scenario "${scenario.text}", Code #${cIdx + 1}: text пустой или слишком короткий`);
                    }
                    
                    // 🚨 КРИТИЧНАЯ ПРОВЕРКА 3: Code БЕЗ префиксов
                    if (code.text) {
                        const badPrefixes = [
                            /^Frontend\s+отправляет/i,
                            /^Backend\s+возвращает/i,
                            /^Frontend:/i,
                            /^Backend:/i,
                            /^UI:/i,
                            /^API:/i
                        ];
                        const foundBadPrefix = badPrefixes.find(pattern => pattern.test(code.text));
                        if (foundBadPrefix) {
                            errors.push(`Code "${code.text}": содержит запрещенный префикс`);
                            errorExamples.push({
                                type: 'code_bad_prefix',
                                current: code.text,
                                problem: 'Содержит запрещенный префикс "Frontend:", "Backend:", "UI:", "API:"',
                                correct: code.text.replace(/^(Frontend|Backend|UI|API)\s*:?\s*/i, '').trim(),
                                location: `Scenario "${scenario.text}" → Code #${cIdx + 1}`,
                                fix: 'server.js → buildTestModelPrompt() → ПРАВИЛА CODE: ❌ НЕ используй префиксы: "API:", "UI:", "Frontend:", "Backend:"'
                            });
                        }
                    }
                    
                    if (!code.type) {
                        errors.push(`Scenario "${scenario.text}", Code #${cIdx + 1}: отсутствует type`);
                    } else if (!TEST_MODEL_VALIDATION_RULES.codeTypes.includes(code.type)) {
                        errors.push(`Scenario "${scenario.text}", Code #${cIdx + 1}: недопустимый type="${code.type}", допустимы: ${TEST_MODEL_VALIDATION_RULES.codeTypes.join(', ')}`);
                    } else {
                        if (code.type === 'frontend') {
                            stats.frontendCodesCount++;
                            hasFrontend = true;
                        } else if (code.type === 'backend') {
                            stats.backendCodesCount++;
                            hasBackend = true;
                        }
                    }
                });

                // Проверка баланса frontend/backend в сценарии
                if (TEST_MODEL_VALIDATION_RULES.requireBothTypesInScenario) {
                    if (!hasFrontend || !hasBackend) {
                        warnings.push(`Scenario "${scenario.text}": содержит только ${hasFrontend ? 'frontend' : 'backend'} коды, рекомендуется иметь и frontend, и backend`);
                    }
                }
            });
        });
    });

    // Проверка общего баланса frontend/backend
    const totalCodes = stats.codesCount;
    if (totalCodes > 0) {
        const frontendRatio = stats.frontendCodesCount / totalCodes;
        const backendRatio = stats.backendCodesCount / totalCodes;

        if (frontendRatio < TEST_MODEL_VALIDATION_RULES.minFrontendRatio) {
            warnings.push(`Недостаточно frontend кодов: ${(frontendRatio * 100).toFixed(1)}%, рекомендуется минимум ${(TEST_MODEL_VALIDATION_RULES.minFrontendRatio * 100).toFixed(0)}%`);
        }
        if (backendRatio < TEST_MODEL_VALIDATION_RULES.minBackendRatio) {
            warnings.push(`Недостаточно backend кодов: ${(backendRatio * 100).toFixed(1)}%, рекомендуется минимум ${(TEST_MODEL_VALIDATION_RULES.minBackendRatio * 100).toFixed(0)}%`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats,
        errorExamples
    };
}

/**
 * Валидирует тест-кейсы (LEGACY версия для старой валидации)
 * Новая версия импортирована из ./schemas/test-case-schemas.mjs
 */
export function validateTestCasesLegacy(testCases, testModel) {
    const errors = [];
    const warnings = [];
    const stats = {
        totalCases: testCases.length,
        e2eCases: 0,
        integrationFrontendCases: 0,
        integrationBackendCases: 0,
        casesWithParameters: 0,
        casesWithExamples: 0
    };
    
    // Массивы для детального логирования
    const errorExamples = [];

    // Строим индекс тестовой модели для проверки соответствия
    const scenarioIndex = new Set();
    if (testModel && Array.isArray(testModel)) {
        testModel.forEach(feature => {
            feature.stories?.forEach(story => {
                story.scenarios?.forEach(scenario => {
                    scenarioIndex.add(scenario.text?.trim());
                });
            });
        });
    }

    // Защита от некорректного формата testCases
    if (!Array.isArray(testCases)) {
        console.error('[validateTestCases] ❌ testCases не является массивом:', typeof testCases);
        console.error('[validateTestCases] Содержимое testCases:', JSON.stringify(testCases, null, 2).substring(0, 500));
        errors.push(`testCases должен быть массивом, получен ${typeof testCases}`);
        return { errors, warnings, errorExamples };
    }

    testCases.forEach((tc, idx) => {
        const tcNum = idx + 1;

        // Проверка обязательных полей
        if (!tc.id) errors.push(`Тест-кейс #${tcNum}: отсутствует id`);
        if (!tc.feature) errors.push(`Тест-кейс #${tcNum}: отсутствует feature`);
        if (!tc.story) errors.push(`Тест-кейс #${tcNum}: отсутствует story`);
        if (!tc.title || tc.title.length < 5) errors.push(`Тест-кейс #${tcNum}: title пустой или слишком короткий`);
        if (!tc.layer) errors.push(`Тест-кейс #${tcNum}: отсутствует layer`);
        if (!tc.expected || tc.expected.length < 3) errors.push(`Тест-кейс #${tcNum} "${tc.title}": expected пустой или слишком короткий`);
        if (!tc.steps || !Array.isArray(tc.steps) || tc.steps.length === 0) {
            errors.push(`Тест-кейс #${tcNum} "${tc.title}": steps пустой или не массив`);
        }

        // Статистика по слоям
        if (tc.layer === 'E2E Tests') {
            stats.e2eCases++;
        } else if (tc.layer === 'Integration frontend Tests') {
            stats.integrationFrontendCases++;
        } else if (tc.layer === 'Integration backend Tests') {
            stats.integrationBackendCases++;
        }

        // Проверка параметров
        if (tc.parameters && Array.isArray(tc.parameters) && tc.parameters.length > 0) {
            stats.casesWithParameters++;
        }
        if (tc.examples && Array.isArray(tc.examples) && tc.examples.length > 0) {
            stats.casesWithExamples++;
        }

        // Проверка минимального количества шагов
        if (tc.layer === 'E2E Tests' && tc.steps && tc.steps.length < TEST_CASE_VALIDATION_RULES.e2eMinSteps) {
            errors.push(`Тест-кейс #${tcNum} "${tc.title}": E2E тест имеет ${tc.steps.length} шагов, требуется минимум ${TEST_CASE_VALIDATION_RULES.e2eMinSteps}`);
        }

        // 🚨 КРИТИЧНАЯ ПРОВЕРКА 4: Expected начинается с правильной формы с выделением
        if (tc.expected) {
            // Проверяем наличие жирного выделения ключевого слова
            const hasCorrectFormat = /^\*\*(Отображается|Возвращается|Создан|Добавлен|Удален|Скрывается|Закрывается|Заполнено|Сохранено|Передано)\*\*/i.test(tc.expected);
            if (!hasCorrectFormat) {
                errors.push(`Тест-кейс #${tcNum} "${tc.title}": expected result НЕ начинается с **Ключевого слова** (должен быть "**Отображается**...", "**Возвращается**...", "**Создан**..." и т.д. с жирным выделением)`);
                errorExamples.push({
                    type: 'expected_wrong_format',
                    current: tc.expected,
                    problem: 'НЕ начинается с **Ключевого слова** в жирном',
                    correct: `**Отображается** ${tc.expected.replace(/^[^а-яА-Я]*/, '').trim()}`,
                    location: `Тест-кейс "${tc.title}"`,
                    fix: 'server.js → BASE_SYSTEM_PROMPT → Expected: ✅ ПРАВИЛЬНО: "**Отображается**", "**Возвращается**", "**Создан**" (с жирным выделением!)'
                });
            }
        }

        // Проверка на vague steps
        if (tc.steps && Array.isArray(tc.steps)) {
            const vagueSteps = tc.steps.filter(step => {
                const stepText = typeof step === 'string' ? step : (step?.text || '');
                return TEST_CASE_VALIDATION_RULES.vagueStepPatterns.some(pattern => pattern.test(stepText));
            });
            if (vagueSteps.length > 0) {
                warnings.push(`Тест-кейс #${tcNum} "${tc.title}": содержит неконкретные шаги (${vagueSteps.length} шт.)`);
            }
        }

        // Проверка E2E на технические детали
        if (tc.layer === 'E2E Tests') {
            const allText = `${tc.title} ${tc.steps?.join(' ') || ''} ${tc.expected || ''}`;
            const hasTechnicalDetails = TEST_CASE_VALIDATION_RULES.technicalDetailsPatterns.some(pattern => pattern.test(allText));
            if (hasTechnicalDetails) {
                errors.push(`Тест-кейс #${tcNum} "${tc.title}": E2E тест содержит технические детали (HTTP методы, статус-коды, API эндпоинты)`);
            }
        }

        // Проверка соответствия scenario тестовой модели
        if (TEST_CASE_VALIDATION_RULES.requireScenarioMatch && tc.scenario) {
            if (!scenarioIndex.has(tc.scenario.trim())) {
                errors.push(`Тест-кейс #${tcNum} "${tc.title}": scenario "${tc.scenario}" не найден в тестовой модели`);
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats,
        errorExamples
    };
}

/**
 * Сравнивает сгенерированную модель с эталонной структурой
 */
export function compareWithReference(generated, reference) {
    const modelValidation = validateTestModelStructure(generated.testModel || []);
    const casesValidation = validateTestCasesLegacy(generated.testCases || [], generated.testModel || []);

    const score = calculateQualityScore(modelValidation, casesValidation);

    return {
        score,
        modelValidation,
        casesValidation,
        isAcceptable: score >= 80 && modelValidation.errors.length === 0 && casesValidation.errors.length === 0
    };
}

/**
 * Вычисляет качественный score (0-100)
 */
function calculateQualityScore(modelValidation, casesValidation) {
    let score = 100;

    // Штрафы за ошибки
    score -= modelValidation.errors.length * 10;
    score -= casesValidation.errors.length * 10;

    // Штрафы за предупреждения (меньше)
    score -= modelValidation.warnings.length * 2;
    score -= casesValidation.warnings.length * 2;

    // Бонусы за хорошую структуру
    if (modelValidation.stats.codesCount > 10) score += 5;
    if (casesValidation.stats.totalCases > 5) score += 5;

    return Math.max(0, Math.min(100, score));
}

// ============================================================================
// АВТОМАТИЧЕСКОЕ ТЕСТИРОВАНИЕ ЧЕРЕЗ API
// ============================================================================

/**
 * Отправляет требования на генерацию тестовой модели
 */
export async function generateTestModelAPI(requirements, baseURL = 'http://localhost:5002') {
    try {
        console.log(`[DEBUG] Отправка запроса на ${baseURL}/api/generate-test-model-async...`);
        const response = await axios.post(`${baseURL}/api/generate-test-model-async`, {
            requirements
        });

        const taskId = response.data.taskId;
        console.log(`[DEBUG] Тестовая модель: taskId=${taskId}, ожидание завершения...`);

        // Ожидаем завершения
        const result = await pollTaskStatus(taskId, 'model', baseURL);
        
        // API возвращает объект { testModel: [], testModelId: string }, извлекаем testModel
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            if (result.testModel && Array.isArray(result.testModel)) {
                console.log(`[DEBUG] ✅ Извлечена testModel из результата: ${result.testModel.length} Feature(s)`);
                return { testModel: result.testModel };
            }
        }
        
        throw new Error(`Некорректный формат результата модели: ожидался объект с testModel, получен ${typeof result}`);
    } catch (error) {
        console.error(`[DEBUG] Детали ошибки:`, error.response?.data || error.message || error);
        throw new Error(`Ошибка генерации тестовой модели: ${error.response?.data?.error || error.message || 'Неизвестная ошибка'}`);
    }
}

/**
 * Отправляет тестовую модель на генерацию тест-кейсов
 */
export async function generateTestCasesAPI(testModel, requirements, baseURL = 'http://localhost:5002', projectId = null) {
    try {
        const payload = {
            modelStructure: testModel,  // API ожидает поле 'modelStructure' (как фронтенд)
            requirements,
            skipAllureAPICalls: true  // ✅ ВАЖНО! Debug режим - НЕ вызываем Allure API (pairwise)
        };
        
        // Если есть projectId - добавляем для логирования
        if (projectId) {
            payload.projectId = projectId;
            console.log(`[DEBUG] Передаём projectId=${projectId}`);
        }
        
        console.log(`[DEBUG] skipAllureAPICalls=true - Allure API вызовы ОТКЛЮЧЕНЫ (debug режим)`);
        
        const response = await axios.post(`${baseURL}/api/generate-test-cases-async`, payload);

        const taskId = response.data.taskId;
        console.log(`[DEBUG] Тест-кейсы: taskId=${taskId}, ожидание завершения...`);

        // Ожидаем завершения
        const result = await pollTaskStatus(taskId, 'cases', baseURL);
        
        // Проверяем формат результата
        console.log(`[DEBUG] Тип результата: ${typeof result}, является массивом: ${Array.isArray(result)}`);
        
        // API возвращает объект { testCases: [], testModel: [] }, извлекаем testCases
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            console.log(`[DEBUG] Ключи результата: ${Object.keys(result).join(', ')}`);
            if (result.testCases && Array.isArray(result.testCases)) {
                console.log(`[DEBUG] ✅ Извлечены testCases из результата: ${result.testCases.length} тест-кейсов`);
                return result.testCases;
            }
        }
        
        // Если result уже массив - возвращаем как есть
        if (Array.isArray(result)) {
            console.log(`[DEBUG] ✅ Результат уже является массивом: ${result.length} тест-кейсов`);
            return result;
        }
        
        throw new Error(`Некорректный формат результата: ожидался массив или объект с testCases, получен ${typeof result}`);
    } catch (error) {
        throw new Error(`Ошибка генерации тест-кейсов: ${error.message}`);
    }
}

/**
 * Опрашивает статус задачи до завершения
 * maxAttempts = 360 * 5 сек = 1800 сек = 30 минут
 */
async function pollTaskStatus(taskId, type, baseURL, maxAttempts = 360, intervalMs = 5000) {
    const endpoint = type === 'model' 
        ? `/api/generate-test-model-status/${taskId}`
        : `/api/generate-test-cases-status/${taskId}`;

    const startTime = Date.now();
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        try {
            const response = await axios.get(`${baseURL}${endpoint}`);
            const status = response.data.status;
            const progress = response.data.progress;
            
            // Вычисляем прошедшее время
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            const remainingSeconds = elapsedSeconds % 60;
            
            // Оценка оставшегося времени (если есть progress)
            let etaString = '';
            if (progress > 0 && progress < 100) {
                const estimatedTotal = (elapsedSeconds / progress) * 100;
                const estimatedRemaining = estimatedTotal - elapsedSeconds;
                const etaMinutes = Math.floor(estimatedRemaining / 60);
                etaString = `, ETA: ~${etaMinutes}м`;
            }

            console.log(`[DEBUG] ${type} taskId=${taskId}: status=${status}, progress=${progress}%, время: ${elapsedMinutes}м ${remainingSeconds}с${etaString}`);

            if (status === 'completed') {
                console.log(`[DEBUG] ✅ ${type} завершен за ${elapsedMinutes}м ${remainingSeconds}с`);
                return response.data.result;
            } else if (status === 'failed') {
                throw new Error(`Задача завершилась с ошибкой: ${response.data.error_message}`);
            }
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Задача ${taskId} не найдена`);
            }
            console.warn(`[DEBUG] Ошибка опроса статуса: ${error.message}`);
        }
    }
    
    const timeoutMinutes = Math.floor((maxAttempts * intervalMs) / 60000);
    throw new Error(`Таймаут ожидания завершения задачи ${taskId} (превышен лимит ${timeoutMinutes} минут)`);
}

// ============================================================================
// АНАЛИЗ И КОРРЕКЦИЯ
// ============================================================================

/**
 * Анализирует результаты и предлагает улучшения
 */
export function analyzeResults(comparison) {
    const suggestions = [];

    const { modelValidation, casesValidation, score } = comparison;

    // Анализ ошибок тестовой модели
    if (modelValidation.errors.length > 0) {
        suggestions.push({
            type: 'test_model_structure',
            priority: 'high',
            issues: modelValidation.errors,
            recommendation: 'Необходимо исправить структуру тестовой модели: убедиться, что каждый Feature содержит Stories, каждая Story содержит Scenarios, каждый Scenario содержит Codes с типами frontend/backend'
        });
    }

    // Анализ предупреждений тестовой модели
    if (modelValidation.warnings.length > 0) {
        suggestions.push({
            type: 'test_model_quality',
            priority: 'medium',
            issues: modelValidation.warnings,
            recommendation: 'Рекомендуется улучшить детализацию тестовой модели: добавить больше Scenarios и Codes, обеспечить баланс между frontend и backend'
        });
    }

    // Анализ ошибок тест-кейсов
    if (casesValidation.errors.length > 0) {
        const errorTypes = categorizeErrors(casesValidation.errors);
        
        if (errorTypes.missingFields) {
            suggestions.push({
                type: 'test_case_fields',
                priority: 'high',
                issues: errorTypes.missingFields,
                recommendation: 'Необходимо добавить обязательные поля в тест-кейсы: id, feature, story, title, layer, steps, expected'
            });
        }

        if (errorTypes.technicalDetails) {
            suggestions.push({
                type: 'e2e_technical_details',
                priority: 'high',
                issues: errorTypes.technicalDetails,
                recommendation: 'E2E тесты не должны содержать технические детали (HTTP методы, статус-коды, API эндпоинты). Эти детали должны быть в Integration тестах'
            });
        }

        if (errorTypes.scenarioMismatch) {
            suggestions.push({
                type: 'scenario_mismatch',
                priority: 'high',
                issues: errorTypes.scenarioMismatch,
                recommendation: 'Все тест-кейсы должны ссылаться на существующие Scenarios из тестовой модели'
            });
        }
    }

    // Анализ предупреждений тест-кейсов
    if (casesValidation.warnings.length > 0) {
        const warningTypes = categorizeErrors(casesValidation.warnings);

        if (warningTypes.expectedResult) {
            suggestions.push({
                type: 'expected_result_format',
                priority: 'medium',
                issues: warningTypes.expectedResult,
                recommendation: 'Expected result должен быть в форме завершённого действия (использовать "Отображается", "Возвращается", "Создан" вместо инфинитивов)'
            });
        }

        if (warningTypes.vagueSteps) {
            suggestions.push({
                type: 'vague_steps',
                priority: 'medium',
                issues: warningTypes.vagueSteps,
                recommendation: 'Шаги должны быть конкретными и детализированными (избегать "Проверить функциональность", использовать "Нажать кнопку \'Создать документ\'")'
            });
        }
    }

    // Оценка качества
    if (score < 50) {
        suggestions.push({
            type: 'overall_quality',
            priority: 'critical',
            issues: [`Общий score: ${score}/100`],
            recommendation: 'КРИТИЧЕСКИ низкое качество генерации. Необходима серьёзная доработка промптов и логики генерации'
        });
    } else if (score < 80) {
        suggestions.push({
            type: 'overall_quality',
            priority: 'high',
            issues: [`Общий score: ${score}/100`],
            recommendation: 'Качество генерации требует улучшения. Рекомендуется доработать промпты для повышения детализации и соответствия требованиям'
        });
    }

    return {
        score,
        suggestions,
        needsImprovement: score < 80 || modelValidation.errors.length > 0 || casesValidation.errors.length > 0
    };
}

/**
 * Категоризирует ошибки по типам
 */
function categorizeErrors(errors) {
    const categories = {
        missingFields: [],
        technicalDetails: [],
        scenarioMismatch: [],
        expectedResult: [],
        vagueSteps: []
    };

    errors.forEach(error => {
        if (/отсутствует|пустой/i.test(error)) {
            categories.missingFields.push(error);
        } else if (/технические детали|HTTP|статус-код/i.test(error)) {
            categories.technicalDetails.push(error);
        } else if (/scenario.*не найден/i.test(error)) {
            categories.scenarioMismatch.push(error);
        } else if (/expected result/i.test(error)) {
            categories.expectedResult.push(error);
        } else if (/неконкретные шаги/i.test(error)) {
            categories.vagueSteps.push(error);
        }
    });

    return categories;
}

/**
 * Главная функция автоматического тестирования
 */
export async function runAutomatedTest(requirements, baseURL = 'http://localhost:5002', projectId = null) {
    console.log('[DEBUG] ========================================');
    console.log('[DEBUG] НАЧАЛО АВТОМАТИЧЕСКОГО ТЕСТИРОВАНИЯ');
    console.log('[DEBUG] ========================================\n');
    
    if (projectId) {
        console.log(`[DEBUG] 🔑 ProjectId: ${projectId}\n`);
    } else {
        console.log(`[DEBUG] ⚠️  ProjectId НЕ передан\n`);
    }

    const startTime = Date.now();

    try {
        // Шаг 1: Генерация тестовой модели
        console.log('[DEBUG] Шаг 1: Генерация тестовой модели...');
        const testModel = await generateTestModelAPI(requirements, baseURL);
        console.log(`[DEBUG] ✅ Тестовая модель сгенерирована (${testModel?.testModel?.length || 0} Features)\n`);

        // Шаг 2: Генерация тест-кейсов
        console.log('[DEBUG] Шаг 2: Генерация тест-кейсов...');
        let testCases = await generateTestCasesAPI(testModel.testModel, requirements, baseURL, projectId);
        console.log(`[DEBUG] ✅ Тест-кейсы сгенерированы (${testCases?.length || 0} тест-кейсов)\n`);

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 2.1: НОВАЯ АРХИТЕКТУРА V2 - ВАЛИДАЦИЯ И НОРМАЛИЗАЦИЯ
        // ═══════════════════════════════════════════════════════════════
        
        console.log('[DEBUG] Шаг 2.1: Парсинг API спецификации из требований...');
        const apiSpec = parseAPISpecification(requirements);
        console.log(`[DEBUG] ✅ Найдено API эндпоинтов: ${apiSpec.endpoints.length}\n`);

        console.log('[DEBUG] Шаг 2.2: Разделение составных Codes на атомарные...');
        testModel.testModel = splitCompositeCodesInModel(testModel.testModel);
        console.log(`[DEBUG] ✅ Модель очищена от составных Codes\n`);

        console.log('[DEBUG] Шаг 2.3: Проверка выдуманных API (динамическая валидация)...');
        const blacklistErrors = [];
        
        // Проверяем модель
        for (const feature of testModel.testModel) {
            for (const story of feature.stories || []) {
                for (const scenario of story.scenarios || []) {
                    for (const code of scenario.codes || []) {
                        // ✅ Динамическая валидация против apiSpec
                        const check = checkBlacklist(code.text, apiSpec);
                        if (!check.valid) {
                            check.errors.forEach(err => {
                                blacklistErrors.push({
                                    location: `Model > ${story.text} > ${scenario.text}`,
                                    code: code.text.substring(0, 60),
                                    error: err
                                });
                            });
                        }
                    }
                }
            }
        }
        
        // Проверяем тест-кейсы
        for (const tc of testCases) {
            const checkTitle = checkBlacklist(tc.title || '', apiSpec);
            const checkSteps = checkBlacklist((tc.steps || []).join(' '), apiSpec);
            const checkExpected = checkBlacklist(tc.expected || '', apiSpec);
            
            [checkTitle, checkSteps, checkExpected].forEach(check => {
                if (!check.valid) {
                    check.errors.forEach(err => {
                        blacklistErrors.push({
                            location: `Test "${tc.title}"`,
                            error: err
                        });
                    });
                }
            });
        }
        
        if (blacklistErrors.length > 0) {
            console.log(`[DEBUG] ❌ НАЙДЕНО ВЫДУМАННЫХ ВЕЩЕЙ: ${blacklistErrors.length}`);
            blacklistErrors.slice(0, 5).forEach((err, idx) => {
                console.log(`  ${idx + 1}. [${err.location}] ${err.error}`);
                if (err.code) console.log(`     Code: "${err.code}..."`);
            });
            console.log('');
        } else {
            console.log(`[DEBUG] ✅ Блэклист: выдуманных вещей НЕ найдено\n`);
        }

        console.log('[DEBUG] Шаг 2.4: Агрессивная нормализация тест-кейсов...');
        testCases = normalizeTestCases(testCases, {
            testModel: testModel.testModel,
            apiSpec
        });
        console.log(`[DEBUG] ✅ Нормализация завершена\n`);

        // ═══════════════════════════════════════════════════════════════
        // Шаг 2.5: LLM-ВАЛИДАЦИЯ И АВТОИСПРАВЛЕНИЕ (итеративно) - ТОЛЬКО ВРАКИ
        // ═══════════════════════════════════════════════════════════════
        console.log('[DEBUG] Шаг 2.5: LLM-валидация и автоисправление ВРАКОВ...');
        const llmValidationResult = await validateUntilClean(
            testCases,
            testModel.testModel,
            requirements,
            2  // Макс. 2 итерации (быстро!)
        );
        testCases = llmValidationResult.testCases;
        console.log(`[DEBUG] ✅ LLM исправил: ${llmValidationResult.totalFixedErrors} враков\n`);

        console.log('[DEBUG] Шаг 2.6: Валидация по жёстким JSON Schema...');
        const schemaValidation = validateTestCases(testCases);
        if (!schemaValidation.valid) {
            console.log(`[DEBUG] ⚠️  Schema ошибок: ${schemaValidation.totalErrors} в ${schemaValidation.failedTests.length} тестах`);
            schemaValidation.failedTests.slice(0, 3).forEach((failed, idx) => {
                console.log(`  ${idx + 1}. [${failed.layer}] ${failed.title}:`);
                failed.errors.slice(0, 2).forEach(err => {
                    console.log(`     - ${err}`);
                });
            });
            console.log('');
        } else {
            console.log(`[DEBUG] ✅ Все тест-кейсы прошли Schema валидацию\n`);
        }

        // ═══════════════════════════════════════════════════════════════

        // Шаг 3: Валидация и сравнение
        console.log('[DEBUG] Шаг 3: Валидация результатов (старая система)...');
        const comparison = compareWithReference({
            testModel: testModel.testModel,
            testCases
        });
        
        // Добавляем результаты V2 валидации в comparison
        comparison.v2Validation = {
            apiSpec,
            blacklistErrors,
            schemaValidation
        };

        // Шаг 4: Анализ и рекомендации
        console.log('[DEBUG] Шаг 4: Анализ результатов...\n');
        const analysis = analyzeResults(comparison);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`📊 РЕЗУЛЬТАТЫ (за ${duration} сек)`);
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Score: ${analysis.score}/100 ${analysis.score >= 80 ? '✅' : '❌'}`);
        console.log(`Тестовая модель: ${comparison.modelValidation.errors.length} ошибок, ${comparison.modelValidation.warnings.length} предупреждений`);
        console.log(`Тест-кейсы: ${comparison.casesValidation.errors.length} ошибок, ${comparison.casesValidation.warnings.length} предупреждений`);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('🆕 V2 ВАЛИДАЦИЯ:');
        console.log(`   API эндпоинтов: ${comparison.v2Validation.apiSpec.endpoints.length}`);
        console.log(`   Выдуманных вещей (блэклист): ${comparison.v2Validation.blacklistErrors.length} ${comparison.v2Validation.blacklistErrors.length === 0 ? '✅' : '❌'}`);
        console.log(`   Schema ошибок: ${comparison.v2Validation.schemaValidation.totalErrors} ${comparison.v2Validation.schemaValidation.valid ? '✅' : '❌'}`);
        console.log('───────────────────────────────────────────────────────────────');
        console.log(`Требуется улучшение: ${analysis.needsImprovement ? 'ДА ❌' : 'НЕТ ✅'}`);
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');

        // 🔥 УЛУЧШЕННОЕ ЛОГИРОВАНИЕ: 5 примеров ошибок с текущим/правильным значением
        const modelExamples = comparison.modelValidation.errorExamples || [];
        const casesExamples = comparison.casesValidation.errorExamples || [];
        const allExamples = [...modelExamples, ...casesExamples].slice(0, 5);

        if (allExamples.length > 0) {
            console.log('🔍 ПРИМЕРЫ ОШИБОК (первые 5):');
            console.log('');
            allExamples.forEach((example, idx) => {
                console.log(`${idx + 1}. [${example.type}] ${example.location}`);
                console.log(`   ❌ ТЕКУЩЕЕ: "${example.current.substring(0, 100)}${example.current.length > 100 ? '...' : ''}"`);
                console.log(`   ⚠️  ПРОБЛЕМА: ${example.problem}`);
                console.log(`   ✅ ПРАВИЛЬНО: "${example.correct.substring(0, 100)}${example.correct.length > 100 ? '...' : ''}"`);
                console.log(`   🔧 ГДЕ ПРАВИТЬ: ${example.fix}`);
                console.log('');
            });
        }

        // 🎯 ТОП-3 ПРИОРИТЕТНЫХ ИСПРАВЛЕНИЯ
        const criticalSuggestions = analysis.suggestions
            .filter(s => s.priority === 'high' || s.priority === 'critical')
            .slice(0, 3);

        if (criticalSuggestions.length > 0) {
            console.log('🎯 ТОП-3 ПРИОРИТЕТНЫХ ИСПРАВЛЕНИЯ:');
            console.log('');
            criticalSuggestions.forEach((suggestion, idx) => {
                console.log(`${idx + 1}. [${suggestion.priority.toUpperCase()}] ${suggestion.type}`);
                console.log(`   📝 ${suggestion.recommendation.split('\n')[0]}`);
                console.log(`   📊 Проблем: ${suggestion.issues.length}`);
                console.log('');
            });
        }

        if (analysis.suggestions.length > 0) {
            console.log('───────────────────────────────────────────────────────────────');
            console.log('💡 ПОЛНЫЙ СПИСОК РЕКОМЕНДАЦИЙ:');
            console.log('');
            analysis.suggestions.forEach((suggestion, idx) => {
                console.log(`${idx + 1}. [${suggestion.priority.toUpperCase()}] ${suggestion.type}`);
                console.log(`   ${suggestion.recommendation.substring(0, 150)}${suggestion.recommendation.length > 150 ? '...' : ''}`);
                if (suggestion.issues.length > 0 && suggestion.issues.length <= 3) {
                    suggestion.issues.forEach(issue => {
                        console.log(`   - ${issue.substring(0, 100)}${issue.length > 100 ? '...' : ''}`);
                    });
                } else if (suggestion.issues.length > 3) {
                    console.log(`   (${suggestion.issues.length} проблем - см. детали выше)`);
                }
                console.log('');
            });
        }

        return {
            success: !analysis.needsImprovement,
            score: analysis.score,
            testModel: testModel.testModel,
            testCases,
            comparison,
            analysis,
            duration
        };

    } catch (error) {
        console.error('[DEBUG] ❌ ОШИБКА:', error.message);
        throw error;
    }
}


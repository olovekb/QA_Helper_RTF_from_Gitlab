/**
 * НОВАЯ ВЕРСИЯ ГЕНЕРАТОРА ТЕСТ-КЕЙСОВ (V2)
 * С архитектурными улучшениями:
 * 1. Жёсткие JSON Schema для каждого слоя
 * 2. API-DSL парсер для валидации
 * 3. Агрессивный нормализатор/auto-fix
 * 4. Многофазная генерация (E2E → Integration → Unit)
 * 5. Ревью-агент (self-critique)
 */

import { validateTestCases } from './schemas/test-case-schemas.mjs';
import { parseAPISpecification, validateCodeAgainstAPISpec, formatAPISpecForPrompt } from './parsers/api-spec-parser.mjs';
import { normalizeTestCases, generateUnitTestsForAllFrontendCodes, splitCompositeCodesInModel } from './normalizers/test-case-normalizer.mjs';
import { reviewTestCases, mergeReviewResults } from './agents/review-agent.mjs';
import { planPhases, updatePhaseContext, buildPhasePrompt } from './generators/multi-phase-generator.mjs';
import { runInteractiveLLM } from './interactiveLLM.mjs';
import { buildSubmitCasesToolStrict } from './testCaseToolBuilder.mjs';
import { extractRequirementsStructure } from './requirementsExtractor.mjs';

/**
 * ГЛАВНАЯ ФУНКЦИЯ - Новая версия генератора с полной архитектурой
 * @param {object} params - Параметры генерации
 * @returns {Promise<object>} Результат с testCases и testModel
 */
export async function generateTestCasesV2(params) {
    const {
        requirements,
        testModel,
        projectId = null,
        skipAllureAPICalls = false,
        sharedSteps = [],
        onProgress = null
    } = params;

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🚀 ЗАПУСК НОВОЙ ВЕРСИИ ГЕНЕРАТОРА (V2)');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const startTime = Date.now();
    let currentProgress = 0;

    function updateProgress(progress, message) {
        currentProgress = progress;
        console.log(`[${progress}%] ${message}`);
        if (onProgress) {
            onProgress({ progress, message });
        }
    }

    try {
        // ═══════════════════════════════════════════════════════════════
        // ШАГ 1: ПАРСИНГ API СПЕЦИФИКАЦИИ
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(5, '🔍 Парсинг API спецификации из требований...');
        const apiSpec = parseAPISpecification(requirements);
        
        console.log(`[API-DSL] Найдено эндпоинтов: ${apiSpec.endpoints.length}`);
        if (apiSpec.errors.length > 0) {
            console.warn(`[API-DSL] Предупреждения: ${apiSpec.errors.join(', ')}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 2: РАЗДЕЛЕНИЕ СОСТАВНЫХ CODES В МОДЕЛИ
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(10, '✂️ Разделение составных Codes на атомарные...');
        const cleanedModel = splitCompositeCodesInModel(testModel);

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 3: ВАЛИДАЦИЯ MODEL ПРОТИВ API SPEC
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(15, '✅ Валидация Codes против API спецификации...');
        const modelValidation = validateModelCodesAgainstAPI(cleanedModel, apiSpec);
        
        if (modelValidation.errors.length > 0) {
            console.warn('[MODEL VALIDATION] Найдены выдуманные API:');
            modelValidation.errors.forEach((err, idx) => {
                console.warn(`  ${idx + 1}. ${err}`);
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 4: МНОГОФАЗНАЯ ГЕНЕРАЦИЯ (E2E → Integration → Unit)
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(20, '🔄 Планирование фаз генерации...');
        const phases = planPhases({
            testModel: cleanedModel,
            requirements,
            apiSpec,
            sharedSteps
        });

        let allTestCases = [];
        const phaseResults = [];

        for (let i = 0; i < phases.length; i++) {
            const phase = phases[i];
            const phaseProgress = 20 + (i / phases.length) * 50; // 20% → 70%
            
            updateProgress(phaseProgress, `📝 Фаза ${i + 1}/${phases.length}: ${phase.description}`);
            
            // Обновляем контекст фазы на основе предыдущих результатов
            updatePhaseContext(phases, i, phaseResults);
            
            // Генерируем тест-кейсы для этой фазы
            const phaseCases = await generatePhaseTestCases(phase, cleanedModel, requirements, apiSpec);
            
            phaseResults.push(phaseCases);
            allTestCases.push(...phaseCases);
            
            console.log(`[PHASE ${i + 1}] Сгенерировано ${phaseCases.length} тест-кейсов`);
        }

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 5: АВТОМАТИЧЕСКАЯ ГЕНЕРАЦИЯ UNIT ТЕСТОВ ДЛЯ ВСЕХ FRONTEND CODES
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(70, '🧩 Генерация Unit тестов для всех frontend Codes...');
        const autoUnitTests = generateUnitTestsForAllFrontendCodes(cleanedModel);
        
        console.log(`[AUTO-UNIT] Сгенерировано ${autoUnitTests.length} Unit тестов`);
        allTestCases.push(...autoUnitTests);

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 6: АГРЕССИВНАЯ НОРМАЛИЗАЦИЯ
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(75, '⚙️ Агрессивная нормализация тест-кейсов...');
        const normalized = normalizeTestCases(allTestCases, {
            testModel: cleanedModel,
            apiSpec
        });

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 7: ВАЛИДАЦИЯ ПО JSON SCHEMA
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(80, '🔍 Валидация по жёстким JSON Schema...');
        const validationResult = validateTestCases(normalized);
        
        if (!validationResult.valid) {
            console.warn(`[SCHEMA VALIDATION] Найдено ${validationResult.totalErrors} ошибок в ${validationResult.failedTests.length} тест-кейсах`);
            
            // Выводим первые 5 ошибок
            validationResult.failedTests.slice(0, 5).forEach((failed, idx) => {
                console.warn(`  ${idx + 1}. [${failed.layer}] ${failed.title}:`);
                failed.errors.slice(0, 3).forEach(err => {
                    console.warn(`     - ${err}`);
                });
            });
        } else {
            console.log('[SCHEMA VALIDATION] ✅ Все тест-кейсы прошли валидацию!');
        }

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 8: РЕВЬЮ-АГЕНТ (Self-Critique)
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(85, '🔍 Запуск ревью-агента (self-critique)...');
        const reviewResult = await reviewTestCases(normalized, cleanedModel, requirements, apiSpec);
        
        if (reviewResult.statistics.totalIssues > 0) {
            console.log('[REVIEW-AGENT] Найдено проблем:', reviewResult.statistics.totalIssues);
            console.log('[REVIEW-AGENT] Критических:', reviewResult.statistics.criticalIssues);
            console.log('[REVIEW-AGENT] Исправлено автоматически:', reviewResult.statistics.fixedAutomatically);
            console.log('[REVIEW-AGENT] Добавлено Unit тестов:', reviewResult.additionalUnitTests.length);
        }

        // Объединяем результаты ревью
        const finalTestCases = mergeReviewResults(normalized, reviewResult);

        // ═══════════════════════════════════════════════════════════════
        // ШАГ 9: ФИНАЛЬНАЯ ВАЛИДАЦИЯ
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(95, '✅ Финальная валидация...');
        const finalValidation = validateTestCases(finalTestCases);
        
        if (!finalValidation.valid) {
            console.error('[FINAL VALIDATION] ❌ Осталось ошибок:', finalValidation.totalErrors);
        } else {
            console.log('[FINAL VALIDATION] ✅ Все тест-кейсы валидны!');
        }

        // ═══════════════════════════════════════════════════════════════
        // ФИНАЛ: СТАТИСТИКА
        // ═══════════════════════════════════════════════════════════════
        
        updateProgress(100, '✅ Генерация завершена!');
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        const statistics = {
            totalTestCases: finalTestCases.length,
            byLayer: countByLayer(finalTestCases),
            apiEndpoints: apiSpec.endpoints.length,
            frontendCodes: countFrontendCodes(cleanedModel),
            unitTestsGenerated: autoUnitTests.length,
            schemaErrors: finalValidation.totalErrors,
            reviewIssues: reviewResult.statistics.totalIssues,
            duration: `${duration.toFixed(1)}s`
        };

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('📊 СТАТИСТИКА ГЕНЕРАЦИИ:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`⏱️  Время: ${statistics.duration}`);
        console.log(`📝 Всего тест-кейсов: ${statistics.totalTestCases}`);
        console.log(`   - E2E: ${statistics.byLayer['E2E Tests'] || 0}`);
        console.log(`   - Integration Frontend: ${statistics.byLayer['Integration frontend Tests'] || 0}`);
        console.log(`   - Integration Backend: ${statistics.byLayer['Integration backend Tests'] || 0}`);
        console.log(`   - Unit Frontend: ${statistics.byLayer['Unit frontend Tests'] || 0}`);
        console.log(`🔧 API Эндпоинтов: ${statistics.apiEndpoints}`);
        console.log(`🧩 Frontend Кодов: ${statistics.frontendCodes}`);
        console.log(`🤖 Auto-генерировано Unit: ${statistics.unitTestsGenerated}`);
        console.log(`⚠️  Ошибок Schema: ${statistics.schemaErrors}`);
        console.log(`🔍 Проблем от ревью-агента: ${statistics.reviewIssues}`);
        console.log('═══════════════════════════════════════════════════════════════\n');

        return {
            testCases: finalTestCases,
            testModel: cleanedModel,
            statistics,
            validationResult: finalValidation,
            reviewResult,
            apiSpec
        };

    } catch (error) {
        console.error('[generateTestCasesV2] ❌ КРИТИЧЕСКАЯ ОШИБКА:', error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════

/**
 * Валидирует все Codes в модели против API спецификации
 */
function validateModelCodesAgainstAPI(testModel, apiSpec) {
    const errors = [];
    const warnings = [];

    for (const feature of testModel) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                for (const code of scenario.codes || []) {
                    const validation = validateCodeAgainstAPISpec(code.text, apiSpec);
                    
                    if (!validation.valid) {
                        errors.push(...validation.errors.map(e => `[${scenario.text}] ${e}`));
                    }
                    
                    if (validation.warnings.length > 0) {
                        warnings.push(...validation.warnings.map(w => `[${scenario.text}] ${w}`));
                    }
                }
            }
        }
    }

    return { errors, warnings };
}

/**
 * Генерирует тест-кейсы для конкретной фазы
 */
async function generatePhaseTestCases(phase, testModel, requirements, apiSpec) {
    try {
        // Строим промпт для этой фазы
        const systemPrompt = buildPhasePrompt(phase, phase.context);
        
        // TODO: Вызов LLM для генерации
        // const result = await runInteractiveLLM({...});
        
        // ЗАГЛУШКА: возвращаем пустой массив
        // В реальной реализации здесь будет вызов LLM
        console.log(`[generatePhaseTestCases] Фаза ${phase.name} - промпт готов (${systemPrompt.length} символов)`);
        
        return [];
        
    } catch (error) {
        console.error(`[generatePhaseTestCases] Ошибка в фазе ${phase.name}:`, error);
        return [];
    }
}

/**
 * Подсчитывает тест-кейсы по слоям
 */
function countByLayer(testCases) {
    const counts = {};
    for (const tc of testCases) {
        counts[tc.layer] = (counts[tc.layer] || 0) + 1;
    }
    return counts;
}

/**
 * Подсчитывает frontend коды в модели
 */
function countFrontendCodes(testModel) {
    let count = 0;
    for (const feature of testModel) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                for (const code of scenario.codes || []) {
                    if (code.type === 'frontend') {
                        count++;
                    }
                }
            }
        }
    }
    return count;
}


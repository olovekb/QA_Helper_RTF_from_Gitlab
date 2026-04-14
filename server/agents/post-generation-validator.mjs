/**
 * LLM-валидатор для проверки и исправления тест-кейсов после генерации
 * 
 * Проверяет:
 * - Враки (придуманные данные не из требований)
 * - Неправильные шаги (структура, дубли)
 * - Несоответствие стайл-гайду
 */

import { callCloudRuAPI } from '../cloudruClient.mjs';

/**
 * Нормализует тест-кейсы для сериализации (исправляет shared steps и другие объекты)
 */
function normalizeTestCasesForSerialization(testCases) {
    return testCases.map(tc => {
        const normalized = { ...tc };
        
        // Нормализуем шаги: объекты {sharedStepId: X} или "[object Object]" → строки
        if (Array.isArray(normalized.steps)) {
            normalized.steps = normalized.steps.map(step => {
                // Если это объект с sharedStepId
                if (typeof step === 'object' && step !== null && step.sharedStepId) {
                    return `[Shared Step ID: ${step.sharedStepId}]`;
                }
                // Если это строка "[object Object]" или другой некорректный объект
                if (typeof step === 'object' && step !== null) {
                    // Пытаемся извлечь полезную информацию
                    if (step.text) return step.text;
                    if (step.sharedStepId) return `[Shared Step ID: ${step.sharedStepId}]`;
                    return `[Invalid step object]`;
                }
                // Если это уже строка
                if (typeof step === 'string') {
                    // Исправляем "[object Object]"
                    if (step === '[object Object]') {
                        return '[Invalid step - object not serialized]';
                    }
                    return step;
                }
                return String(step);
            });
        }
        
        return normalized;
    });
}

/**
 * Создает промпт для валидации тест-кейсов (ТОЛЬКО ВРАКИ)
 */
function buildValidationPrompt(testCases, testModel, requirements) {
    // Нормализуем тест-кейсы перед сериализацией
    const normalizedTestCases = normalizeTestCasesForSerialization(testCases);
    
    return `Ты — экспертный валидатор тест-кейсов. Твоя задача: найти и ИСПРАВИТЬ ТОЛЬКО "враки" (придуманные данные, которых нет в требованиях).

═══════════════════════════════════════════════════════════════
📋 ТРЕБОВАНИЯ (ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ!)
═══════════════════════════════════════════════════════════════
${requirements}

═══════════════════════════════════════════════════════════════
🎯 ФОКУС: ТОЛЬКО ВРАКИ (HALLUCINATIONS)
═══════════════════════════════════════════════════════════════

🚨 КРИТИЧНО: Проверяй ТОЛЬКО наличие "враков" - придуманных данных, которых НЕТ в требованиях!

**ЧТО ЯВЛЯЕТСЯ ВРАКОМ:**
1. API endpoints, которых НЕТ в требованиях
   - ❌ Если в требованиях есть только GET /api/v1/images/categories, а в тесте используется GET /api/v1/images/search → ВРАК!
   - ❌ Если в требованиях НЕТ query-параметра ?search=, а в тесте он используется → ВРАК!

2. JSON поля, которых НЕТ в требованиях
   - ❌ Если в требованиях ответ категорий: [{id, name}], а в тесте ожидается [{id, name, count}] → ВРАК! (count нет в требованиях)
   - ❌ Если в требованиях НЕТ поля "errorCode", а в тесте оно используется → ВРАК!

3. UI элементы, кнопки, поля, которых НЕТ в требованиях
   - ❌ Если в требованиях НЕТ кнопки "Применить фильтр", а в тесте она используется → ВРАК!
   - ❌ Если в требованиях НЕТ поля "Комментарий", а в тесте оно используется → ВРАК!

4. Значения (форматы, размеры, фильтры), которых НЕТ в требованиях
   - ❌ Если в требованиях фильтры: "Чёрно-белый", "Сепия", "Винтаж", а в тесте используется "Карандаш" → ВРАК!
   - ❌ Если в требованиях форматы: PNG, JPG, JPEG, GIF, а в тесте используется PDF → ВРАК!
   - ❌ Если в требованиях НЕТ сообщения "Некорректные параметры", а в тесте оно используется → ВРАК!

5. Шаги, которые описывают действия, которых НЕТ в требованиях
   - ❌ Если в требованиях НЕТ шага "Применить несуществующий фильтр", а в тесте он есть → ВРАК!
   - ❌ Если в требованиях НЕТ шага "Проверить права доступа", а в тесте он есть → ВРАК!

**ЧТО НЕ ЯВЛЯЕТСЯ ВРАКОМ (НЕ ТРОГАЙ!):**
- ✅ Структура тест-кейса (title, steps, expected) - НЕ меняй, если нет враков!
- ✅ Precondition - НЕ меняй, если нет враков!
- ✅ Параметризация - НЕ меняй, если нет враков!
- ✅ Порядок шагов - НЕ меняй, если нет враков!
- ✅ Форматирование - НЕ меняй, если нет враков!

═══════════════════════════════════════════════════════════════
📊 ТЕСТ-КЕЙСЫ ДЛЯ ВАЛИДАЦИИ:
═══════════════════════════════════════════════════════════════
${JSON.stringify(normalizedTestCases, null, 2)}

═══════════════════════════════════════════════════════════════
🛠️ ФОРМАТ ОТВЕТА:
═══════════════════════════════════════════════════════════════
Верни JSON объект:
{
  "hasErrors": boolean,
  "errors": [
    {
      "testCaseId": "tc-xxx",
      "type": "vraki",
      "description": "Описание врака (что придумано, чего нет в требованиях)",
      "field": "steps" | "expected" | "title" | "parameters",
      "currentValue": "Текущее значение с враком",
      "suggestedFix": "Исправленное значение БЕЗ врака (или null, если нужно удалить)"
    }
  ],
  "fixes": [
    {
      "testCaseId": "tc-xxx",
      "field": "steps" | "expected" | "title",
      "oldValue": "Текущее значение с враком",
      "newValue": "Исправленное значение БЕЗ врака"
    }
  ],
  "summary": "Краткое резюме найденных враков"
}

🚨 КРИТИЧЕСКИ ВАЖНО:
- Фокус ТОЛЬКО на враках! НЕ меняй структуру, если нет враков!
- Выборочно исправляй ТОЛЬКО те части, где есть враки!
- Если в тест-кейсе НЕТ враков → НЕ трогай его вообще!
- Если врак в одном шаге → исправь ТОЛЬКО этот шаг, остальные не трогай!
- Если врак в expected → исправь ТОЛЬКО expected, остальное не трогай!
- Если врак в title → исправь ТОЛЬКО title, остальное не трогай!
- Если врак нельзя исправить (нет аналога в требованиях) → удали ТОЛЬКО проблемную часть или весь тест-кейс!

🚨 НЕ ДЕЛАЙ:
- ❌ НЕ меняй precondition, если нет враков!
- ❌ НЕ меняй порядок шагов, если нет враков!
- ❌ НЕ удаляй тест-кейсы, если в них нет враков!
- ❌ НЕ объединяй тест-кейсы, если нет враков!
- ❌ НЕ меняй параметризацию, если нет враков!
`;
}

/**
 * Применяет исправления к тест-кейсам (ТОЛЬКО ВРАКИ)
 * Выборочно исправляет только проблемные части, не меняя структуру
 */
function applyFixes(testCases, fixes, removals = []) {
    let fixed = [...testCases]; // Копируем массив, чтобы не менять оригинал
    
    // Сначала удаляем тест-кейсы, помеченные для удаления (только если враки критичны)
    if (removals.length > 0) {
        const idsToRemove = new Set(removals.map(r => r.testCaseId));
        fixed = fixed.filter(tc => !idsToRemove.has(tc.id));
        console.log(`[POST-GEN VALIDATOR] 🗑️  Удалено ${removals.length} тест-кейсов с критичными враками:`);
        removals.forEach(removal => {
            console.log(`   - ${removal.testCaseId}: ${removal.reason}`);
        });
    }
    
    // Затем применяем выборочные исправления (ТОЛЬКО проблемные части)
    for (const fix of fixes) {
        const tcIndex = fixed.findIndex(tc => tc.id === fix.testCaseId);
        if (tcIndex === -1) continue;
        
        const tc = fixed[tcIndex];
        
        switch (fix.field) {
            case 'steps':
                // Выборочно исправляем шаги: заменяем только те, где есть враки
                if (Array.isArray(fix.newValue)) {
                    // Если newValue - массив, заменяем весь массив (но только если есть враки)
                    tc.steps = fix.newValue;
                    console.log(`[POST-GEN VALIDATOR] ✅ Исправлены шаги в ${fix.testCaseId}: удалены враки`);
                } else if (typeof fix.newValue === 'string') {
                    // Если newValue - строка, это исправление одного шага
                    // Находим и заменяем только проблемный шаг
                    const oldStepIndex = tc.steps.findIndex(s => s === fix.oldValue);
                    if (oldStepIndex !== -1) {
                        tc.steps[oldStepIndex] = fix.newValue;
                        console.log(`[POST-GEN VALIDATOR] ✅ Исправлен шаг ${oldStepIndex + 1} в ${fix.testCaseId}: "${fix.oldValue}" → "${fix.newValue}"`);
                    }
                }
                break;
            case 'expected':
                // Исправляем expected, если там есть враки
                tc.expected = fix.newValue;
                console.log(`[POST-GEN VALIDATOR] ✅ Исправлен expected в ${fix.testCaseId}: "${fix.oldValue}" → "${fix.newValue}"`);
                break;
            case 'title':
                // Исправляем title, если там есть враки
                tc.title = fix.newValue;
                console.log(`[POST-GEN VALIDATOR] ✅ Исправлен title в ${fix.testCaseId}: "${fix.oldValue}" → "${fix.newValue}"`);
                break;
            // НЕ трогаем precondition, parameters и другие поля, если нет явного указания
        }
    }
    
    return fixed;
}

/**
 * Основная функция валидации и исправления
 */
export async function validateAndFixTestCases(testCases, testModel, requirements) {
    console.log(`\n[POST-GEN VALIDATOR] ═══════════════════════════════════════`);
    console.log(`[POST-GEN VALIDATOR] 🔍 Валидация ${testCases.length} тест-кейсов через LLM...`);
    
    const prompt = buildValidationPrompt(testCases, testModel, requirements);
    
    try {
        const startTime = Date.now();
        
        // Вызываем LLM для валидации
        // ПРАВИЛЬНЫЙ формат: callCloudRuAPI(messages, opts)
        const messages = [
            {
                role: 'system',
                content: 'Ты — экспертный валидатор тест-кейсов. Находишь и исправляешь ошибки быстро и точно.'
            },
            {
                role: 'user',
                content: prompt
            }
        ];
        
        const response = await callCloudRuAPI(messages, {
            temperature: 0.1,  // Низкая температура для точности
            max_tokens: 8000,
            response_format: {
                type: 'json_object'
            }
        });
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[POST-GEN VALIDATOR] ⏱️ Валидация завершена за ${duration}s`);
        
        if (!response || !response.choices || !response.choices[0]) {
            throw new Error('Пустой ответ от LLM');
        }
        
        const validationResult = JSON.parse(response.choices[0].message.content);
        
        console.log(`[POST-GEN VALIDATOR] 📊 Результат (ТОЛЬКО ВРАКИ):`);
        console.log(`[POST-GEN VALIDATOR]    - Найдено враков: ${validationResult.errors?.length || 0}`);
        console.log(`[POST-GEN VALIDATOR]    - Предложено исправлений: ${validationResult.fixes?.length || 0}`);
        console.log(`[POST-GEN VALIDATOR]    - Тест-кейсов к удалению: ${validationResult.removals?.length || 0}`);
        
        if (validationResult.hasErrors && validationResult.errors?.length > 0) {
            console.log(`\n[POST-GEN VALIDATOR] 🚨 НАЙДЕННЫЕ ВРАКИ:`);
            validationResult.errors.slice(0, 5).forEach((err, idx) => {
                console.log(`  ${idx + 1}. [${err.type}] ${err.testCaseId} (${err.field}):`);
                console.log(`     ${err.description}`);
                console.log(`     Текущее: "${err.currentValue}"`);
                console.log(`     Исправить на: "${err.suggestedFix || 'удалить'}"`);
            });
            
            if (validationResult.errors.length > 5) {
                console.log(`  ... и еще ${validationResult.errors.length - 5} враков`);
            }
        }
        
        // Применяем исправления и удаления
        let fixedTestCases = testCases;
        const hasFixes = validationResult.fixes && validationResult.fixes.length > 0;
        const hasRemovals = validationResult.removals && validationResult.removals.length > 0;
        
        if (hasFixes || hasRemovals) {
            fixedTestCases = applyFixes(
                testCases, 
                validationResult.fixes || [], 
                validationResult.removals || []
            );
            if (hasFixes) {
                console.log(`\n[POST-GEN VALIDATOR] ✅ Применено ${validationResult.fixes.length} исправлений`);
            }
        }
        
        console.log(`[POST-GEN VALIDATOR] 📝 ${validationResult.summary || 'Валидация завершена'}`);
        console.log(`[POST-GEN VALIDATOR] ═══════════════════════════════════════\n`);
        
        return {
            testCases: fixedTestCases,
            validationResult,
            hasErrors: validationResult.hasErrors,
            errorCount: validationResult.errors?.length || 0,
            fixCount: validationResult.fixes?.length || 0
        };
        
    } catch (error) {
        console.error(`[POST-GEN VALIDATOR] ❌ Ошибка валидации:`, error.message);
        return {
            testCases,  // Возвращаем оригинальные тест-кейсы
            validationResult: null,
            hasErrors: false,
            errorCount: 0,
            fixCount: 0,
            error: error.message
        };
    }
}

/**
 * Итеративная валидация с повторными попытками (ТОЛЬКО ВРАКИ)
 * Выборочно исправляет только проблемные части, не меняя структуру
 */
export async function validateUntilClean(testCases, testModel, requirements, maxIterations = 2) {
    console.log(`\n[POST-GEN VALIDATOR] 🔄 Итеративная валидация ВРАКОВ (макс. ${maxIterations} итераций)...`);
    console.log(`[POST-GEN VALIDATOR] 🎯 Фокус: ТОЛЬКО враки, структура НЕ меняется!`);
    
    let currentTestCases = testCases;
    let totalFixedErrors = 0;
    
    for (let i = 1; i <= maxIterations; i++) {
        console.log(`\n[POST-GEN VALIDATOR] 🔄 Итерация ${i}/${maxIterations} (поиск враков)...`);
        
        const result = await validateAndFixTestCases(currentTestCases, testModel, requirements);
        
        currentTestCases = result.testCases;
        totalFixedErrors += result.fixCount;
        
        // Если враков не найдено или LLM не смог помочь - выходим
        if (!result.hasErrors || result.fixCount === 0) {
            console.log(`[POST-GEN VALIDATOR] ✅ Валидация завершена! Всего исправлено враков: ${totalFixedErrors}`);
            break;
        }
        
        if (i < maxIterations) {
            console.log(`[POST-GEN VALIDATOR] ⚠️ Остались враки, запускаю повторную валидацию...`);
        }
    }
    
    return {
        testCases: currentTestCases,
        totalFixedErrors
    };
}


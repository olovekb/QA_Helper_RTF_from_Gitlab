/**
 * Ревью-агент (Self-Critique Agent)
 * Выполняет второй проход по сгенерированным тест-кейсам
 * и исправляет типичные ошибки
 */

import { callWithCloudRuFallback } from '../cloudruClient.mjs';
import config from '../config.json' assert { type: 'json' };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ═══════════════════════════════════════════════════════════════
// ПРОМПТ ДЛЯ РЕВЬЮ-АГЕНТА
// ═══════════════════════════════════════════════════════════════

const REVIEW_AGENT_PROMPT = `
Ты — Senior SDET Code Reviewer с 10+ годами опыта.

Твоя задача: проверить сгенерированные тест-кейсы и тестовую модель на соответствие СТРОГИМ стандартам качества.

═══════════════════════════════════════════════════════════════
🎯 КРИТЕРИИ ПРОВЕРКИ
═══════════════════════════════════════════════════════════════

### 1. ТЕСТОВАЯ МОДЕЛЬ:

**Scenario:**
✅ ПРАВИЛЬНО: "1. Нажать кнопку 'Найти изображение'" - одно атомарное действие
❌ НЕПРАВИЛЬНО: "Открыть окно, выбрать категорию и отфильтровать" - это 3 действия! РАЗДЕЛИ!
❌ ЗАПРЕЩЕНО: "Попытаться...", "Дождаться...", "Проверить...", "Применить..." - это НЕ действия!

**Code:**
✅ ПРАВИЛЬНО: ОДИН Code = ОДНО действие (запрос ИЛИ ответ ИЛИ UI)
❌ НЕПРАВИЛЬНО: "GET /api/..., Возвращается 200 OK, Отобразить список" - это 3 действия! РАЗДЕЛИ!
✅ ПРАВИЛЬНО: Эндпоинты ЖИРНЫМ: GET **/api/v1/images/categories**
❌ НЕПРАВИЛЬНО: Эндпоинты БЕЗ жирного: GET /api/v1/images/categories

### 2. ТЕСТ-КЕЙСЫ:

**Обязательные поля:**
✅ Каждый тест ОБЯЗАН иметь: id, version, priority, tags, precondition
❌ Если поле отсутствует - это КРИТИЧЕСКАЯ ошибка!

**Expected Result:**
✅ ПРАВИЛЬНО: "**Отображается** список категорий" - жирное ключевое слово
❌ НЕПРАВИЛЬНО: "Отображается список" - НЕТ жирного выделения!
❌ ЗАПРЕЩЕНО: "**Обновляется**", "**Удаляется**" - используй "**Отображается** обновлённое"

**По слоям:**
- E2E: НЕ должен иметь scenario и code, НЕ должен содержать HTTP-методы в steps
- Integration Frontend: ОБЯЗАН иметь scenario, НЕ должен содержать HTTP-методы
- Integration Backend: ОБЯЗАН иметь scenario, steps ОБЯЗАТЕЛЬНО с "Выполнить GET/POST **/api/...**"
- Unit Frontend: ОБЯЗАН иметь scenario и code, title начинается с "Unit:"

### 3. API ВАЛИДАЦИЯ:

✅ Все API эндпоинты должны быть из требований
❌ Если эндпоинт НЕ из требований - это ВЫДУМКА! УДАЛИ!

### 4. ПОКРЫТИЕ:

✅ Для КАЖДОГО Code с type="frontend" должен быть 1 Unit тест
❌ Если Unit тестов меньше, чем frontend кодов - создай недостающие!

═══════════════════════════════════════════════════════════════
📋 ИНСТРУКЦИЯ
═══════════════════════════════════════════════════════════════

1. Проанализируй ВСЕ тест-кейсы и модель
2. Найди ВСЕ ошибки и несоответствия
3. Исправь ошибки и верни исправленные тест-кейсы

Верни ТОЛЬКО JSON в формате:
{
  "issues": [
    {"severity": "critical"|"warning", "testId": "...", "field": "...", "problem": "...", "fix": "..."}
  ],
  "fixedTestCases": [массив исправленных тест-кейсов],
  "additionalUnitTests": [дополнительные Unit тесты, если их не хватает],
  "statistics": {
    "totalIssues": число,
    "criticalIssues": число,
    "fixedAutomatically": число
  }
}
`;

// ═══════════════════════════════════════════════════════════════
// ОСНОВНАЯ ФУНКЦИЯ РЕВЬЮ
// ═══════════════════════════════════════════════════════════════

/**
 * Выполняет ревью сгенерированных тест-кейсов
 * @param {object[]} testCases - Сгенерированные тест-кейсы
 * @param {object[]} testModel - Тестовая модель
 * @param {string} requirements - Исходные требования
 * @param {object} apiSpec - API спецификация
 * @returns {Promise<object>} Результат ревью с исправлениями
 */
export async function reviewTestCases(testCases, testModel, requirements, apiSpec) {
    console.log(`[reviewTestCases] 🔍 Запуск ревью для ${testCases.length} тест-кейсов...`);

    try {
        // Подготавливаем контекст для ревьюера
        const context = {
            testCases: testCases.map(tc => ({
                id: tc.id,
                title: tc.title,
                layer: tc.layer,
                scenario: tc.scenario,
                code: tc.code,
                steps: tc.steps,
                expected: tc.expected,
                tags: tc.tags,
                version: tc.version,
                priority: tc.priority,
                precondition: tc.precondition
            })),
            testModel: testModel.map(f => ({
                text: f.text,
                stories: f.stories.map(s => ({
                    text: s.text,
                    scenarios: s.scenarios.map(sc => ({
                        text: sc.text,
                        codes: sc.codes.map(c => ({ id: c.id, text: c.text, type: c.type }))
                    }))
                }))
            })),
            apiEndpoints: apiSpec.endpoints.map(e => `${e.method} ${e.url}`),
            statistics: {
                totalTestCases: testCases.length,
                byLayer: countByLayer(testCases),
                frontendCodesCount: countFrontendCodes(testModel),
                unitTestsCount: testCases.filter(tc => tc.layer === 'Unit frontend Tests').length
            }
        };

        // Формируем промпт
        const userPrompt = `
ТЕСТОВАЯ МОДЕЛЬ:
${JSON.stringify(context.testModel, null, 2)}

СГЕНЕРИРОВАННЫЕ ТЕСТ-КЕЙСЫ:
${JSON.stringify(context.testCases, null, 2)}

API ЭНДПОИНТЫ ИЗ ТРЕБОВАНИЙ:
${context.apiEndpoints.join('\n')}

СТАТИСТИКА:
- Всего тест-кейсов: ${context.statistics.totalTestCases}
- E2E: ${context.statistics.byLayer['E2E Tests'] || 0}
- Integration Frontend: ${context.statistics.byLayer['Integration frontend Tests'] || 0}
- Integration Backend: ${context.statistics.byLayer['Integration backend Tests'] || 0}
- Unit Frontend: ${context.statistics.byLayer['Unit frontend Tests'] || 0}
- Frontend кодов в модели: ${context.statistics.frontendCodesCount}

🚨 ПРОВЕРЬ И ИСПРАВЬ ВСЁ!
Верни ТОЛЬКО чистый JSON БЕЗ markdown.
`;

        // Вызываем LLM для ревью
        const response = await callWithCloudRuFallback(
            OPENROUTER_URL,
            [
                { role: 'system', content: REVIEW_AGENT_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            config.openRouterAiKey,
            {
                model: config.openrouterModel || 'google/gemini-2.0-flash-exp:free',
                temperature: 0.1,
                max_tokens: 15000
            }
        );

        const content = response.choices[0].message.content;
        
        // Парсим JSON ответ
        const reviewResult = parseReviewResponse(content);
        
        console.log(`[reviewTestCases] ✅ Ревью завершено:`);
        console.log(`  - Найдено проблем: ${reviewResult.statistics.totalIssues}`);
        console.log(`  - Критических: ${reviewResult.statistics.criticalIssues}`);
        console.log(`  - Исправлено автоматически: ${reviewResult.statistics.fixedAutomatically}`);
        console.log(`  - Добавлено Unit тестов: ${reviewResult.additionalUnitTests.length}`);

        return reviewResult;

    } catch (error) {
        console.error('[reviewTestCases] ❌ Ошибка ревью:', error);
        
        // Возвращаем исходные тест-кейсы без изменений
        return {
            issues: [],
            fixedTestCases: testCases,
            additionalUnitTests: [],
            statistics: {
                totalIssues: 0,
                criticalIssues: 0,
                fixedAutomatically: 0
            },
            error: error.message
        };
    }
}

/**
 * Парсит ответ ревью-агента
 */
function parseReviewResponse(content) {
    try {
        // Убираем markdown если есть
        let cleaned = content.trim();
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/```\n?/g, '');
        }

        const parsed = JSON.parse(cleaned);
        
        // Валидация структуры
        if (!parsed.issues) parsed.issues = [];
        if (!parsed.fixedTestCases) parsed.fixedTestCases = [];
        if (!parsed.additionalUnitTests) parsed.additionalUnitTests = [];
        if (!parsed.statistics) {
            parsed.statistics = {
                totalIssues: parsed.issues.length,
                criticalIssues: parsed.issues.filter(i => i.severity === 'critical').length,
                fixedAutomatically: parsed.fixedTestCases.length
            };
        }

        return parsed;

    } catch (error) {
        console.warn('[parseReviewResponse] Ошибка парсинга JSON:', error.message);
        
        // Возвращаем пустой результат
        return {
            issues: [],
            fixedTestCases: [],
            additionalUnitTests: [],
            statistics: {
                totalIssues: 0,
                criticalIssues: 0,
                fixedAutomatically: 0
            },
            parseError: error.message
        };
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

// ═══════════════════════════════════════════════════════════════
// МЕРДЖИНГ РЕЗУЛЬТАТОВ РЕВЬЮ
// ═══════════════════════════════════════════════════════════════

/**
 * Объединяет оригинальные и исправленные тест-кейсы
 * @param {object[]} originalTestCases - Оригинальные тест-кейсы
 * @param {object} reviewResult - Результат ревью
 * @returns {object[]} Финальные тест-кейсы
 */
export function mergeReviewResults(originalTestCases, reviewResult) {
    console.log('[mergeReviewResults] Объединение результатов ревью...');

    const finalTestCases = [];
    const fixedById = new Map();

    // Создаём мапу исправленных тест-кейсов
    for (const fixed of reviewResult.fixedTestCases) {
        if (fixed.id) {
            fixedById.set(fixed.id, fixed);
        }
    }

    // Объединяем
    for (const original of originalTestCases) {
        if (fixedById.has(original.id)) {
            // Используем исправленную версию
            finalTestCases.push(fixedById.get(original.id));
        } else {
            // Оставляем оригинальную
            finalTestCases.push(original);
        }
    }

    // Добавляем дополнительные Unit тесты
    if (reviewResult.additionalUnitTests && reviewResult.additionalUnitTests.length > 0) {
        finalTestCases.push(...reviewResult.additionalUnitTests);
        console.log(`[mergeReviewResults] ➕ Добавлено ${reviewResult.additionalUnitTests.length} дополнительных Unit тестов`);
    }

    console.log(`[mergeReviewResults] ✅ Финальное количество тест-кейсов: ${finalTestCases.length}`);

    return finalTestCases;
}


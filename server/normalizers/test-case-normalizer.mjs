/**
 * Агрессивный нормализатор тест-кейсов
 * Исправляет типичные ошибки LLM ПЕРЕД валидацией
 */

import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// НОРМАЛИЗАЦИЯ ОДНОГО ТЕСТ-КЕЙСА
// ═══════════════════════════════════════════════════════════════

/**
 * Агрессивно нормализует тест-кейс
 * @param {object} testCase - Исходный тест-кейс
 * @param {object} context - Контекст (testModel, apiSpec)
 * @returns {object} Нормализованный тест-кейс
 */
export function normalizeTestCase(testCase, context = {}) {
    const normalized = { ...testCase };
    const fixes = [];

    // ═══════════════════════════════════════════════════════════════
    // 1. ОБЯЗАТЕЛЬНЫЕ ПОЛЯ
    // ═══════════════════════════════════════════════════════════════
    
    if (!normalized.id) {
        normalized.id = uuidv4();
        fixes.push('Добавлен UUID');
    }

    if (!normalized.version) {
        normalized.version = 'stable';
        fixes.push('Добавлен version=stable');
    }

    if (!normalized.priority) {
        // Определяем priority по layer
        if (normalized.layer === 'E2E Tests') {
            normalized.priority = 'High';
        } else if (normalized.layer && normalized.layer.includes('Integration')) {
            normalized.priority = 'Medium';
        } else {
            normalized.priority = 'Medium';
        }
        fixes.push(`Добавлен priority=${normalized.priority}`);
    }

    if (!normalized.tags || normalized.tags.length === 0) {
        normalized.tags = ['D']; // Desktop по умолчанию
        fixes.push('Добавлены tags=[D]');
    }

    if (!normalized.precondition) {
        // Определяем precondition по layer
        if (normalized.layer === 'E2E Tests') {
            normalized.precondition = 'Пользователь не авторизован';
        } else if (normalized.layer === 'Integration frontend Tests') {
            normalized.precondition = 'Пользователь авторизован';
        } else if (normalized.layer === 'Integration backend Tests') {
            normalized.precondition = 'Сервер доступен';
        } else if (normalized.layer === 'Unit frontend Tests') {
            normalized.precondition = 'Компонент инициализирован';
        }
        fixes.push(`Добавлен precondition="${normalized.precondition}"`);
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. НОРМАЛИЗАЦИЯ STEPS
    // ═══════════════════════════════════════════════════════════════
    
    if (normalized.steps && Array.isArray(normalized.steps)) {
        normalized.steps = normalized.steps.map((step, idx) => {
            if (typeof step !== 'string') return step;
            
            let fixedStep = step;
            let stepFixes = [];

            // Убираем запрещённые слова
            if (fixedStep.match(/^Попытаться\s+/i)) {
                fixedStep = fixedStep.replace(/^Попытаться\s+/i, '');
                stepFixes.push('Удалено "Попытаться"');
            }

            if (fixedStep.match(/^Дождаться\s+/i)) {
                fixedStep = fixedStep.replace(/^Дождаться\s+/i, '');
                stepFixes.push('Удалено "Дождаться"');
            }

            if (fixedStep.match(/^Проверить\s+/i)) {
                fixedStep = fixedStep.replace(/^Проверить\s+/i, '');
                stepFixes.push('Удалено "Проверить"');
            }

            // Исправляем эндпоинты без жирного
            if (fixedStep.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s]+)/i)) {
                fixedStep = fixedStep.replace(
                    /(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s*]+)(?!\*\*)/gi,
                    '$1 **$2**'
                );
                stepFixes.push('Добавлено жирное выделение для эндпоинта');
            }

            if (stepFixes.length > 0) {
                fixes.push(`Step ${idx + 1}: ${stepFixes.join(', ')}`);
            }

            return fixedStep;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. НОРМАЛИЗАЦИЯ EXPECTED
    // ═══════════════════════════════════════════════════════════════
    
    if (normalized.expected && typeof normalized.expected === 'string') {
        let fixedExpected = normalized.expected;
        let expectedFixes = [];

        // Проверяем наличие жирного ключевого слова
        if (!fixedExpected.match(/^\*\*(Отображается|Возвращается|Скрывается|Создан|Удалён|Обновлён|Выполнено)\*\*/)) {
            // Пробуем найти ключевое слово без жирного
            const keywords = ['Отображается', 'Возвращается', 'Скрывается', 'Создан', 'Удалён', 'Обновлён', 'Выполнено'];
            
            for (const keyword of keywords) {
                const regex = new RegExp(`^${keyword}`, 'i');
                if (regex.test(fixedExpected)) {
                    fixedExpected = fixedExpected.replace(regex, `**${keyword}**`);
                    expectedFixes.push(`Добавлено жирное выделение для "${keyword}"`);
                    break;
                }
            }

            // Если не нашли, добавляем по умолчанию в зависимости от layer
            if (!fixedExpected.match(/^\*\*/)) {
                if (normalized.layer === 'Integration backend Tests') {
                    fixedExpected = `**Возвращается** ${fixedExpected}`;
                } else if (normalized.layer === 'Unit frontend Tests') {
                    fixedExpected = `**Выполнено** ${fixedExpected}`;
                } else {
                    fixedExpected = `**Отображается** ${fixedExpected}`;
                }
                expectedFixes.push('Добавлено ключевое слово с жирным');
            }
        }

        // Исправляем запрещённые глаголы
        if (fixedExpected.includes('**Обновляется**')) {
            fixedExpected = fixedExpected.replace('**Обновляется**', '**Отображается** обновлённое');
            expectedFixes.push('Заменено "Обновляется" на "Отображается обновлённое"');
        }

        if (fixedExpected.includes('**Удаляется**')) {
            fixedExpected = fixedExpected.replace('**Удаляется**', '**Отображается** пустой блок, элемент удалён');
            expectedFixes.push('Заменено "Удаляется" на "Отображается пустой блок"');
        }

        // Жирные эндпоинты в expected
        if (fixedExpected.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s]+)/i)) {
            fixedExpected = fixedExpected.replace(
                /(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s*]+)(?!\*\*)/gi,
                '$1 **$2**'
            );
            expectedFixes.push('Добавлено жирное для эндпоинтов');
        }

        if (expectedFixes.length > 0) {
            fixes.push(`Expected: ${expectedFixes.join(', ')}`);
        }

        normalized.expected = fixedExpected;
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. НОРМАЛИЗАЦИЯ ПО LAYER
    // ═══════════════════════════════════════════════════════════════
    
    if (normalized.layer === 'E2E Tests') {
        // E2E не должен иметь scenario и code
        if (normalized.scenario) {
            delete normalized.scenario;
            fixes.push('Удалён scenario (E2E не должен иметь scenario)');
        }
        if (normalized.code) {
            delete normalized.code;
            fixes.push('Удалён code (E2E не должен иметь code)');
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. УДАЛЕНИЕ ЛИШНИХ ПОЛЕЙ
    // ═══════════════════════════════════════════════════════════════
    
    // Удаляем scenario для E2E
    if (normalized.layer === 'E2E Tests' && normalized.scenario) {
        delete normalized.scenario;
    }

    // Удаляем code для не-Unit тестов
    if (normalized.layer !== 'Unit frontend Tests' && normalized.layer !== 'Integration backend Tests' && normalized.code) {
        delete normalized.code;
    }

    // ═══════════════════════════════════════════════════════════════
    // ЛОГИРОВАНИЕ
    // ═══════════════════════════════════════════════════════════════
    
    if (fixes.length > 0) {
        console.log(`[normalizeTestCase] "${normalized.title}" (${normalized.layer}): ${fixes.length} исправлений`);
        fixes.forEach(fix => console.log(`  - ${fix}`));
    }

    return normalized;
}

/**
 * Находит подходящий Code для Unit теста
 */
function findMatchingCode(testCase, testModel) {
    // Извлекаем все frontend коды из модели
    const frontendCodes = [];
    
    for (const feature of testModel) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                for (const code of scenario.codes || []) {
                    if (code.type === 'frontend') {
                        frontendCodes.push({
                            ...code,
                            feature: feature.text,
                            story: story.text,
                            scenario: scenario.text
                        });
                    }
                }
            }
        }
    }

    // Ищем по совпадению story или title
    const matchingCode = frontendCodes.find(code => 
        (testCase.story && code.story === testCase.story) ||
        (testCase.title && code.text.includes(testCase.title.substring(0, 30)))
    );

    return matchingCode || null;
}

// ═══════════════════════════════════════════════════════════════
// НОРМАЛИЗАЦИЯ МАССИВА ТЕСТ-КЕЙСОВ
// ═══════════════════════════════════════════════════════════════

/**
 * Нормализует массив тест-кейсов
 * @param {object[]} testCases - Массив тест-кейсов
 * @param {object} context - Контекст (testModel, apiSpec)
 * @returns {object[]} Нормализованные тест-кейсы
 */
export function normalizeTestCases(testCases, context = {}) {
    console.log(`[normalizeTestCases] Нормализация ${testCases.length} тест-кейсов...`);
    
    const normalized = testCases.map(tc => normalizeTestCase(tc, context));
    
    console.log(`[normalizeTestCases] ✅ Нормализация завершена`);
    
    return normalized;
}

// ═══════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ UNIT ТЕСТОВ ДЛЯ ВСЕХ FRONTEND CODES
// ═══════════════════════════════════════════════════════════════

/**
 * Генерирует Unit ЗАГЛУШКИ для всех frontend кодов из модели
 * 🚨 ВАЖНО: Это НЕ полноценные тесты, а ЗАГЛУШКИ для покрытия!
 * @param {object[]} testModel - Тестовая модель
 * @returns {object[]} Массив Unit заглушек
 */
export function generateUnitTestsForAllFrontendCodes(testModel) {
    const unitStubs = [];
    let counter = 1;

    for (const feature of testModel) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                for (const code of scenario.codes || []) {
                    if (code.type === 'frontend') {
                        // ✅ ЗАГЛУШКА: минимальная структура для покрытия Code
                        const unitStub = {
                            id: `tc-uf-${String(counter).padStart(3, '0')}`,
                            layer: 'Unit frontend Tests',
                            title: `Unit-заглушка: ${code.text.substring(0, 45)}...`,
                            feature: feature.text,
                            story: story.text,
                            scenario: scenario.text,
                            code: code.id,
                            steps: ['Вызвать компонент/функцию'],
                            expected: '**Выполнено** без ошибок',
                            tags: ['D', 'U'],
                            version: 'stable',
                            priority: 'Low', // ✅ Low приоритет для заглушек
                            precondition: 'Компонент инициализирован',
                            links: [],
                            parameters: [],
                            examples: []
                        };

                        unitStubs.push(unitStub);
                        counter++;
                    }
                }
            }
        }
    }

    console.log(`[generateUnitTestsForAllFrontendCodes] ✅ Сгенерировано ${unitStubs.length} Unit ЗАГЛУШЕК (не полноценных тестов!)`);
    
    return unitStubs;
}

/**
 * Генерирует шаг для Unit теста на основе текста кода
 */
function generateUnitTestStep(codeText) {
    // Определяем тип компонента/функции по тексту
    if (codeText.includes('Отображ')) {
        // UI компонент
        const componentName = extractComponentName(codeText);
        return `Вызвать компонент ${componentName}.render()`;
    } else if (codeText.includes('Отправляется')) {
        // API функция
        const apiName = extractAPIName(codeText);
        return `Вызвать функцию ${apiName}()`;
    } else {
        // Общий случай
        return 'Вызвать компонент/функцию';
    }
}

/**
 * Извлекает название компонента из текста кода
 */
function extractComponentName(text) {
    // "Отобразить модальное окно 'Выбор изображения'" → ImageSelectionModal
    const match = text.match(/['"']([^'"']+)['"']/);
    if (match) {
        return match[1]
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }
    return 'Component';
}

/**
 * Извлекает название API функции из текста кода
 */
function extractAPIName(text) {
    // "Отправляется GET **/api/v1/images/categories**" → getCategories
    const match = text.match(/\*\*\/api\/[^*]+\/([^/*]+)\*\*/);
    if (match) {
        const endpoint = match[1];
        return `get${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)}`;
    }
    return 'apiCall';
}

// ═══════════════════════════════════════════════════════════════
// РАЗДЕЛЕНИЕ СОСТАВНЫХ CODES В МОДЕЛИ
// ═══════════════════════════════════════════════════════════════

/**
 * Разбивает составные Codes в модели на атомарные
 * @param {object[]} testModel - Тестовая модель
 * @returns {object[]} Исправленная модель
 */
export function splitCompositeCodesInModel(testModel) {
    console.log('[splitCompositeCodesInModel] Разделение составных Codes...');
    
    let totalSplits = 0;

    for (const feature of testModel) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                const originalCodes = scenario.codes || [];
                const newCodes = [];

                for (const code of originalCodes) {
                    // Проверяем, является ли Code составным
                    const parts = splitCodeText(code.text);
                    
                    if (parts.length > 1) {
                        // Разбиваем на несколько кодов
                        for (let i = 0; i < parts.length; i++) {
                            newCodes.push({
                                id: `${code.id}-part-${i + 1}`,
                                text: parts[i].text,
                                type: parts[i].type
                            });
                        }
                        totalSplits++;
                    } else {
                        newCodes.push(code);
                    }
                }

                scenario.codes = newCodes;
            }
        }
    }

    if (totalSplits > 0) {
        console.log(`[splitCompositeCodesInModel] ✅ Разделено ${totalSplits} составных Codes`);
    }

    return testModel;
}

/**
 * Разбивает текст Code на отдельные части
 */
function splitCodeText(text) {
    const parts = [];

    // Паттерн 1: "запрос, ответ, UI"
    // "GET /api/..., Возвращается 200 OK, Отобразить список"
    const pattern1 = /^(GET|POST|PUT|DELETE|PATCH)\s+\*\*[^*]+\*\*[^,]*,\s*Возвращается[^,]*,\s*Отобраз/i;
    
    if (pattern1.test(text)) {
        const segments = text.split(',').map(s => s.trim());
        
        // Первая часть - frontend (запрос)
        if (segments[0]) {
            parts.push({ text: segments[0], type: 'frontend' });
        }
        
        // Вторая часть - backend (ответ)
        if (segments[1] && segments[1].match(/^Возвращается/i)) {
            parts.push({ text: segments[1], type: 'backend' });
        }
        
        // Третья часть - frontend (UI)
        if (segments[2] && segments[2].match(/^Отобраз/i)) {
            parts.push({ text: segments[2], type: 'frontend' });
        }
        
        return parts;
    }

    // Паттерн 2: "Отправляется POST ..., Возвращается ..., Отобразить ..."
    const pattern2 = /Отправляется\s+(GET|POST|PUT|DELETE|PATCH)[^,]*,\s*Возвращается[^,]*,\s*Отобраз/i;
    
    if (pattern2.test(text)) {
        const segments = text.split(',').map(s => s.trim());
        
        for (const segment of segments) {
            if (segment.match(/^Отправляется/i)) {
                parts.push({ text: segment, type: 'frontend' });
            } else if (segment.match(/^Возвращается/i)) {
                parts.push({ text: segment, type: 'backend' });
            } else if (segment.match(/^Отобраз/i)) {
                parts.push({ text: segment, type: 'frontend' });
            }
        }
        
        return parts;
    }

    // Не составной код
    return [{ text, type: 'frontend' }];
}


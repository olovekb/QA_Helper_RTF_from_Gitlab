// post-processors/validate-and-fix.js
import { v4 as uuidv4 } from 'uuid';
import RULES from '../config/rules/core-rules.js';

/**
 * Валидирует и исправляет тест-кейсы
 */
export function validateAndFixTestCases(testCases, modelStructure) {
    const fixed = [];
    const issues = [];
    
    for (const tc of testCases) {
        const { fixedCase, caseIssues } = validateAndFixSingleCase(tc, modelStructure);
        if (fixedCase) {
            fixed.push(fixedCase);
        }
        issues.push(...caseIssues);
    }
    
    return { testCases: fixed, issues };
}

function validateAndFixSingleCase(tc, modelStructure) {
    const caseIssues = [];
    const fixedCase = { ...tc };
    
    // 1. Проверка и исправление тегов
    const tagResult = validateAndFixTags(fixedCase);
    if (tagResult.fixed) {
        caseIssues.push(`[TAGS] ${tc.title}: исправлены теги ${JSON.stringify(tc.tags)} → ${JSON.stringify(tagResult.tags)}`);
        fixedCase.tags = tagResult.tags;
    }
    
    // 2. Удаление code из Integration тестов
    if (fixedCase.layer?.includes('Integration') && fixedCase.code) {
        caseIssues.push(`[CODE] ${tc.title}: удалено поле code (запрещено для Integration)`);
        delete fixedCase.code;
    }
    
    // 3. Удаление scenario из E2E
    if (fixedCase.layer === 'E2E Tests' && fixedCase.scenario) {
        caseIssues.push(`[SCENARIO] ${tc.title}: удалено поле scenario (запрещено для E2E)`);
        delete fixedCase.scenario;
    }
    
    // 4. Проверка {{}} в title/expected/precondition
    const placeholderFields = ['title', 'expected', 'precondition'];
    for (const field of placeholderFields) {
        if (fixedCase[field] && /\{\{[^}]+\}\}/.test(fixedCase[field])) {
            caseIssues.push(`[PLACEHOLDER] ${tc.title}: найден {{}} в ${field} - требуется ручное исправление`);
            // Пытаемся исправить автоматически
            fixedCase[field] = fixedCase[field].replace(/\{\{[^}]+\}\}/g, '(параметр)');
        }
    }
    
    // 5. Проверка формата examples
    if (fixedCase.examples && Array.isArray(fixedCase.examples)) {
        const fixedExamples = fixedCase.examples.map(ex => {
            // Если формат неверный (без parameters внутри)
            if (!ex.parameters && typeof ex === 'object') {
                // Пытаемся конвертировать
                const converted = {
                    parameters: Object.entries(ex).map(([name, value]) => ({ name, value: String(value) }))
                };
                return converted;
            }
            return ex;
        });
        fixedCase.examples = fixedExamples;
    }
    
    // 6. Добавление ID если отсутствует
    if (!fixedCase.id) {
        fixedCase.id = uuidv4();
    }
    
    return { fixedCase, caseIssues };
}

function validateAndFixTags(tc) {
    const layer = tc.layer;
    let tags = Array.isArray(tc.tags) ? [...tc.tags] : [];
    let fixed = false;
    
    // Используем правила из RULES
    const layerRulesConfig = RULES.testCases[layer];
    if (!layerRulesConfig) return { tags, fixed: false };
    
    const rules = {
        'E2E Tests': {
            allowed: RULES.testCases['E2E Tests'].tagsAllowed,
            forbidden: RULES.testCases['E2E Tests'].tagsForbidden,
            default: ['D']  // Минимум Desktop если пусто
        },
        'Integration frontend Tests': {
            allowed: RULES.testCases['Integration frontend Tests'].tagsAllowed,
            forbidden: RULES.testCases['Integration frontend Tests'].tagsForbidden,
            default: ['D']
        },
        'Integration backend Tests': {
            allowed: RULES.testCases['Integration backend Tests'].tagsAllowed,
            forbidden: RULES.testCases['Integration backend Tests'].tagsForbidden,
            default: ['S']
        }
    };
    
    const layerRules = rules[layer];
    if (!layerRules) return { tags, fixed: false };
    
    // Удаляем запрещённые
    const originalLength = tags.length;
    tags = tags.filter(t => !layerRules.forbidden.includes(t));
    
    // Оставляем только разрешённые
    tags = tags.filter(t => layerRules.allowed.includes(t));
    
    // Если пусто - добавляем default
    if (tags.length === 0) {
        tags = [...layerRules.default];
    }
    
    fixed = originalLength !== tags.length || (originalLength === 0 && tags.length > 0);
    
    return { tags, fixed };
}

/**
 * Проверяет покрытие E2E (минимум 1 на Feature)
 */
export function validateE2ECoverage(testCases, modelStructure) {
    const e2eByFeature = new Map();
    
    // Собираем E2E по фичам
    for (const tc of testCases) {
        if (tc.layer === 'E2E Tests' && tc.feature) {
            const feature = tc.feature.toLowerCase();
            if (!e2eByFeature.has(feature)) {
                e2eByFeature.set(feature, []);
            }
            e2eByFeature.get(feature).push(tc);
        }
    }
    
    // Проверяем каждую фичу из модели
    const missingE2E = [];
    for (const feature of modelStructure) {
        const featureName = feature.text?.toLowerCase();
        const e2eCount = e2eByFeature.get(featureName)?.length || 0;
        
        if (e2eCount < 1) {
            missingE2E.push({
                feature: feature.text,
                currentCount: e2eCount,
                requiredMin: 1
            });
        }
    }
    
    return {
        valid: missingE2E.length === 0,
        missingE2E
    };
}

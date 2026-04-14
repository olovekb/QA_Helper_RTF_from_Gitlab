import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Все доступные операторы
 */
const OPERATORS = {
    // Операторы сравнения (для field_check, step_check, appliesTo)
    equals: {
        name: 'equals',
        description: 'Полное совпадение значения',
        validate: (value, expected) => value === expected,
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    not_equals: {
        name: 'not_equals',
        description: 'Значение не совпадает с ожидаемым',
        validate: (value, expected) => value !== expected,
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    in: {
        name: 'in',
        description: 'Значение входит в массив',
        validate: (value, expected) => Array.isArray(expected) && expected.includes(value),
        appliesTo: ['field_check', 'step_check', 'custom_field_check', 'appliesTo']
    },
    not_in: {
        name: 'not_in',
        description: 'Значение не входит в массив',
        validate: (value, expected) => Array.isArray(expected) && !expected.includes(value),
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    
    // Операторы для строк
    contains: {
        name: 'contains',
        description: 'Значение содержит подстроку',
        validate: (value, expected) => typeof value === 'string' && value.includes(expected),
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    not_contains: {
        name: 'not_contains',
        description: 'Значение не содержит подстроку',
        validate: (value, expected) => typeof value === 'string' && !value.includes(expected),
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    contains_any: {
        name: 'contains_any',
        description: 'Значение содержит хотя бы одну из подстрок',
        validate: (value, expected) => {
            if (!Array.isArray(expected)) return false;
            return expected.some(item =>
                typeof value === 'string' && value.toLowerCase().includes(item.toLowerCase())
            );
        },
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    not_contains_any: {
        name: 'not_contains_any',
        description: 'Значение не содержит ни одной из подстрок',
        validate: (value, expected) => {
            if (!Array.isArray(expected)) return true;
            const found = expected.filter(item =>
                typeof value === 'string' && value.toLowerCase().includes(item.toLowerCase())
            );
            return found.length === 0;
        },
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    
    // Операторы для regex
    matches: {
        name: 'matches',
        description: 'Строка соответствует регулярному выражению',
        validate: (value, expected, options = {}) => {
            const { pattern, case_insensitive } = options;
            const regex = new RegExp(pattern || expected, case_insensitive ? 'i' : '');
            return regex.test(value);
        },
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    not_matches: {
        name: 'not_matches',
        description: 'Строка не соответствует регулярному выражению',
        validate: (value, expected, options = {}) => {
            const { pattern, case_insensitive } = options;
            const regex = new RegExp(pattern || expected, case_insensitive ? 'i' : '');
            return !regex.test(value);
        },
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    
    // Операторы проверки на непустоту
    empty: {
        name: 'empty',
        description: 'Поле пустое',
        validate: (value) => !value || value === '' || value === 'Нет значений' || value === 'Нет результата',
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    not_empty: {
        name: 'not_empty',
        description: 'Поле непустое',
        validate: (value) => value && value !== '' && value !== 'Нет значений' && value !== 'Нет результата',
        appliesTo: ['field_check', 'step_check', 'custom_field_check', 'appliesTo']
    },
    
    // Операторы счетчиков
    min_count: {
        name: 'min_count',
        description: 'Минимальное количество элементов',
        validate: (value, expected) => {
            if (Array.isArray(value)) return value.length >= expected;
            if (typeof value === 'string') return value.length >= expected;
            return false;
        },
        appliesTo: ['field_check', 'step_check', 'appliesTo']
    },
    
    // Операторы для тегов
    includes_any: {
        name: 'includes_any',
        description: 'Теги содержат хотя бы один элемент из списка',
        validate: (value, expected) => {
            if (!Array.isArray(value) || !Array.isArray(expected)) return false;
            return value.some(item => expected.includes(item));
        },
        appliesTo: ['tag_check']
    },
    includes_all: {
        name: 'includes_all',
        description: 'Теги содержат все элементы из списка',
        validate: (value, expected) => {
            if (!Array.isArray(value) || !Array.isArray(expected)) return false;
            return expected.every(item => value.includes(item));
        },
        appliesTo: ['tag_check']
    },
    not_includes: {
        name: 'not_includes',
        description: 'Теги не содержат ни одного элемента из списка',
        validate: (value, expected) => {
            if (!Array.isArray(value) || !Array.isArray(expected)) return true;
            return !value.some(item => expected.includes(item));
        },
        appliesTo: ['tag_check']
    },
    matches_any: {
        name: 'matches_any',
        description: 'Хотя бы один тег соответствует regex',
        validate: (value, expected, options = {}) => {
            if (!Array.isArray(value)) return false;
            const { pattern } = options;
            const regex = new RegExp(pattern || expected);
            return value.some(item => regex.test(item));
        },
        appliesTo: ['tag_check']
    },
    
    // Операторы для кастомных полей
    all_required: {
        name: 'all_required',
        description: 'Все перечисленные поля должны быть заполнены',
        validate: null, // обработка в checkCustomFieldWithOperator
        appliesTo: ['custom_field_check']
    },
    must_not_exist: {
        name: 'must_not_exist',
        description: 'Поле не должно содержать значение',
        validate: null,
        appliesTo: ['custom_field_check']
    }
};

/**
 * Применить оператор к значению
 */
function applyOperator(value, operator, expected, options = {}) {
    const op = OPERATORS[operator];
    
    if (!op) {
        console.warn(`[applyOperator] Неизвестный оператор: ${operator}`);
        return false;
    }
    
    if (!op.validate) {
        console.warn(`[applyOperator] Оператор ${operator} не имеет функции validate`);
        return false;
    }
    
    return op.validate(value, expected, options);
}

/**
 * Проверить, доступен ли оператор для данного типа проверки
 */
function isOperatorValidForCheckType(operator, checkType) {
    const op = OPERATORS[operator];
    if (!op) return false;
    return op.appliesTo.includes(checkType);
}

// Загрузка конфигов
let rulesConfig = null;
let projectSettings = null;

function loadRules() {
    if (!rulesConfig) {
        // Загрузка базовых правил
        const rulesPath = join(__dirname, 'config', 'static-analysis-rules.yaml');
        const rulesYaml = readFileSync(rulesPath, 'utf8');
        const baseConfig = yaml.load(rulesYaml);
        
        // Загрузка проектных правил из projects/
        const projectsDir = join(__dirname, 'config', 'projects');
        const cases_rules = {};
        
        try {
            const projectFiles = readdirSync(projectsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            
            for (const file of projectFiles) {
                const projectFilePath = join(projectsDir, file);
                const projectYaml = readFileSync(projectFilePath, 'utf8');
                const projectConfig = yaml.load(projectYaml);
                
                if (projectConfig.cases_rules) {
                    Object.assign(cases_rules, projectConfig.cases_rules);
                    console.log(`[loadRules] Загружены проектные правила из: ${file}`);
                }
            }
        } catch (err) {
            console.warn(`[loadRules] Папка projects/ не найдена или пуста: ${err.message}`);
        }
        
        rulesConfig = {
            base_rules: baseConfig.base_rules || [],
            cases_rules: { ...baseConfig.cases_rules, ...cases_rules }
        };
        
        validateRulesConfig(rulesConfig);
    }
    return rulesConfig;
}

function loadProjectSettings() {
    if (!projectSettings) {
        const settingsPath = join(__dirname, 'config', 'project-settings.yaml');
        const settingsYaml = readFileSync(settingsPath, 'utf8');
        projectSettings = yaml.load(settingsYaml);
    }
    return projectSettings;
}

/**
 * Валидация структуры конфига с правилами
 */
function validateRulesConfig(config) {
    const errors = [];
    
    if (config.base_rules) {
        config.base_rules.forEach((rule, index) => {
            const ruleErrors = validateRule(rule, `base_rules[${index}]`);
            errors.push(...ruleErrors);
        });
    }
    
    if (config.cases_rules) {
        Object.entries(config.cases_rules).forEach(([projectId, rules]) => {
            rules.forEach((rule, index) => {
                const ruleErrors = validateRule(rule, `cases_rules[${projectId}][${index}]`);
                errors.push(...ruleErrors);
            });
        });
    }
    
    if (errors.length > 0) {
        console.error('Ошибки в конфигурации правил:');
        errors.forEach(err => console.error(`   ${err}`));
        console.error('\n  Правила с ошибками будут проигнорированы\n');
    }
    
    return errors;
}

/**
 * Валидация одного правила
 */
function validateRule(rule, path) {
    const errors = [];
    
    // Обязательные поля
    if (!rule.id) {
        errors.push(`${path}: отсутствует обязательное поле "id"`);
    }
    if (!rule.name) {
        errors.push(`${path}: отсутствует обязательное поле "name"`);
    }
    if (!rule.level) {
        errors.push(`${path}: отсутствует обязательное поле "level"`);
    } else if (!['error', 'warning'].includes(rule.level)) {
        errors.push(`${path}: поле "level" может иметь значение "error" или "warning", получено "${rule.level}"`);
    }
    if (!rule.check_type) {
        errors.push(`${path}: отсутствует обязательное поле "check_type"`);
    } else if (!VALIDATORS[rule.check_type]) {
        errors.push(`${path}: неизвестный check_type "${rule.check_type}"`);
    }
    if (!rule.params) {
        errors.push(`${path}: отсутствует обязательное поле "params"`);
    }
    
    // Проверка params для конкретного check_type
    if (rule.check_type && rule.params) {
        const paramsErrors = validateRuleParams(rule, path);
        errors.push(...paramsErrors);
    }
    
    // Проверка appliesTo
    if (rule.appliesTo) {
        const appliesToErrors = validateAppliesTo(rule.appliesTo, `${path}.appliesTo`);
        errors.push(...appliesToErrors);
    }
    
    return errors;
}

/**
 * Валидация params правила
 */
function validateRuleParams(rule, path) {
    const errors = [];
    const { check_type, params } = rule;
    
    switch (check_type) {
        case 'field_check':
        case 'step_check':
            if (!params.operator) {
                errors.push(`${path}.params: отсутствует обязательное поле "operator"`);
            } else if (!isOperatorValidForCheckType(params.operator, check_type)) {
                errors.push(`${path}.params: оператор "${params.operator}" недоступен для check_type "${check_type}"`);
            }
            
            // Для field_check обязательно поле field (кроме min_count для step_check)
            if (check_type === 'field_check' && !params.field) {
                errors.push(`${path}.params: отсутствует обязательное поле "field" для field_check`);
            }
            
            // Проверка pattern для matches/not_matches
            if (['matches', 'not_matches'].includes(params.operator) && !params.pattern && !params.value) {
                errors.push(`${path}.params: оператор "${params.operator}" требует наличия поля "pattern" или "value"`);
            }
            
            // Проверка наличия value для операторов, которым он нужен (кроме empty/not_empty и matches/not_matches с pattern)
            const needsValue = params.operator && 
                              !['empty', 'not_empty'].includes(params.operator) &&
                              !((['matches', 'not_matches'].includes(params.operator) && params.pattern)) &&
                              params.value === undefined;
            
            if (needsValue) {
                errors.push(`${path}.params: оператор "${params.operator}" требует наличия поля "value"`);
            }
            break;
            
        case 'tag_check':
            if (!params.operator) {
                errors.push(`${path}.params: отсутствует обязательное поле "operator"`);
            } else if (!isOperatorValidForCheckType(params.operator, check_type)) {
                errors.push(`${path}.params: оператор "${params.operator}" недоступен для check_type "${check_type}"`);
            }
            
            if (!params.value && params.operator !== 'matches_any') {
                errors.push(`${path}.params: отсутствует обязательное поле "value" для tag_check`);
            }
            
            if (params.operator === 'matches_any' && !params.pattern && !params.value) {
                errors.push(`${path}.params: оператор "matches_any" требует наличия поля "pattern" или "value"`);
            }
            break;
            
        case 'custom_field_check':
            if (!params.operator) {
                errors.push(`${path}.params: отсутствует обязательное поле "operator"`);
            } else if (!isOperatorValidForCheckType(params.operator, check_type)) {
                errors.push(`${path}.params: оператор "${params.operator}" недоступен для check_type "${check_type}"`);
            }
            
            if (params.operator === 'all_required' && !params.fields) {
                errors.push(`${path}.params: оператор "all_required" требует наличия поля "fields" (массив)`);
            }
            
            if (['not_empty', 'in', 'must_not_exist'].includes(params.operator) && !params.field) {
                errors.push(`${path}.params: оператор "${params.operator}" требует наличия поля "field"`);
            }
            
            if (params.operator === 'in' && !params.value) {
                errors.push(`${path}.params: оператор "in" требует наличия поля "value" (массив)`);
            }
            break;
            
        case 'parameters_usage_check':
            // Нет обязательных параметров
            break;
            
        default:
            errors.push(`${path}: неизвестный check_type "${check_type}"`);
    }
    
    return errors;
}

/**
 * Валидация appliesTo
 */
function validateAppliesTo(appliesTo, path) {
    const errors = [];
    
    if (!appliesTo.field) {
        errors.push(`${path}: отсутствует обязательное поле "field"`);
    }
    if (!appliesTo.operator) {
        errors.push(`${path}: отсутствует обязательное поле "operator"`);
    } else if (!isOperatorValidForCheckType(appliesTo.operator, 'appliesTo')) {
        errors.push(`${path}: оператор "${appliesTo.operator}" недоступен для appliesTo`);
    }
    if (appliesTo.value === undefined && !['empty', 'not_empty'].includes(appliesTo.operator)) {
        errors.push(`${path}: отсутствует обязательное поле "value"`);
    }
    
    return errors;
}

// Управление правилами

export function getProjectSettings(projectId) {
    const settings = loadProjectSettings();
    const projectIdStr = String(projectId);
    return settings.projects[projectIdStr] || settings.default;
}

export function getRulesForProject(projectId) {
    const rules = loadRules();
    const baseRules = rules.base_rules || [];
    const projectIdStr = String(projectId);
    const projectRules = rules.cases_rules?.[projectIdStr] || [];

    const rulesMap = new Map();

    console.log(`\nЗАГРУЗКА ПРАВИЛ ДЛЯ ПРОЕКТА ${projectId}:`);
    console.log(`   Базовых правил: ${baseRules.length}`);
    console.log(`   Проектных правил: ${projectRules.length}`);

    // Добавление всех базовые правила
    baseRules.forEach(rule => {
        rulesMap.set(rule.id, { ...rule, source: 'base' });
    });

    // Переопределение базовых правил проектными (при наличии)
    if (projectRules.length > 0) {
        console.log(`\nПереопределения правил:`);
        projectRules.forEach(rule => {
            if (rulesMap.has(rule.id)) {
                console.log(`   Правило "${rule.id}" переопределено для проекта ${projectId}`);
            } else {
                console.log(`   Новое правило "${rule.id}" добавлено для проекта ${projectId}`);
            }
            rulesMap.set(rule.id, { ...rule, source: 'project' });
        });
    }

    // Возврат только активных правил
    const allRules = Array.from(rulesMap.values());
    const activeRules = allRules.filter(rule => rule.enabled !== false);
    const disabledCount = allRules.length - activeRules.length;
    
    if (disabledCount > 0) {
        const disabledRules = allRules.filter(rule => rule.enabled === false);
        console.log(`   Отключенные правила: ${disabledRules.map(r => r.id).join(', ')}`);
    }

    console.log(`\nАктивных правил: ${activeRules.length}\n`);

    return activeRules;
}

export function getAIRulesForProject(projectId) {
    const rules = loadRules();
    const baseRules = rules.base_rules || [];
    const projectIdStr = String(projectId);
    const projectRules = rules.cases_rules?.[projectIdStr] || [];

    const rulesMap = new Map();

    baseRules.forEach(rule => {
        rulesMap.set(rule.id, { ...rule, source: 'base' });
    });

    projectRules.forEach(rule => {
        rulesMap.set(rule.id, { ...rule, source: 'project' });
    });

    // Возврат правил с is_ai_enabled = true и наличием ai_prompt
    const allRules = Array.from(rulesMap.values());
    const aiRules = allRules.filter(rule => 
        rule.enabled !== false && 
        rule.is_ai_enabled === true && 
        rule.ai_prompt
    );

    console.log(`\nПравил для AI-промпта проекта ${projectId}: ${aiRules.length}`);

    return aiRules;
}

// Логика валидации

/**
 * Основная функция валидации
 */
function baseValidate(testCase, rule, validatorFn) {
    if (rule.appliesTo && !checkAppliesTo(testCase, rule.appliesTo)) {
        return { passed: true, skipped: true };
    }
    
    // вызов конкретного валидатора
    return validatorFn(testCase, rule);
}

/**
 * Проверка условия применения правила
 */
function checkAppliesTo(testCase, appliesTo) {
    if (!appliesTo) return true;

    const appliesToPassed = applyOperator(
        testCase[appliesTo.field],
        appliesTo.operator,
        appliesTo.value
    );
    return appliesToPassed;
}

// Валидаторы

/**
 * Проверка поля тест-кейса
 */
function checkFieldWithOperator(testCase, rule) {
    return baseValidate(testCase, rule, (tc, r) => {
        const { field, operator, value, error_message, case_insensitive, pattern } = r.params;
        const fieldValue = tc[field];

        const passed = applyOperator(fieldValue, operator, value, { case_insensitive, pattern });

        if (!passed) {
            let message = error_message;
            if (!message) {
                switch (operator) {
                    case 'equals':
                        message = `Поле "${field}" должно быть "${value}", получено "${fieldValue}"`;
                        break;
                    case 'in':
                        message = `Поле "${field}" должно быть одним из: ${value.join(', ')}`;
                        break;
                    case 'not_empty':
                        message = `Поле "${field}" должно содержать значение`;
                        break;
                    case 'not_matches':
                        message = `Поле "${field}" не должно содержать паттерн "${pattern || value}"`;
                        break;
                    default:
                        message = `Поле "${field}" не прошло проверку оператором "${operator}"`;
                }
            }
            return { passed: false, message };
        }

        return { passed: true };
    });
}

/**
 * Проверка шагов тест-кейса
 */
function checkStepsWithOperator(testCase, rule) {
    return baseValidate(testCase, rule, (tc, r) => {
        const { field, operator, value, error_message, pattern, case_insensitive } = r.params;
        const steps = tc.steps || [];

        // обработка min_count для количества шагов
        if (operator === 'min_count') {
            if (steps.length < value) {
                return {
                    passed: false,
                    message: error_message || `Тест-кейс должен содержать минимум ${value} шаг(ов)`
                };
            }
            return { passed: true };
        }

        const errors = [];
        steps.forEach((step, index) => {
            const stepFieldValue = field ? step[field] : step.description;
            const passed = applyOperator(stepFieldValue, operator, value, { case_insensitive, pattern });

            if (!passed) {
                errors.push({
                    stepIndex: index + 1,
                    message: error_message || `Шаг ${index + 1}: проверка "${operator}" не прошла`
                });
            }
        });

        return errors.length === 0
            ? { passed: true }
            : { passed: false, stepErrors: errors };
    });
}

/**
 * Проверка тегов
 */
function checkTagsWithOperator(testCase, rule) {
    return baseValidate(testCase, rule, (tc, r) => {
        const { operator, value, error_message, pattern } = r.params;
        const tags = tc.tags || [];

        const passed = applyOperator(tags, operator, value, { pattern });

        if (!passed) {
            return {
                passed: false,
                message: error_message || `Теги не прошли проверку оператором "${operator}"`
            };
        }

        return { passed: true };
    });
}

/**
 * Проверка кастомных полей
 */
function checkCustomFieldWithOperator(testCase, rule) {
    return baseValidate(testCase, rule, (tc, r) => {
        const { field, operator, value, fields, error_message } = r.params;
        const customFields = tc.customFields || [];

        switch (operator) {
            case 'all_required':
                const missingFields = [];
                for (const fieldName of fields) {
                    const customField = customFields.find(f => f.name === fieldName);
                    if (!customField || customField.value === 'Нет значений' || !customField.value) {
                        missingFields.push(fieldName);
                    }
                }
                if (missingFields.length > 0) {
                    return {
                        passed: false,
                        message: `${error_message}: ${missingFields.join(', ')}`
                    };
                }
                return { passed: true };

            case 'not_empty':
                const customField = customFields.find(f => f.name === field);
                if (!customField || customField.value === 'Нет значений' || !customField.value) {
                    return {
                        passed: false,
                        message: error_message || `Поле "${field}" не должно быть пустым`
                    };
                }
                return { passed: true };

            case 'in':
                const fieldToCheck = customFields.find(f => f.name === field);
                if (!fieldToCheck || !value.includes(fieldToCheck.value)) {
                    return {
                        passed: false,
                        message: error_message || `Поле "${field}" должно быть одним из: ${value.join(', ')}`
                    };
                }
                return { passed: true };

            case 'must_not_exist':
                const fieldToCheckNotExist = customFields.find(f => f.name === field);
                if (fieldToCheckNotExist && fieldToCheckNotExist.value && fieldToCheckNotExist.value !== 'Нет значений') {
                    return {
                        passed: false,
                        message: error_message || `В поле "${field}" не должно присутствовать значение`
                    };
                }
                return { passed: true };

            default:
                console.warn(`[checkCustomFieldWithOperator] Неизвестный оператор: ${operator}`);
                return { passed: false, message: `Неизвестный оператор: ${operator}` };
        }
    });
}

/**
 * Проверка использования параметров в шагах
 */
function checkParametersUsage(testCase, rule) {
    return baseValidate(testCase, rule, (tc, r) => {
        const { error_message } = r.params;
        const parameters = tc.parameters || [];

        if (parameters.length === 0) {
            return { passed: true };
        }

        let stepsText = '';

        if (tc.stepsRaw && typeof tc.stepsRaw === 'object') {
            const scenarioSteps = tc.stepsRaw.scenarioSteps ||
                                 tc.stepsRaw.scenario?.scenarioSteps || {};

            Object.values(scenarioSteps).forEach(step => {
                if (step.body) {
                    stepsText += ' ' + step.body;
                }
            });
        }

        // переход к steps, если не получен текст из stepsRaw
        if (!stepsText && Array.isArray(tc.steps)) {
            stepsText = tc.steps
                .map(step => {
                    if (typeof step === 'string') return step;
                    if (step.action) return step.action;
                    if (step.description) return step.description;
                    return '';
                })
                .join(' ');
        }

        const usedParams = [];

        for (const param of parameters) {
            const paramName = param.name;
            const paramPattern = new RegExp(`\\{\\{\\s*${paramName}\\s*\\}\\}`, 'gi');

            if (paramPattern.test(stepsText)) {
                usedParams.push(paramName);
            }
        }

        if (usedParams.length === 0) {
            return {
                passed: false,
                message: `${error_message}: ${parameters.map(p => p.name).join(', ')}`
            };
        }

        return { passed: true };
    });
}

const VALIDATORS = {
    'field_check': checkFieldWithOperator,
    'step_check': checkStepsWithOperator,
    'tag_check': checkTagsWithOperator,
    'custom_field_check': checkCustomFieldWithOperator,
    'parameters_usage_check': checkParametersUsage,
};

export function validateTestCase(testCase, projectId) {
    const rules = getRulesForProject(projectId);
    const errors = [];
    const warnings = [];

    for (const rule of rules) {
        const validator = VALIDATORS[rule.check_type];

        if (!validator) {
            console.warn(`[ValidationEngine] Неизвестный тип проверки: ${rule.check_type}`);
            continue;
        }

        const result = validator(testCase, rule);

        // пропуск неприменимых правил
        if (result.skipped) {
            continue;
        }

        if (!result.passed) {
            const violation = {
                ruleId: rule.id,
                ruleName: rule.name,
                category: rule.category,
                level: rule.level,
                message: result.message,
                stepErrors: result.stepErrors
            };

            if (rule.level === 'error') {
                errors.push(violation);
            } else if (rule.level === 'warning') {
                warnings.push(violation);
            }
        }
    }

    return {
        errors,
        warnings,
        hasErrors: errors.length > 0,
        hasWarnings: warnings.length > 0,
        totalIssues: errors.length + warnings.length
    };
}

export function validateTestCases(testCases, projectId) {
    const projectSettings = getProjectSettings(projectId);
    const results = [];

    let totalErrors = 0;
    let totalWarnings = 0;
    let testCasesWithErrors = 0;
    let testCasesWithWarnings = 0;

    for (const testCase of testCases) {
        const validation = validateTestCase(testCase, projectId);

        results.push({
            testCase,
            validation
        });

        totalErrors += validation.errors.length;
        totalWarnings += validation.warnings.length;

        if (validation.hasErrors) testCasesWithErrors++;
        if (validation.hasWarnings) testCasesWithWarnings++;
    }

    const totalTestCases = testCases.length;
    const errorPercentage = totalTestCases > 0
        ? ((testCasesWithErrors / totalTestCases) * 100).toFixed(2)
        : 0;
    const warningPercentage = totalTestCases > 0
        ? ((testCasesWithWarnings / totalTestCases) * 100).toFixed(2)
        : 0;

    const passesErrorThreshold = parseFloat(errorPercentage) <= projectSettings.error_threshold;
    const passesWarningThreshold = parseFloat(warningPercentage) <= projectSettings.warning_threshold;
    const passesReview = passesErrorThreshold && passesWarningThreshold;

    return {
        results,
        statistics: {
            totalTestCases,
            testCasesWithErrors,
            testCasesWithWarnings,
            testCasesPassed: totalTestCases - testCasesWithErrors - testCasesWithWarnings,
            totalErrors,
            totalWarnings,
            errorPercentage: parseFloat(errorPercentage),
            warningPercentage: parseFloat(warningPercentage),
            passesReview,
            thresholds: {
                error: projectSettings.error_threshold,
                warning: projectSettings.warning_threshold
            }
        },
        projectSettings
    };
}

// Утилиты
/**
 * Анализ правил проекта
 */
export function analyzeProjectRules(projectId) {
    const rules = loadRules();
    const baseRules = rules.base_rules || [];
    const projectIdStr = String(projectId);
    const projectRules = rules.cases_rules?.[projectIdStr] || [];

    const analysis = {
        projectId,
        baseRulesCount: baseRules.length,
        projectRulesCount: projectRules.length,
        overrides: [],
        newRules: [],
        conflicts: [],
        disabledRules: []
    };

    const baseRuleIds = new Set(baseRules.map(r => r.id));
    
    projectRules.forEach(rule => {
        if (baseRuleIds.has(rule.id)) {
            analysis.overrides.push({
                id: rule.id,
                name: rule.name,
                enabled: rule.enabled !== false
            });
        } else {
            analysis.newRules.push({
                id: rule.id,
                name: rule.name,
                enabled: rule.enabled !== false
            });
        }

        if (rule.enabled === false) {
            analysis.disabledRules.push(rule.id);
        }
    });

    return analysis;
}

/**
 * Отладка применения правил к тест-кейсу
 */
export function debugRuleApplication(testCase, projectId) {
    const rules = getRulesForProject(projectId);
    const debugInfo = {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        layer: testCase.layer?.name,
        applicableRules: [],
        skippedRules: [],
        failedRules: []
    };

    rules.forEach(rule => {
        const ruleInfo = {
            id: rule.id,
            name: rule.name,
            source: rule.source,
            checkType: rule.check_type
        };

        // Проверяем appliesTo
        if (rule.appliesTo && !checkAppliesTo(testCase, rule.appliesTo)) {
            debugInfo.skippedRules.push({
                ...ruleInfo,
                reason: `appliesTo: ${rule.appliesTo.field} ${rule.appliesTo.operator} [${rule.appliesTo.value?.join(', ')}]`,
                actualValue: testCase[rule.appliesTo.field]
            });
            return;
        }

        debugInfo.applicableRules.push(ruleInfo);

        // Проверка самого правила
        const validator = VALIDATORS[rule.check_type];
        if (validator) {
            const result = validator(testCase, rule);
            if (!result.passed) {
                debugInfo.failedRules.push({
                    ...ruleInfo,
                    message: result.message,
                    stepErrors: result.stepErrors
                });
            }
        }
    });

    return debugInfo;
}

// Утилиты для документации
export function getAllRulesDocumentation(projectId = null) {
    const rules = projectId
        ? getRulesForProject(projectId)
        : loadRules().base_rules;

    return rules.map(toRuleDoc);
}

export function getAllRulesForDocumentation(projectId) {
    const rules = loadRules();
    const baseRules = rules.base_rules || [];
    const projectIdStr = String(projectId);
    const projectRules = rules.cases_rules?.[projectIdStr] || [];
    const rulesMap = new Map();
    const projectIds = new Set();

    baseRules.forEach(rule => {
        rulesMap.set(rule.id, { ...rule, source: 'base' });
    });
    projectRules.forEach(rule => {
        rulesMap.set(rule.id, { ...rule, source: 'project' });
        projectIds.add(rule.id);
    });

    return Array.from(rulesMap.values()).map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        level: rule.level,
        category: rule.category,
        enabled: rule.enabled !== false,
        check_type: rule.check_type || null,
        source: projectIds.has(rule.id) ? 'project' : 'base'
    }));
}

export function getBaseRulesDocumentation() {
    const rules = loadRules().base_rules || [];
    return rules.map(toRuleDoc);
}

export function getProjectRulesDocumentation(projectId) {
    const rules = loadRules();
    const projectIdStr = String(projectId);
    const projectRules = rules.cases_rules?.[projectIdStr] || [];
    return projectRules.map(toRuleDoc);
}

export function getAllProjects() {
    const settings = loadProjectSettings();
    return settings.projects;
}

function toRuleDoc(rule) {
    return {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        level: rule.level,
        category: rule.category,
        enabled: rule.enabled !== false,
        check_type: rule.check_type || null
    };
}

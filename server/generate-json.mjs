/**
 * Собрать параметры с значениями из "examples" (ТестОпс возвращает имена в "parameters", а значения в объекте "examples")
 */
function buildParametersWithValues(parameters, examples) {
    if (!parameters?.length) return [];
    const valuesByParam = new Map();
    for (const p of parameters) {
        const name = p?.name?.trim();
        if (name) valuesByParam.set(name, new Set());
    }
    for (const ex of examples || []) {
        const exParams = ex?.parameters || [];
        for (const p of exParams) {
            const name = p?.name?.trim();
            const val = p?.value != null ? String(p.value).trim() : null;
            if (name && val && valuesByParam.has(name)) {
                valuesByParam.get(name).add(val);
            }
        }
    }
    return Array.from(valuesByParam.entries())
        .filter(([, vals]) => vals.size > 0)
        .map(([name, vals]) => ({ name, values: Array.from(vals) }));
}

export async function formatTestCaseAsJson(testCase) {

    // Формируем базовую структуру тест-кейса
    const formattedTestCase = {
        id: testCase.id || 'Нет ID',
        name: testCase.name || 'Нет названия',
        issue: testCase.issue?.[0]?.name || 'Нет задачи',
        status: testCase.status?.name || 'Нет статуса',
        layer: testCase.layer?.name || 'Нет слоя',
        precondition: testCase.precondition || 'Нет предусловия',
        customFields: testCase.customFields?.map(field => ({
            name: field.customField?.name || 'Неизвестное поле',
            value: field.values?.map(value => value.name).join(', ') || 'Нет значений',
        })) || [],
        tags: testCase.tags?.map(tag => tag.name) || [],
        expectedResult: testCase.expectedResult || 'Нет результата',
        parameters: buildParametersWithValues(testCase.parameters || [], testCase.examples || []),
    };

    // Форматируем шаги
    // Приоритет: используем stepsRaw (сырая структура Allure), если она есть и валидна
    // API Allure может вернуть структуру с root/scenarioSteps на верхнем уровне (новая) или внутри scenario (старая)
    if (testCase.stepsRaw && typeof testCase.stepsRaw === 'object' && !Array.isArray(testCase.stepsRaw)) {
        const hasOldStructure = testCase.stepsRaw.scenario && testCase.stepsRaw.scenario.root;
        const hasNewStructure = testCase.stepsRaw.root && testCase.stepsRaw.scenarioSteps;
        
        if (hasOldStructure || hasNewStructure) {
            // Преобразуем структуру Allure в формат для formatStepsAsJson (с root на верхнем уровне)
            const normalizedSteps = {
                root: testCase.stepsRaw.scenario?.root || testCase.stepsRaw.root || { children: [] },
                scenarioSteps: testCase.stepsRaw.scenario?.scenarioSteps || testCase.stepsRaw.scenarioSteps || {},
                sharedSteps: testCase.stepsRaw.sharedSteps || {},
                sharedStepScenarioSteps: testCase.stepsRaw.sharedStepScenarioSteps || {},
                attachments: testCase.stepsRaw.attachments || {}
            };
            formattedTestCase.steps = await formatStepsAsJson(normalizedSteps);
        }
    } else if (testCase.steps && typeof testCase.steps === 'object' && !Array.isArray(testCase.steps)) {
        // Если steps в формате объекта (сырая структура Allure), форматируем их
        formattedTestCase.steps = await formatStepsAsJson(testCase.steps);
    } else {
        formattedTestCase.steps = [];
    }

    return formattedTestCase; // Возвращаем объект JSON
}

/**
 * Форматирует шаги тест-кейса в JSON.
 * @param {Object} steps - Объект шагов.
 */
async function formatStepsAsJson(steps) {
    const stepsResult = [];
    const stepOrder = Array.isArray(steps.root?.children) ? steps.root.children : []; // Защита от undefined
    let stepIndex = 1; // Нумерация шагов

    const getAttachmentName = (attachmentId) => {
        return steps.attachments?.[attachmentId]?.name || null;
    };

    for (const stepId of stepOrder) {
        const step = steps.scenarioSteps[stepId];

        if (step) {
            if (step.sharedStepId) {
                // Обработка общего шага
                const sharedStep = steps.sharedSteps[step.sharedStepId];
                if (sharedStep) {
                    let sharedStepObj = {
                        index: stepIndex,
                        description: sharedStep.body || 'Нет описания общего шага',
                        type: 'sharedStep', // Тип шага для обозначения, что это общий шаг
                        childSteps: [], // Для хранения вложенных шагов
                    };

                    const sharedStepChildren = sharedStep.children || [];
                    sharedStepChildren.forEach((sharedStepId, sharedStepIndex) => {
                        const sharedStepStep = steps.sharedStepScenarioSteps[sharedStepId];
                        if (sharedStepStep) {
                            let childStepObj = {
                                index: `${stepIndex}.${sharedStepIndex + 1}`,
                                description: sharedStepStep.body || 'Нет описания шага общего шага',
                                attachment: getAttachmentName(sharedStepStep.attachmentId) || null,
                            };
                            
                            // Извлечение ожидаемого результата для подшага, если есть expectedResultId
                            if (sharedStepStep.expectedResultId) {
                                const expectedResultContainer = steps.sharedStepScenarioSteps[sharedStepStep.expectedResultId];
                                if (expectedResultContainer) {
                                    let expectedResultText = '';
                                    
                                    if (expectedResultContainer.children && expectedResultContainer.children.length > 0) {
                                        const expectedResultTexts = expectedResultContainer.children
                                            .map(childId => {
                                                const childStep = steps.sharedStepScenarioSteps[childId];
                                                return childStep?.body || '';
                                            })
                                            .filter(text => text.trim().length > 0);
                                        expectedResultText = expectedResultTexts.join('\n');
                                    } else if (expectedResultContainer.body && 
                                              expectedResultContainer.body !== 'Expected Result') {
                                        expectedResultText = expectedResultContainer.body;
                                    }
                                    
                                    if (expectedResultText.trim().length > 0) {
                                        childStepObj.expectedResult = expectedResultText;
                                    }
                                }
                            }
                            
                            sharedStepObj.childSteps.push(childStepObj);
                        }
                    });

                    stepsResult.push(sharedStepObj);
                    stepIndex++;
                } else {
                    console.warn(`Не удалось найти общий шаг с ID ${step.sharedStepId}`);
                }
            } else {
                // Обработка обычного шага
                let stepObj = {
                    index: stepIndex,
                    description: step.body || getAttachmentName(step.attachmentId) || 'Нет описания шага',
                    attachment: getAttachmentName(step.attachmentId) || null,
                };

                // Извлечение ожидаемого результата, если у шага есть expectedResultId
                if (step.expectedResultId) {
                    const expectedResultContainer = steps.scenarioSteps[step.expectedResultId];
                    if (expectedResultContainer) {
                        let expectedResultText = '';
                        
                        if (expectedResultContainer.children && expectedResultContainer.children.length > 0) {
                            const expectedResultTexts = expectedResultContainer.children
                                .map(childId => {
                                    const childStep = steps.scenarioSteps[childId];
                                    return childStep?.body || '';
                                })
                                .filter(text => text.trim().length > 0);
                            expectedResultText = expectedResultTexts.join('\n');
                        } else if (expectedResultContainer.body && 
                                  expectedResultContainer.body !== 'Expected Result') {
                            expectedResultText = expectedResultContainer.body;
                        }
                        
                        if (expectedResultText.trim().length > 0) {
                            stepObj.expectedResult = expectedResultText;
                        }
                    }
                }

                // Если есть дочерние шаги, добавляем их
                if (step.body && step.body.includes("\n")) {
                    const childSteps = step.body
                        .split("\n")
                        .map(line => line.trim())
                        .filter(line => line);
                    if (childSteps.length > 0) {
                        stepObj.childStep = childSteps; // Добавляем дочерние шаги в отдельный массив
                        stepObj.description = step.body.split("\n")[0]; // Оставляем только первое описание
                    }
                }

                stepsResult.push(stepObj);
                stepIndex++;
            }
        }
    }
    return stepsResult; // Возвращаем JSON-форматированные шаги
}


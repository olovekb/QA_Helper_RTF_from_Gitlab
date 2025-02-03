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
    };

    // Форматируем шаги
    if (testCase.steps) {
        formattedTestCase.steps = await formatStepsAsJson(testCase.steps); // Форматируем шаги в JSON
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
                        description: sharedStep.body + ' - Общий шаг' || 'Нет описания общего шага',
                        type: 'sharedStep', // Тип шага для обозначения, что это общий шаг
                        childSteps: [], // Для хранения вложенных шагов
                    };

                    const sharedStepChildren = sharedStep.children || [];
                    sharedStepChildren.forEach((sharedStepId, sharedStepIndex) => {
                        const sharedStepStep = steps.sharedStepScenarioSteps[sharedStepId];
                        if (sharedStepStep) {
                            sharedStepObj.childSteps.push({
                                index: `${stepIndex}.${sharedStepIndex + 1}`,
                                description: sharedStepStep.body || 'Нет описания шага общего шага',
                                attachment: getAttachmentName(sharedStepStep.attachmentId) || null,
                            });
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


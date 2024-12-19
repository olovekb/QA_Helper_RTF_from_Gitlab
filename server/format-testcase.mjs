import chalk from 'chalk';
/**
 * Форматирует и выводит шаги теста с нумерацией.
 * @param {Object} steps - Объект с шагами.
 */
export async function formatSteps(steps) {
    let stepsResult = ''; // Строка для сбора шагов

    // Получаем порядок шагов из массива "children" в объекте "root"
    const stepOrder = steps.root.children;
    let stepIndex = 1; // Основная нумерация для шагов
    let stepInSharedStep = 1; // Индекс для шагов внутри общего шага (например 1.1, 1.2)

    // Функция для добавления имени вложения по attachmentId
    const printAttachmentName = (attachmentId) => {
        if (attachmentId && steps.attachments && steps.attachments[attachmentId]) {
            const attachment = steps.attachments[attachmentId];
            if (attachment) {
                stepsResult += `     Вложение: ${attachment.name || 'Без имени вложения'}\n`;
            }
        }
    };

    // Сначала обрабатываем все шаги по порядку
    for (const stepId of stepOrder) {
        const step = steps.scenarioSteps[stepId]; // Получаем сам шаг по ID

        if (step) {
            // Если шаг является общим, выводим название общего шага и его шаги
            if (step.sharedStepId) {
                const sharedStep = steps.sharedSteps[step.sharedStepId]; // Ищем общий шаг по ID

                if (sharedStep) {
                    stepsResult += `${stepIndex}. Общий шаг: ${sharedStep.body || 'Нет описания общего шага'}\n`;

                    // Если у общего шага есть шаги, выводим их
                    const sharedStepSteps = sharedStep.children || [];
                    sharedStepSteps.forEach(sharedStepId => {
                        const sharedStepStep = steps.sharedStepScenarioSteps[sharedStepId];
                        if (sharedStepStep) {
                            stepsResult += `   ${stepIndex}.${stepInSharedStep} ${chalk.green(sharedStepStep.body || 'Нет описания шага общего шага')}\n`;
                            printAttachmentName(sharedStepStep.attachmentId); // Выводим имя вложения, если есть
                            stepInSharedStep++; // Увеличиваем номер для дочернего шага
                        }
                    });

                    // После общего шага увеличиваем индекс и сбрасываем нумерацию для дочерних шагов
                    stepIndex++; // Переход к следующему основному шагу
                    stepInSharedStep = 1; // Сброс номера дочерних шагов
                } else {
                    stepsResult += chalk.red(`Не удалось найти общий шаг с ID ${step.sharedStepId}\n`);
                }
            } else {
                // Если это не общий шаг
                if (step.attachmentId) {
                    // Если есть вложение, выводим только вложение
                    printAttachmentName(step.attachmentId);
                } else {
                    // Если описания нет, выводим стандартное сообщение
                    stepsResult += `${stepIndex}. ${chalk.blue(step.body || 'Нет описания шага')}\n`;
                }
                stepIndex++; // Увеличиваем основной индекс
            }

            // Если у шага есть ожидаемый результат, выводим его
            if (step.expectedResultId) {
                const expectedResult = steps.scenarioSteps[step.expectedResultId];
                if (expectedResult) {
                    stepsResult += `Ожидаемый результат шага:\n`; // НЕ НУМЕРУЕМ строку "Ожидаемый результат шага"

                    // Выводим описание дочерних шагов ожидаемого результата
                    const expectedResultChildren = expectedResult.children || [];
                    expectedResultChildren.forEach(childId => {
                        const childStep = steps.scenarioSteps[childId];
                        if (childStep) {
                            // Если у дочернего шага нет описания, но есть вложение, выводим вложение
                            if (!childStep.body && childStep.attachmentId) {
                                printAttachmentName(childStep.attachmentId);
                            } else if (childStep.body) {
                                // Если описание есть, выводим его
                                stepsResult += `   . ${chalk.yellow(childStep.body || 'Нет описания дочернего шага в ожидаемом результате')}\n`;
                                printAttachmentName(childStep.attachmentId); // Выводим имя вложения, если есть
                            }
                        }
                    });
                }
            }
        }
    }

    return stepsResult; // Возвращаем строку с результатами шагов
}



/**
 * Форматирует и выводит тест-кейс, включая шаги.
 * @param {Object} testCase - Объект тест-кейса
 */
// Форматирует и возвращает тест-кейс, включая шаги.
export async function formatTestCase(testCase) {
    let result = ''; // Переменная для сборки результата в строку

    // Форматируем информацию о тест-кейсе
    result += chalk.bold('====== Тест-кейс ======\n');
    result += chalk.bold(`ID: ${chalk.cyan(testCase.id || 'Нет ID')}\n`);
    result += chalk.bold(`Название: ${chalk.green(testCase.name || 'Нет названия')}\n`);
    result += chalk.bold(`Задача Jira: ${chalk.yellow(testCase.issue?.[0]?.name || 'Нет задачи')}\n`);
    result += chalk.bold(`Статус тест-кейса: ${chalk.greenBright(testCase.status?.name || 'Нет статуса')}\n`);
    result += chalk.bold(`Слой тестирования: ${chalk.gray(testCase.layer?.name || 'Нет слоя')}\n`);
    result += chalk.bold(`Предусловие: ${chalk.gray(testCase.precondition || 'Нет предусловия')}\n`);

    // Форматируем кастомные поля
    if (testCase.customFields && Array.isArray(testCase.customFields) && testCase.customFields.length > 0) {
        result += chalk.bold('Кастомные поля:\n');
        testCase.customFields.forEach(field => {
            const fieldName = field.customField?.name || 'Неизвестное поле';
            const fieldValues = field.values && field.values.length > 0
                ? field.values.map(value => value.name).join(', ')
                : 'Нет значений';
            result += `${chalk.cyan(fieldName)}: ${chalk.magenta(fieldValues)}\n`;
        });
    } else {
        result += chalk.bold(`Кастомные поля: ${chalk.red('Нет кастомных полей')}\n`);
    }

    // Форматируем теги, если они есть
    if (testCase.tags?.length) {
        const tags = testCase.tags.map(tag => chalk.magenta(tag.name)).join(', ');
        result += chalk.bold(`Теги тест-кейса: ${tags}\n`);
    } else {
        result += chalk.bold(`Теги тест-кейса: ${chalk.red('Нет тегов')}\n`);
    }

    // Форматируем шаги тест-кейса с учётом вложенных шагов и нумерации
    if (testCase.steps?.scenarioSteps) {
        result += chalk.bold('Шаги тест-кейса:\n');
        const stepsResult = await formatSteps(testCase.steps); // Получаем шаги в строку
        result += stepsResult; // Добавляем шаги к итоговому результату
    } else {
        result += chalk.bold(`Шаги тест-кейса: ${chalk.red('Нет шагов')}\n`);
    }

    // Форматируем ожидаемый результат, если есть
    if (testCase.expectedResult) {
        result += chalk.bold(`Ожидаемый результат тест-кейса: ${chalk.red(testCase.expectedResult)}\n`);
    } else {
        result += chalk.bold(`Ожидаемый результат тест-кейса: ${chalk.red('Нет результата')}\n`);
    }

    result += chalk.bold('=========================\n');
    //console.log(result)
    // Возвращаем итоговую строку с результатом
    return result;
}




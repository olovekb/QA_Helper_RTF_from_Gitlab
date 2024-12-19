import stripAnsi from 'strip-ansi';

export function parseTestCaseResult(result) {
    // Удаляем все ANSI escape codes из строки
    const cleanResult = stripAnsi(result);
    console.log('Результат операции парсинга и очистки: ' + cleanResult);

    const lines = cleanResult.split('\n'); // Разбиваем текст на строки
    const parsed = {
        id: null,
        name: null,
        issue: null,
        status: null,
        layer: null,
        precondition: null,
        customFields: [],
        tags: [],
        steps: {
            sharedStep: [], // Для общих шагов
            expectedStep: [], // Для ожидаемых шагов
            regularStep: []  // Для обычных шагов
        },
        expectedResult: null
    };

    let inCustomFields = false;
    let inSteps = false;
    let inExpectedResult = false;

    let customFieldsAdded = {}; // Чтобы избежать дублирования кастомных полей
    let stepsAdded = new Set(); // Для проверки уникальности шагов

    let currentStep = null; // Текущий шаг, в который будем добавлять вложенные шаги и вложения

    lines.forEach((line, index) => {
        const trimmedLine = line.trim(); // Убираем лишние пробелы
        console.log(`Обрабатываем строку: ${trimmedLine}`);

        // Убираем нумерацию из начала строки (включая вложенную, например 1.1, 1.1.1 и т.д.)
        const cleanStep = trimmedLine.replace(/^\d+(\.\d+)*\s*\.?\s*/, ''); // Убираем нумерацию и точку, если она есть
        const cleanExpectedStep = cleanStep.replace(/^(\.\s*)/, ''); // Убираем точку в начале шага ожидаемого результата

        // Парсинг ID, Названия, и других полей
        if (cleanStep.startsWith('ID:')) {
            parsed.id = cleanStep.replace('ID:', '').trim();
        } else if (cleanStep.startsWith('Название:')) {
            parsed.name = cleanStep.replace('Название:', '').trim();
        } else if (cleanStep.startsWith('Задача Jira:')) {
            parsed.issue = cleanStep.replace('Задача Jira:', '').trim();
        } else if (cleanStep.startsWith('Статус тест-кейса:')) {
            parsed.status = cleanStep.replace('Статус тест-кейса:', '').trim();
        } else if (cleanStep.startsWith('Слой тестирования:')) {
            parsed.layer = cleanStep.replace('Слой тестирования:', '').trim();
        } else if (cleanStep.startsWith('Предусловие:')) {
            parsed.precondition = cleanStep.replace('Предусловие:', '').trim();
        } else if (cleanStep.startsWith('Кастомные поля:')) {
            inCustomFields = true;
            inSteps = false;
            inExpectedResult = false;
        } else if (cleanStep.startsWith('Теги тест-кейса:')) {
            inCustomFields = false;
            parsed.tags = cleanStep.replace('Теги тест-кейса:', '').trim().split(', ').filter(Boolean);
        } else if (cleanStep.startsWith('Шаги тест-кейса:')) {
            inCustomFields = false;
            inSteps = true;
            inExpectedResult = false;
        } else if (cleanStep.startsWith('Ожидаемый результат тест-кейса:')) {
            inSteps = false;
            inExpectedResult = true;
            parsed.expectedResult = cleanStep.replace('Ожидаемый результат тест-кейса:', '').trim();
        } else if (inCustomFields && cleanStep.includes(':')) {
            const [key, value] = cleanStep.split(':').map(s => s.trim());
            if (!customFieldsAdded[key]) {
                parsed.customFields.push({ name: key, value: value || 'Нет значений' });
                customFieldsAdded[key] = true;
            }
        } else if (inSteps) {
            // Обработка общих шагов
            if (cleanStep.includes("Общий шаг")) {
                currentStep = { type: 'sharedStep', steps: [cleanStep], attachments: [] };
                parsed.steps.sharedStep.push(currentStep); // Добавляем в общие шаги
                console.log(`Добавлен общий шаг: ${cleanStep}`);
            } 
            // Обработка ожидаемых шагов
            else if (cleanStep.includes("Ожидаемый результат шага")) {
                currentStep = { type: 'expectedStep', steps: [cleanExpectedStep], attachments: [] };
                parsed.steps.expectedStep.push(currentStep); // Добавляем в ожидаемые шаги
                console.log(`Добавлен ожидаемый шаг: ${cleanExpectedStep}`);
            }
            // Обработка обычных шагов
            else if (cleanStep.startsWith('•')) {
                if (currentStep) {
                    currentStep.steps.push(cleanStep);
                    console.log(`Добавлен вложенный шаг: ${cleanStep}`);
                    // Проверяем на вложения
                    if (cleanStep.includes('Вложение:')) {
                        const attachmentName = cleanStep.split('Вложение: ')[1].trim();
                        currentStep.attachments.push({ name: attachmentName });
                        console.log(`Добавлено вложение: ${attachmentName}`);
                    }
                }
            } 
            // Добавляем шаги в regularStep
            else {
                if (!stepsAdded.has(cleanStep)) {
                    parsed.steps.regularStep.push(cleanStep);
                    stepsAdded.add(cleanStep);
                    console.log(`Добавлен обычный шаг: ${cleanStep}`);
                }
            }
        }
    });

    console.log('Парсинг завершен:', JSON.stringify(parsed, null, 2));
    return parsed;
}

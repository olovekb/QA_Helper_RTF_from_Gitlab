import fetch from 'node-fetch';
import fs from 'fs';
import config from './config.json' assert { type: 'json' };

const model = 'EleutherAI/gpt-neox-20b';  // Используется для справки, Deepseek API – другая модель

// Вспомогательная функция для извлечения текста из шага
function extractStepText(step) {
    // Если есть явное поле body, используем его
    if (step.body && typeof step.body === 'string') {
        return step.body.trim();
    }
    // Если есть поле description
    if (step.description && typeof step.description === 'string') {
        return step.description.trim();
    }
    // Если есть структурированное поле bodyJson, пытаемся пройтись по его содержимому
    if (step.bodyJson && typeof step.bodyJson === 'object') {
        if (step.bodyJson.content && Array.isArray(step.bodyJson.content)) {
            // Объединяем текст из всех параграфов
            return step.bodyJson.content
                .map(paragraph => {
                    if (paragraph.content && Array.isArray(paragraph.content)) {
                        return paragraph.content.map(item => item.text || "").join(" ");
                    }
                    return "";
                })
                .join(" ");
        }
    }
    return "";
}

/**
 * Функция для преобразования строки шагов, содержащей маркеры "Expected Result"
 * в структурированный формат с нумерованными шагами.
 *
 * @param {string} rawStepsStr - исходная строка шагов, разделенная запятыми.
 * @returns {string} - форматированная строка шагов с ожидаемыми результатами.
 */
function transformSteps(rawStepsStr) {
    // Разбиваем строку по запятым и очищаем пробелы
    const tokens = rawStepsStr.split(',')
        .map(token => token.trim())
        .filter(token => token.length > 0);

    const steps = [];
    for (let i = 0; i < tokens.length; i++) {
        // Если токен равен "expected result" (без учета регистра), значит следующий токен –
        // ожидаемый результат для предыдущего шага
        if (tokens[i].toLowerCase() === 'expected result') {
            if (steps.length > 0 && i + 1 < tokens.length) {
                steps[steps.length - 1].expectedResult = tokens[i + 1];
                i++; // пропускаем следующий токен
            }
        } else {
            // Новый шаг
            steps.push({ action: tokens[i] });
        }
    }
    // Формируем читаемый вывод: нумерация, действие и ожидаемый результат (если есть)
    const formattedSteps = steps.map((step, idx) => {
        let result = `Шаг ${idx + 1}: ${step.action}`;
        if (step.expectedResult) {
            result += `\nОжидаемый результат: ${step.expectedResult}`;
        }
        return result;
    }).join('\n\n');

    return formattedSteps;
}

// Функция для анализа тест-кейса с использованием Deepseek API через OpenRouter
export async function analyzeTestCaseWithAI(testCase) {
    try {
        // Используем переданное имя или заменяем на "Неизвестно", если оно отсутствует
        const testName = testCase.name ? testCase.name : "Неизвестно";

        // Обработка шагов тест-кейса
        let stepsText = "";
        if (Array.isArray(testCase.steps)) {
            stepsText = testCase.steps
                .map(step => extractStepText(step))
                .filter(text => text !== "")
                .join(', ');
        } else if (testCase.steps && typeof testCase.steps === 'object') {
            if (testCase.steps.scenarioSteps && typeof testCase.steps.scenarioSteps === 'object') {
                const stepsArray = Object.values(testCase.steps.scenarioSteps);
                stepsText = stepsArray
                    .map(step => extractStepText(step))
                    .filter(text => text !== "")
                    .join(', ');
            } else {
                stepsText = JSON.stringify(testCase.steps);
            }
        }

        // Если в строке шагов присутствует маркер "expected result" (без учёта регистра),
        // преобразуем строку в форматированный вывод
        if (/expected result/i.test(stepsText)) {
            stepsText = transformSteps(stepsText);
        }

        // Преобразование кастомных полей: если значение – объект, выводим его поле name, иначе JSON.stringify
        const customFieldsText = Array.isArray(testCase.customFields)
            ? testCase.customFields
                .map(cf => {
                    if (cf.customField && cf.customField.name) {
                        let values = 'нет';
                        if (Array.isArray(cf.values) && cf.values.length > 0) {
                            values = cf.values
                                .map(v => {
                                    if (typeof v === 'object') {
                                        return v.name ? v.name : JSON.stringify(v);
                                    }
                                    return v;
                                })
                                .join(', ');
                        }
                        return `${cf.customField.name}: ${values}`;
                    }
                    return null;
                })
                .filter(Boolean)
                .join('; ')
            : '';

        const prompt = `Ты — ведущий QA-инженер и наставник в нашей команде. Твоя задача — провести ревью тест-кейса, написанного моим коллегой, и дать ему конструктивную обратную связь.

Проанализируй тест-кейс, основываясь на нашем внутреннем стайлгайде. Вот ключевые правила из него:
--- НАШ СТАЙЛГАЙД ---
1.  **Название:** Краткое, информативное, отражает суть. Пример хорошего: "Загрузка нового справочника".
2.  **Шаги:** Один шаг — одно действие. Начинается с глагола в неопределенной форме ("Открыть", "Нажать"). Без конструкций "Если... то...". Для API-тестов обязательно указывать метод, URL, заголовки, тело запроса.
3.  **Ожидаемый результат:** Обязателен. Описывает конечное состояние системы. Без субъективных слов ("хорошо", "быстро", "нормально") и без "Если... то...".
4.  **Атомарные vs Сценарные тесты:** Сценарные (E2E) начинаются с полного пути пользователя. Атомарные (Integration) — с конкретного действия, без шагов авторизации и т.д.
5.  **Метаданные:** Теги (D, M, S, A, PWA), Слой (E2E, Integration...), Приоритет, Версия, и ссылка на задачу в Jira — обязательны.
--- КОНЕЦ СТАЙЛГАЙДА ---

Теперь, вот данные тест-кейса для анализа:
----------------------------------------------------------
Название теста: ${testName}
Слой: ${testCase.layer && testCase.layer.name ? testCase.layer.name : 'не указан'}
Предусловия: ${testCase.precondition || 'не указаны'}
Шаги теста:
${stepsText || 'не указаны'}

Ожидаемый результат: ${testCase.expectedResult || 'не указан'}
----------------------------------------------------------

Проведи детальный анализ по следующим пунктам, ссылаясь на наш стайлгайд:
1.  **Анализ Названия:** Насколько оно соответствует правилу №1?
2.  **Анализ Шагов:** Все ли шаги соответствуют правилу №2? Есть ли лишние или недостающие действия? Если это API-тест, все ли данные на месте?
3.  **Анализ Ожидаемого результата:** Соответствует ли он правилу №3? Является ли он однозначным?
4.  **Соответствие типу теста:** Похоже ли описание на атомарный или сценарный тест, и соответствует ли это выбранному слою (правило №4)?
5.  **Общие рекомендации:** Что еще можно улучшить, чтобы тест-кейс стал эталонным? Предложи конкретные переформулировки, если это необходимо.

Твой ответ должен быть структурированным, вежливым и полезным для автора тест-кейса.
`;

        console.log(prompt);
        // Подготовка запроса к OpenRouter API с использованием модели deepseek/deepseek-chat:free
        const API_TOKEN = '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';
        const URL = 'https://openrouter.ai/api/v1/chat/completions';
        const headers = {
            "Authorization": `Bearer ${API_TOKEN}`,
            "HTTP-Referer": "<YOUR_SITE_URL>", // замените на URL вашего сайта
            "X-Title": "<YOUR_SITE_NAME>",       // замените на название вашего сайта
            "Content-Type": "application/json"
        };

        const body = JSON.stringify({
            model: "deepseek/deepseek-chat:free",
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const response = await fetch(URL, {
            method: "POST",
            headers,
            body
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(`Ошибка при генерации ответа: ${data.error}`);
        }

        // Извлечение текста ответа (формат чата)
        let responseText = "";
        if (data.choices && data.choices.length > 0 &&
            data.choices[0].message && data.choices[0].message.content) {
            responseText = data.choices[0].message.content.trim();
        } else if (data.text) {
            responseText = data.text.trim();
        }

        if (responseText) {
            const filename = 'response.txt';
            fs.writeFileSync(filename, responseText, 'utf8');
            console.log(`Ответ успешно записан в файл ${filename}`);
            const cleanResponse = removeTextBeforeSuggestion(responseText);
            return cleanResponse;
        } else {
            throw new Error('Ответ от модели пустой');
        }
    } catch (error) {
        console.error('Ошибка analyzeTestCaseWithAI:', error.message);
        throw error;
    }
}

function removeTextBeforeSuggestion(inputText) {
    // Удаляем всё до фразы "Предложи улучшения для теста." (если присутствует)
    const regex = /.*(Предложи улучшения для теста\.)/s;
    const result = inputText.replace(regex, '$1').trim();
    return result;
}

import fetch from 'node-fetch';
import fs from 'fs';
import config from './config.json' assert { type: 'json' };


function extractStepText(step) {
    if (step.body && typeof step.body === 'string') {
        return step.body.trim();
    }
    if (step.description && typeof step.description === 'string') {
        return step.description.trim();
    }
    if (step.bodyJson && typeof step.bodyJson === 'object') {
        if (step.bodyJson.content && Array.isArray(step.bodyJson.content)) {
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

function transformSteps(rawStepsStr) {
    const tokens = rawStepsStr.split(',')
        .map(token => token.trim())
        .filter(token => token.length > 0);
    const steps = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].toLowerCase() === 'expected result') {
            if (steps.length > 0 && i + 1 < tokens.length) {
                steps[steps.length - 1].expectedResult = tokens[i + 1];
                i++;
            }
        } else {
            steps.push({ action: tokens[i] });
        }
    }
    const formattedSteps = steps.map((step, idx) => {
        let result = `Шаг ${idx + 1}: ${step.action}`;
        if (step.expectedResult) {
            result += `\nОжидаемый результат: ${step.expectedResult}`;
        }
        return result;
    }).join('\n\n');
    return formattedSteps;
}


// --- ДОБАВЛЕНО: Новая функция-помощник для форматирования шагов ---
/**
 * Преобразует строку шагов, разделенных запятыми, в нумерованный список.
 * @param {string} rawSteps - Исходная строка с шагами.
 * @returns {string} - Форматированная строка с нумерованными шагами.
 */
function formatStepsFromString(rawSteps) {
    if (!rawSteps || typeof rawSteps !== 'string') {
        return 'не указаны';
    }
    return rawSteps
        .split(',')
        .map(step => step.trim())
        .filter(step => step.length > 0)
        .map((step, index) => {
            const capitalizedStep = step.charAt(0).toUpperCase() + step.slice(1);
            return `${index + 1}. ${capitalizedStep}`;
        })
        .join('\n');
}

// --- ИЗМЕНЕНО: Основная функция анализа ---
export async function analyzeTestCaseWithAI(testCase) {
    try {
        const testName = testCase.name ? testCase.name : "Неизвестно";

        // --- ИЗМЕНЕНО: Логика обработки шагов ---
        let stepsText = "";
        let rawStepsArray = [];

        // 1. Сначала извлекаем шаги в виде массива текстовых строк
        if (Array.isArray(testCase.steps)) {
            rawStepsArray = testCase.steps
                .map(step => extractStepText(step))
                .filter(text => text !== "");
            // Объединяем в строку, чтобы проверить на 'expected result'
            stepsText = rawStepsArray.join(', ');

        } else if (testCase.steps && typeof testCase.steps === 'object') {
            if (testCase.steps.scenarioSteps && typeof testCase.steps.scenarioSteps === 'object') {
                rawStepsArray = Object.values(testCase.steps.scenarioSteps)
                    .map(step => extractStepText(step))
                    .filter(text => text !== "");
                stepsText = rawStepsArray.join(', ');
            } else {
                stepsText = JSON.stringify(testCase.steps);
            }
        }

        // 2. Форматируем шаги в нумерованный список
        let formattedStepsForPrompt = '';
        if (/expected result/i.test(stepsText)) {
            // Если есть специальный маркер, используем старую логику
            formattedStepsForPrompt = transformSteps(stepsText);
        } else {
            // Иначе используем нашу новую функцию для создания красивого списка
            formattedStepsForPrompt = formatStepsFromString(stepsText);
        }

        const customFieldsText = Array.isArray(testCase.customFields)
            ? testCase.customFields
                .map(cf => {
                    if (cf.customField && cf.customField.name) {
                        let values = 'нет';
                        if (Array.isArray(cf.values) && cf.values.length > 0) {
                            values = cf.values
                                .map(v => {
                                    if (typeof v === 'object' && v !== null) {
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

        // --- ИЗМЕНЕНО: Вставляем отформатированные шаги в промпт ---
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
${formattedStepsForPrompt || 'не указаны'}

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

        console.log(prompt); // Можно раскомментировать для отладки


        const API_TOKEN = config.openRouterAiKey;
        if (!API_TOKEN) {
            throw new Error("Не найден OPENROUTER_API_KEY. Проверьте ваш .env файл.");
        }

        const URL = 'https://openrouter.ai/api/v1/chat/completions';
        const headers = {
            "Authorization": `Bearer ${API_TOKEN}`,
            "HTTP-Referer": config.siteUrl || "http://localhost",
            "X-Title": config.siteName || "TestCase Analyzer",
            "Content-Type": "application/json"
        };

        const body = JSON.stringify({
            model: "deepseek/deepseek-chat:free",
            messages: [{ role: "user", content: prompt }]
        });

        const response = await fetch(URL, { method: "POST", headers, body });
        const data = await response.json();

        if (data.error) {
            throw new Error(`Ошибка API: ${data.error.message || JSON.stringify(data.error)}`);
        }

        let responseText = "";
        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            responseText = data.choices[0].message.content.trim();
        } else if (data.text) {
            responseText = data.text.trim();
        }

        if (responseText) {
            const filename = 'response.txt';
            fs.writeFileSync(filename, responseText, 'utf8');
            console.log(`Ответ успешно записан в файл ${filename}`);
            return removeTextBeforeSuggestion(responseText);
        } else {
            throw new Error('Ответ от модели пустой');
        }
    } catch (error) {
        console.error('Ошибка в функции analyzeTestCaseWithAI:', error.message);
        // Возвращаем сообщение об ошибке, чтобы его можно было показать в интерфейсе
        return `Произошла ошибка при анализе: ${error.message}`;
    }
}

function removeTextBeforeSuggestion(inputText) {
    const regex = /.*(Предложи улучшения для теста\.)/s;
    const result = inputText.replace(regex, '$1').trim();
    return result;
}
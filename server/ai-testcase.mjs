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

// Функция для анализа тест-кейса с использованием Deepseek API через OpenRouter
export async function analyzeTestCaseWithAI(testCase) {
    try {
        // Проверяем название теста: если не задано, используем "Неизвестно"
        const testName = testCase.name ? testCase.name : "Неизвестно";

        // Обработка шагов тест-кейса
        let stepsText = "";
        if (Array.isArray(testCase.steps)) {
            // Если steps – массив, проходим по каждому шагу
            stepsText = testCase.steps
                .map(step => extractStepText(step))
                .filter(text => text !== "")
                .join(', ');
        } else if (testCase.steps && typeof testCase.steps === 'object') {
            // Если steps – объект и содержит ключ scenarioSteps
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

        // Преобразование кастомных полей: Если значение – объект, выводим его поле name, иначе JSON.stringify
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
        const prompt = `Ты ведущий эксперт в области тестирования программного обеспечения с более чем 10-летним опытом в разработке тест-кейсов, автоматизации тестирования и методологиях контроля качества. Проанализируй следующий тест-кейс с особым вниманием к деталям и сопоставь его с лучшими практиками в индустрии.

            Обрати внимание на следующие аспекты:
            1. **Название тест-кейса:** Убедись, что название является лаконичным, информативным и полностью отражает суть теста.
            2. **Слой тестирования:** Оцени, соответствует ли выбранный слой (например, E2E Tests) требованиям тестируемой функциональности и архитектуре системы.
            3. **Предварительные условия:** Проверь, насколько полно и однозначно описаны начальные условия, включая требуемые данные и конфигурации системы.
            4. **Шаги теста:** Проанализируй последовательность и подробное описание каждого шага, а также то, как они способствуют достижению цели тест-кейса. Отметь возможные неоднозначности или недостатки в описании действий.
            5. **Ожидаемый результат:** Оцени, насколько четко и подробно сформулирован ожидаемый результат, и соответствует ли он тестовым требованиям.
            6. **Общие рекомендации:** Предложи дополнительные улучшения для повышения качества и надёжности тест-кейса (например, улучшения в структурировании, детализации или использовании стандартной терминологии).
            
            Ниже приведены данные тест-кейса:
            ----------------------------------------------------------
            Название теста: ${testName}
            Слой: ${testCase.layer && testCase.layer.name ? testCase.layer.name : 'нет'}
            Предварительные условия: ${testCase.precondition || 'нет'}
            Шаги теста: ${stepsText || 'нет'}
            Ожидаемый результат: ${testCase.expectedResult || 'нет'}'}
            ----------------------------------------------------------
            
            Дай подробный экспертный анализ и сформулируй конкретные рекомендации по улучшению данного тест-кейса, обосновав каждую рекомендацию примерами и ссылаясь на лучшие практики тестирования.
            `;


        console.log(prompt)
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

        // Извлечение текста ответа (используем формат чата: data.choices[0].message.content)
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
    // Если в ответе присутствует лишний текст до фразы "Предложи улучшения для теста.",
    // удаляем его. При необходимости настроить регулярное выражение.
    const regex = /.*(Предложи улучшения для теста\.)/s;
    const result = inputText.replace(regex, '$1').trim();
    return result;
}

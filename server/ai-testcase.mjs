import fetch from 'node-fetch';
import fs from 'fs';
import config from './config.json' assert { type: 'json' };

const apiKey = config.huggingfaceToken;
const model = 'EleutherAI/gpt-neox-20b';  // Модель для использования

// Функция для анализа тест-кейса с использованием модели
export async function analyzeTestCaseWithAI(testCase) {
    try {
        const input = {
            name: testCase.name,
            steps: testCase.steps.map((step) => step.description).join(', '),
            expectedResult: testCase.expectedResult,
        };

        // Создаем prompt для модели
        const prompt = `Ты эксперт по тестированию ПО. Проанализируй этот тест-кейс и предложи улучшения:
        - Название теста: ${input.name}
        - Шаги теста:
          ${input.steps}
        - Ожидаемый результат:
          ${input.expectedResult}
        Предложи улучшения для теста.`;

        // Запрос к Hugging Face API
        const url = `https://api-inference.huggingface.co/models/${model}`;
        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };

        const body = JSON.stringify({
            inputs: prompt,
            parameters: {
                max_length: 2048, // Увеличиваем максимальную длину до 2048 токенов
                do_sample: false,  // Включаем случайную выборку ответов
                top_p: 0.9,       // Контроль разнообразия
                temperature: 0.7, // Температура генерации
            }
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(`Ошибка при генерации ответа: ${data.error}`);
        }

        let responseText = data[0].generated_text.trim();  // Получаем ответ от модели и обрезаем лишние пробелы

        // Если ответ не пустой, удаляем prompt из начала ответа
        if (responseText) {
            const filename = 'response.txt';

            // Записываем результат в текстовый файл
            fs.writeFileSync(filename, responseText, 'utf8');
            console.log(`Ответ успешно записан в файл ${filename}`);
            // Убираем весь текст, который соответствует prompt
            const cleanResponse = removeTextBeforeSuggestion(responseText)
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
    // Регулярное выражение для поиска текста до "Предложи улучшения для теста."
    const regex = /.*(Предложи улучшения для теста\.)/s;

    // Заменяем все до фразы "Предложи улучшения для теста." на пустую строку
    const result = inputText.replace(regex, '$1').trim();

    return result;
}
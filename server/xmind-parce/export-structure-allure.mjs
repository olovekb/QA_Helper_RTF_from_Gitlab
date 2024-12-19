import axios from 'axios';
import { readFileSync } from 'fs';
import config from '../config.json' assert { type: 'json' };
import { getJwtToken } from '../http-service.mjs';

// Конфигурация
const BASE_URL = config.baseUrl;
const API_TOKEN = await getJwtToken();
const HEADERS = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
};

// Настройка Axios
const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: HEADERS
});

// Функция для логирования запроса и ответа
async function logRequestAndResponse(promise, method, url, data) {
    try {
        console.log(`Запрос ${method.toUpperCase()} ${url}`);
        if (data) console.log(`Тело запроса: ${JSON.stringify(data)}`);

        const response = await promise;

        console.log(`Ответ от ${method.toUpperCase()} ${url}`);
        console.log(`Статус: ${response.status}`);
        console.log(`Ответ: ${JSON.stringify(response.data)}`);

        return response;
    } catch (error) {
        if (error.response) {
            console.error(`Ошибка запроса ${method.toUpperCase()} ${url}`);
            console.error(`Статус: ${error.response.status}`);
            console.error(`Ответ: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(`Ошибка запроса ${method.toUpperCase()} ${url}: ${error.message}`);
        }
        throw error;
    }
}

// Функция для получения кастомных полей по проекту
async function getCustomFieldId(fieldName) {
    try {
        const url = '/cfschema';
        const params = { projectId: config.projectId };
        const response = await logRequestAndResponse(apiClient.get(url, { params }), 'get', url, params);

        const customFields = response.data.content;
        const field = customFields.find(f => f.customField.name === fieldName);

        if (field) {
            console.log(`ID кастомного поля для "${fieldName}": ${field.customField.id}`);
            return field.customField.id;
        } else {
            console.error(`Поле ${fieldName} не найдено`);
            return null;
        }
    } catch (error) {
        console.error(`Ошибка при получении кастомных полей: ${error.message}`);
        return null;
    }
}

// Функция для создания тест-кейса
async function createTestCase(testCase, id) {
    try {
        const url = '/testcase';
        const body = {
            projectId: id,
            name: testCase.name,
        };
        const response = await logRequestAndResponse(apiClient.post(url, body), 'post', url, body);
        console.log(`Тест-кейс создан: ${response.data.id} ${response.data.name}`);
        return response.data.id;
    } catch (error) {
        console.error(`Ошибка при создании тест-кейса: ${error.message}`);
    }
}

// Функция для создания значений кастомных полей
async function createCustomFieldValue(customFieldId, value) {
    try {
        const url = '/cfv';
        const body = {
            name: value,
            customField: { id: customFieldId },
        };
        const response = await logRequestAndResponse(apiClient.post(url, body), 'post', url, body);
        console.log(`Создано значение кастомного поля -  "${value}": ${response.data.id}`);
        return response.data.id;
    } catch (error) {
        console.error(`Ошибка при создании значения кастомного поля: ${error.message}`);
    }
}

// Функция для добавления кастомных полей в тест-кейс
// Функция для создания всех значений кастомных полей и отправки их одним запросом
async function addCustomFieldsToTestCase(testCaseId, customFields) {
    try {
        // Собираем все значения кастомных полей
        const customFieldValues = [];

        for (const field of customFields) {
            // Создаем значение кастомного поля
            const fieldValueId = await createCustomFieldValue(field.id, field.value);

            if (!fieldValueId) {
                console.error(
                    `Не удалось создать значение для кастомного поля "${field.value}" (ID поля: ${field.id})`
                );
                continue; // Пропускаем это поле
            }

            // Добавляем в массив всех кастомных полей
            customFieldValues.push({
                customField: { id: field.id },
                id: fieldValueId,
                name: field.value,
            });
        }

        // Если есть значения кастомных полей для отправки
        if (customFieldValues.length > 0) {
            // Отправляем запрос с массивом значений кастомных полей
            const response = await apiClient.post(`/testcase/${testCaseId}/cfv`, customFieldValues);

            if (response.data && response.data.length > 0) {
                console.log(
                    `Кастомные поля добавлены в тест-кейс ${testCaseId}: ${JSON.stringify(response.data)}`
                );
            } else {
                console.error(`Ошибка при добавлении кастомных полей в тест-кейс ${testCaseId}`);
            }
        } else {
            console.log(`Нет кастомных полей для добавления в тест-кейс ${testCaseId}`);
        }
    } catch (error) {
        console.error(`Ошибка при добавлении кастомных полей в тест-кейс ${testCaseId}: ${error.message}`);
    }
}

// Основная функция
export async function main() {
    try {
        const featureFieldId = await getCustomFieldId('Feature');
        const storyFieldId = await getCustomFieldId('Story');
        const scenarioFieldId = await getCustomFieldId('Scenario');

        if (!featureFieldId || !storyFieldId || !scenarioFieldId) {
            console.error('Не удалось получить ID кастомных полей!');
            return;
        }

        const parsedJson = JSON.parse(readFileSync('./allure_structure.json', 'utf-8'));

        for (const storyObj of parsedJson.stories) {
            const story = storyObj.story || 'Не указано'; // Значение по умолчанию
            const feature = parsedJson.feature || 'Не указано'; // Значение по умолчанию

            for (const scenarioObj of storyObj.scenarios) {
                const scenario = scenarioObj.scenario;

                const customFields = [
                    { id: featureFieldId, value: feature },
                    { id: storyFieldId, value: story },
                    { id: scenarioFieldId, value: scenario },
                ];
                // Создаем тест-кейс
                const testCaseId = await createTestCase({ name: scenario });

                if (!testCaseId) {
                    console.error(`Ошибка создания тест-кейса для сценария "${scenario}"`);
                    continue; // Переходим к следующему, если не удалось создать тест-кейс
                }
                // Добавляем кастомные поля в тест-кейс
                await addCustomFieldsToTestCase(testCaseId, customFields);

                console.log(`Кастомные поля добавлены в тест-кейс ${testCaseId}`);
            }
        }

        console.log('Все тест-кейсы успешно созданы и кастомные поля добавлены!');
    } catch (error) {
        console.error(`Ошибка выполнения: ${error.message}`);
    }
}


export async function exportStructureAlure(parsedJson, id) {
    try {
        const featureFieldId = await getCustomFieldId('Feature');
        const storyFieldId = await getCustomFieldId('Story');
        const scenarioFieldId = await getCustomFieldId('Scenario');

        if (!featureFieldId || !storyFieldId || !scenarioFieldId) {
            console.error('Не удалось получить ID кастомных полей!');
            return;
        }

        // Обрабатываем каждый feature в parsedJson
        for (const featureObj of parsedJson) {
            const feature = featureObj.feature || 'Не указано'; // Значение по умолчанию

            // Обрабатываем каждый story для текущего feature
            for (const storyObj of featureObj.stories) {
                const story = storyObj.story || 'Не указано'; // Значение по умолчанию

                // Обрабатываем каждый scenario для текущего story
                for (const scenarioObj of storyObj.scenarios) {
                    const scenario = scenarioObj.scenario;

                    const customFields = [
                        { id: featureFieldId, value: feature },
                        { id: storyFieldId, value: story },
                        { id: scenarioFieldId, value: scenario },
                    ];

                    // Создаем тест-кейс
                    const testCaseId = await createTestCase({ name: scenario }, id);

                    if (!testCaseId) {
                        console.error(`Ошибка создания тест-кейса для сценария "${scenario}"`);
                        continue; // Переходим к следующему, если не удалось создать тест-кейс
                    }

                    // Добавляем кастомные поля в тест-кейс
                    await addCustomFieldsToTestCase(testCaseId, customFields);

                    console.log(`Кастомные поля добавлены в тест-кейс ${testCaseId}`);
                }
            }
        }

        console.log('Все тест-кейсы успешно созданы и кастомные поля добавлены!');
    } catch (error) {
        console.error(`Ошибка выполнения: ${error.message}`);
    }
}




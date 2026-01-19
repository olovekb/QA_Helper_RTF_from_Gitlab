import axios from 'axios';
import config from '../config.json' assert { type: 'json' };
import { getJwtToken } from '../http-service.mjs';
import {customProjectField, projectTestCaseLayers} from "./customProjectField.js";

// Конфигурация
const BASE_URL = config.baseUrl;
const API_TOKEN = await getJwtToken();
const HEADERS = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
};
let isRefreshing = false; // Флаг для предотвращения одновременного обновления токена
let refreshSubscribers = []; // Очередь запросов, ожидающих обновления токена

// Утилита для повторного выполнения запросов
function onTokenRefreshed(newToken) {
    refreshSubscribers.forEach(callback => callback(newToken));
    refreshSubscribers = [];
}

function addRefreshSubscriber(callback) {
    refreshSubscribers.push(callback);
}

// Настройка Axios
const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: HEADERS
});

// Перехватчик для обработки ошибок
apiClient.interceptors.response.use(
    response => response,
    async error => {
        const { config, response } = error;

        // Проверяем, есть ли ошибка 401
        if (response && response.status === 401 && !config._retry) {
            console.log('Получен 401 Unauthorized. Обновляем токен...');

            // Помечаем запрос для повторного выполнения
            config._retry = true;

            // Если уже идет обновление токена, ждем
            if (isRefreshing) {
                return new Promise(resolve => {
                    addRefreshSubscriber(newToken => {
                        config.headers['Authorization'] = `Bearer ${newToken}`;
                        resolve(apiClient(config));
                    });
                });
            }

            // Обновляем токен
            isRefreshing = true;
            try {
                const newToken = await getJwtToken(); // Получаем новый токен

                // Обновляем заголовки по умолчанию
                apiClient.defaults.headers['Authorization'] = `Bearer ${newToken}`;

                // Уведомляем подписчиков
                onTokenRefreshed(newToken);

                // Выполняем повторный запрос
                config.headers['Authorization'] = `Bearer ${newToken}`;
                return apiClient(config);
            } catch (refreshError) {
                console.error('Ошибка обновления токена:', refreshError);
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

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

export async function getTestLayerListRequest() {
    const url = `/testlayer/suggest`;
    const params = { size: 20 };

    const response = await logRequestAndResponse(apiClient.get(url, { params }), 'get', url, params);

    return response.data;
}

export async function changeTestCaseLayerRequest(testCaseId, layerId) {
    const url = `/testcase/${testCaseId}`;
    const body = { testLayerId: layerId };
    const response = await logRequestAndResponse(apiClient.patch(url, body), 'patch', url, body);
    return response.data;
}

// Функция для получения кастомных полей по проекту
async function getProjectCustomFieldIdRequest(projectCustomFieldName, projectId) {
    try {
        const url = '/cfschema';
        const params = { projectId: projectId };
        const response = await logRequestAndResponse(apiClient.get(url, { params }), 'get', url, params);
        const customFields = response.data.content;

        // Получаем модель кастомного поля из массива полей по названию названию кастомного поля проекта
        const fieldModel = customFields.find(f => f.customField.name === projectCustomFieldName);

        // Если поле с таким названием есть, то возвращаем его id, иначе null
        if (fieldModel) {
            console.log(`ID кастомного поля для "${projectCustomFieldName}": ${fieldModel.customField.id}`);

            return fieldModel.customField.id;
        } else {
            console.error(`Кастомное поле ${projectCustomFieldName} не найдено в проекте`);

            return null;
        }
    } catch (error) {
        console.error(`Ошибка при получении кастомных полей: ${error.message}`);

        return null;
    }
}

// Функция для получения кастомных полей тест-кейса
async function getTestCaseCustomFieldsLocal(testCaseId, projectId) {
    try {
        const url = `/testcase/${testCaseId}/cfv`;
        const params = { projectId, v2: true };
        const response = await logRequestAndResponse(
            apiClient.get(url, { params }),
            'get',
            url,
            params
        );
        return response.data;
    } catch (error) {
        console.error(`Ошибка при получении кастомных полей для ТК ${testCaseId}:`, error.message);
        return [];
    }
}

// Функция для поиска тест-кейса по названию и кастомным полям
async function findTestCaseByName(projectId, name, expectedCustomFields = {}) {
    if (!projectId || !name) {
        return null;
    }
    
    try {
        const url = '/testcase';
        let page = 0;
        const size = 100;
        const normalizedName = name.trim().toLowerCase();
        
        // Нормализуем ожидаемые кастомные поля
        const normalizedExpectedFields = {};
        for (const [fieldName, fieldValue] of Object.entries(expectedCustomFields)) {
            if (fieldValue != null && fieldValue !== '') {
                const normalizedFieldName = String(fieldName).trim().toLowerCase();
                const normalizedFieldValue = String(fieldValue).trim().toLowerCase();
                normalizedExpectedFields[normalizedFieldName] = normalizedFieldValue;
            }
        }
        
        while (true) {
            const params = { projectId, page, size };
            const response = await logRequestAndResponse(
                apiClient.get(url, { params }), 
                'get', 
                url, 
                params
            );
            
            const data = response.data;
            
            // Ищем тест-кейсы с таким же названием
            const candidates = data.content?.filter(tc => 
                tc.name && tc.name.trim().toLowerCase() === normalizedName
            ) || [];
            
            // Если нет кастомных полей для проверки, возвращаем первый найденный
            if (Object.keys(normalizedExpectedFields).length === 0 && candidates.length > 0) {
                return candidates[0];
            }
            
            // Проверяем кастомные поля для каждого кандидата
            for (const candidate of candidates) {
                try {
                    const customFields = await getTestCaseCustomFieldsLocal(candidate.id, projectId);
                    
                    // Нормализуем кастомные поля существующего тест-кейса
                    // Важно: для multi-select полей (например, Code) нужно проверять все значения
                    const candidateFields = {};
                    if (Array.isArray(customFields)) {
                        for (const cf of customFields) {
                            const fieldName = cf?.customField?.name || cf?.name;
                            if (!fieldName) continue;
                            
                            const normalizedFieldName = String(fieldName).trim().toLowerCase();
                            
                            // Извлекаем значения: может быть одно значение или массив значений
                            let fieldValues = [];
                            if (cf?.values && Array.isArray(cf.values) && cf.values.length > 0) {
                                // Multi-select поле - берем все значения
                                fieldValues = cf.values.map(v => {
                                    const val = v?.name || v;
                                    return val ? String(val).trim().toLowerCase() : null;
                                }).filter(Boolean);
                            } else if (cf?.name) {
                                // Single-select поле
                                fieldValues = [String(cf.name).trim().toLowerCase()];
                            }
                            
                            if (fieldValues.length > 0) {
                                // Для полей с несколькими значениями сохраняем массив, для одного - строку
                                candidateFields[normalizedFieldName] = fieldValues.length === 1 
                                    ? fieldValues[0] 
                                    : fieldValues;
                            }
                        }
                    }
                    
                    // Сравниваем кастомные поля
                    // Важно: проверяем только важные поля (Feature, Story, Scenario, Code, Block, SubBlock)
                    const importantFields = ['feature', 'story', 'scenario', 'code', 'block', 'subblock'];
                    let fieldsMatch = true;
                    
                    for (const [expectedFieldName, expectedFieldValue] of Object.entries(normalizedExpectedFields)) {
                        // Пропускаем поля, которые не важны для проверки дублей
                        if (!importantFields.includes(expectedFieldName)) {
                            continue;
                        }
                        
                        const candidateValue = candidateFields[expectedFieldName];
                        
                        if (!candidateValue) {
                            // Поле отсутствует в существующем тест-кейсе
                            fieldsMatch = false;
                            break;
                        }
                        
                        // Если это массив (multi-select поле), проверяем, содержится ли значение в массиве
                        if (Array.isArray(candidateValue)) {
                            if (!candidateValue.includes(expectedFieldValue)) {
                                fieldsMatch = false;
                                break;
                            }
                        } else {
                            // Одно значение - точное совпадение
                            if (candidateValue !== expectedFieldValue) {
                                fieldsMatch = false;
                                break;
                            }
                        }
                    }
                    
                    // Если все поля совпадают, возвращаем этот тест-кейс
                    if (fieldsMatch && Object.keys(normalizedExpectedFields).length > 0) {
                        console.log(`[findTestCaseByName] ✅ Найден дубль: ТК ${candidate.id} "${candidate.name}"`);
                        console.log(`[findTestCaseByName] Ожидаемые поля:`, normalizedExpectedFields);
                        console.log(`[findTestCaseByName] Поля кандидата:`, candidateFields);
                        return candidate;
                    } else if (!fieldsMatch) {
                        console.log(`[findTestCaseByName] ⚠️ ТК ${candidate.id} не подходит: поля не совпадают`);
                        console.log(`[findTestCaseByName] Ожидаемые:`, normalizedExpectedFields);
                        console.log(`[findTestCaseByName] Фактические:`, candidateFields);
                    }
                    
                    // Если не было ожидаемых полей, но название совпало - возвращаем первый
                    if (Object.keys(normalizedExpectedFields).length === 0) {
                        return candidate;
                    }
                } catch (error) {
                    console.warn(`Ошибка при получении кастомных полей для ТК ${candidate.id}:`, error.message);
                    // Продолжаем проверку других кандидатов
                }
            }
            
            if (data.last) break;
            page += 1;
        }
        
        return null;
    } catch (error) {
        console.error(`Ошибка при поиске тест-кейса по названию "${name}":`, error.message);
        return null;
    }
}

// Вспомогательная функция для преобразования массива кастомных полей в объект для поиска
// Принимает массив полей с id и value, и маппинг id -> название поля
function buildExpectedCustomFieldsFromArray(customFieldsArray, fieldIdToNameMap) {
    const result = {};
    for (const field of customFieldsArray || []) {
        const fieldName = fieldIdToNameMap[field.id];
        if (fieldName && field.value) {
            result[fieldName] = field.value;
        }
    }
    return result;
}

// Функция для создания тест-кейса
async function createTestCase(testCase, projectId, expectedCustomFields = {}) {
    try {
        // Проверяем, существует ли уже тест-кейс с таким названием и кастомными полями
        console.log(`[createTestCase] Проверяем дубли для тест-кейса "${testCase.name}" с полями:`, JSON.stringify(expectedCustomFields));
        const existing = await findTestCaseByName(projectId, testCase.name, expectedCustomFields);
        if (existing) {
            console.log(`[createTestCase] ✅ Тест-кейс с названием "${testCase.name}" и такими же кастомными полями уже существует (ID: ${existing.id}). Пропускаем создание и обновление.`);
            return null; // Возвращаем null, чтобы вызывающий код пропустил дальнейшую обработку
        }
        console.log(`[createTestCase] ✅ Дублей не найдено, создаем новый тест-кейс "${testCase.name}"`);
        
        const url = '/testcase';
        const body = {
            projectId: projectId,
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

/**
 * Экспорт XMIND в Allure для Ноукода
 * @param parsedJson - распарсенный json
 * @param projectId - projectId
 * @returns {Promise<void>}
 */
export async function exportStructureAllureNocode(parsedJson, projectId) {
    try {
        console.log('ЗАШЛИ В ЭКСПОРТ')
        // Получаем список слоев один раз для маппинга названий в ID
        const layerListResp = await getTestLayerListRequest();
        const E2E_LAYER_ID = getLayerIdByName(layerListResp, projectTestCaseLayers.e2eTests);
        const INTEGRATION_FRONT_LAYER_ID = getLayerIdByName(layerListResp, projectTestCaseLayers.integrationFrontendTests);

        const featureFieldId = await getProjectCustomFieldIdRequest(customProjectField.feature, projectId);
        const storyFieldId = await getProjectCustomFieldIdRequest(customProjectField.story, projectId);
        const scenarioFieldId = await getProjectCustomFieldIdRequest(customProjectField.scenario, projectId);
        const blockFieldId = await getProjectCustomFieldIdRequest(customProjectField.block, projectId);
        const subBlockFieldId = await getProjectCustomFieldIdRequest(customProjectField.subBlock, projectId);
        const codeFieldId = await getProjectCustomFieldIdRequest(customProjectField.code, projectId);

        if (!featureFieldId || !storyFieldId || !scenarioFieldId) {
            console.error('Не удалось получить ID кастомных полей!');
            return;
        }

         // parsedJson — это массив blocks
        for (const blockObj of parsedJson) {
            const blockValue = blockObj.block || 'Не указано';
            const subBlockValue = blockObj.subBlock || 'Не указано';
            const featuresArray = blockObj.features || [];

            for (const featureObj of featuresArray) {
                const feature = featureObj.feature || 'Не указано';
                for (const storyObj of featureObj.stories) {
                    const story = storyObj.story || 'Не указано';

                    // E2E кейсы на уровне story
                    if (Array.isArray(storyObj.e2eCases) && storyObj.e2eCases.length > 0) {
                        for (const e2e of storyObj.e2eCases) {
                            const e2eFields = [
                                { id: featureFieldId, value: feature },
                                { id: storyFieldId, value: story },
                            ];

                            if (blockFieldId) e2eFields.push({ id: blockFieldId, value: blockValue });
                            if (subBlockFieldId) e2eFields.push({ id: subBlockFieldId, value: subBlockValue });

                            // Формируем ожидаемые кастомные поля для проверки дублей
                            const expectedCustomFields = {
                                [customProjectField.feature]: feature,
                                [customProjectField.story]: story,
                            };
                            if (blockFieldId) expectedCustomFields[customProjectField.block] = blockValue;
                            if (subBlockFieldId) expectedCustomFields[customProjectField.subBlock] = subBlockValue;
                            
                            const e2eId = await createTestCase({
                                name: e2e.name,
                                steps: e2e.steps || []
                            }, projectId, expectedCustomFields);

                            if (e2eId) {
                                await addCustomFieldsToTestCase(e2eId, e2eFields);

                                if (E2E_LAYER_ID !== undefined) {
                                    await changeTestCaseLayerRequest(e2eId, E2E_LAYER_ID);
                                }
                            }
                        }
                    }

                    // Обработка сценариев
                    for (const scenarioObj of storyObj.scenarios) {
                        const scenario = scenarioObj.scenario;
                        const customFields = [
                            { id: featureFieldId, value: feature },
                            { id: storyFieldId, value: story },
                            { id: scenarioFieldId, value: scenario }
                        ];

                        if (blockFieldId) customFields.push({ id: blockFieldId, value: blockValue });
                        if (subBlockFieldId) customFields.push({ id: subBlockFieldId, value: subBlockValue });

                        if (scenarioObj.isE2E) {
                            // Формируем маппинг ID -> название поля для проверки дублей
                            const fieldIdToNameMap = {};
                            if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                            if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                            if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                            if (blockFieldId) fieldIdToNameMap[blockFieldId] = customProjectField.block;
                            if (subBlockFieldId) fieldIdToNameMap[subBlockFieldId] = customProjectField.subBlock;
                            
                            const effectiveCustomFields = customFields.filter(field => field.id !== scenarioFieldId);
                            const expectedFields = buildExpectedCustomFieldsFromArray(effectiveCustomFields, fieldIdToNameMap);
                            
                            const testCaseId = await createTestCase({
                                name: scenario,
                                steps: scenarioObj.steps || []
                            }, projectId, expectedFields);

                            if (!testCaseId) {
                                console.error(`Ошибка создания тест-кейса для сценария "${scenario}"`);
                                continue;
                            }

                            await addCustomFieldsToTestCase(testCaseId, effectiveCustomFields);

                            if (E2E_LAYER_ID !== undefined) {
                                await changeTestCaseLayerRequest(testCaseId, E2E_LAYER_ID);
                            }

                            console.log(`Создан тест-кейс "${scenario}" с шагами: ${JSON.stringify(scenarioObj.steps)}`);
                        } else if (scenarioObj.isIntegration) {
                            if (Array.isArray(scenarioObj.integrationCases) && scenarioObj.integrationCases.length > 0) {
                                for (const ic of scenarioObj.integrationCases) {
                                    // Формируем маппинг ID -> название поля для проверки дублей
                                    const fieldIdToNameMap = {};
                                    if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                                    if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                                    if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                                    if (blockFieldId) fieldIdToNameMap[blockFieldId] = customProjectField.block;
                                    if (subBlockFieldId) fieldIdToNameMap[subBlockFieldId] = customProjectField.subBlock;
                                    
                                    const expectedFields = buildExpectedCustomFieldsFromArray(customFields, fieldIdToNameMap);
                                    
                                    const integrationTestCaseId = await createTestCase({
                                        name: ic.name,
                                        steps: ic.steps || []
                                    }, projectId, expectedFields);

                                    if (!integrationTestCaseId) {
                                        console.error(`Ошибка создания интеграционного тест-кейса "${ic.name}" для сценария "${scenario}"`);
                                        continue;
                                    }

                                    await addCustomFieldsToTestCase(integrationTestCaseId, customFields);

                                    if (INTEGRATION_FRONT_LAYER_ID !== undefined) {
                                        await changeTestCaseLayerRequest(integrationTestCaseId, INTEGRATION_FRONT_LAYER_ID);
                                    }

                                    console.log(`Создан интеграционный тест-кейс "${ic.name}" c шагами: ${JSON.stringify(ic.steps)}`);
                                }
                            }

                            if (scenarioObj.codeList && scenarioObj.codeList.length > 0) {
                                for (const code of scenarioObj.codeList) {
                                    const codeCustomFields = [...customFields];

                                    if (codeFieldId) {
                                        codeCustomFields.push({ id: codeFieldId, value: code.code });
                                    }

                                    // Формируем маппинг ID -> название поля для проверки дублей
                                    const fieldIdToNameMap = {};
                                    if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                                    if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                                    if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                                    if (codeFieldId) fieldIdToNameMap[codeFieldId] = customProjectField.code;
                                    if (blockFieldId) fieldIdToNameMap[blockFieldId] = customProjectField.block;
                                    if (subBlockFieldId) fieldIdToNameMap[subBlockFieldId] = customProjectField.subBlock;
                                    
                                    const expectedFields = buildExpectedCustomFieldsFromArray(codeCustomFields, fieldIdToNameMap);

                                    const codeTestCaseId = await createTestCase({
                                        name: code.code,
                                        steps: []
                                    }, projectId, expectedFields);

                                    if (!codeTestCaseId) {
                                        console.error(`Ошибка создания тест-кейса для code "${code.code}" в сценарии "${scenario}"`);
                                        continue;
                                    }

                                    await addCustomFieldsToTestCase(codeTestCaseId, codeCustomFields);

                                    if (INTEGRATION_FRONT_LAYER_ID !== undefined) {
                                        await changeTestCaseLayerRequest(codeTestCaseId, INTEGRATION_FRONT_LAYER_ID);
                                    }

                                    console.log(`Создан тест-кейс уровня code "${code.code}" внутри сценария "${scenario}"`);
                                }
                            }
                        } else {
                            if (scenarioObj.codeList.length > 0) {
                                for (const code of scenarioObj.codeList) {
                                    const codeCustomFields = [...customFields];
                                    if (codeFieldId) {
                                        codeCustomFields.push({ id: codeFieldId, value: code.code });
                                    }
                                    
                                    // Формируем маппинг ID -> название поля для проверки дублей
                                    const fieldIdToNameMap = {};
                                    if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                                    if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                                    if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                                    if (codeFieldId) fieldIdToNameMap[codeFieldId] = customProjectField.code;
                                    if (blockFieldId) fieldIdToNameMap[blockFieldId] = customProjectField.block;
                                    if (subBlockFieldId) fieldIdToNameMap[subBlockFieldId] = customProjectField.subBlock;
                                    
                                    const expectedFields = buildExpectedCustomFieldsFromArray(codeCustomFields, fieldIdToNameMap);
                                    
                                    const testCaseId = await createTestCase({
                                        name: code.code,
                                        steps: []
                                    }, projectId, expectedFields);
                                    if (!testCaseId) {
                                        console.error(`Ошибка создания тест-кейса для code "${code.code}"`);
                                        continue;
                                    }
                                    await addCustomFieldsToTestCase(testCaseId, codeCustomFields);
                                    console.log(`Создан тест-кейс для code "${code.code}"`);
                                }
                            } else {
                                // Формируем маппинг ID -> название поля для проверки дублей
                                const fieldIdToNameMap = {};
                                if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                                if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                                if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                                if (blockFieldId) fieldIdToNameMap[blockFieldId] = customProjectField.block;
                                if (subBlockFieldId) fieldIdToNameMap[subBlockFieldId] = customProjectField.subBlock;
                                
                                const expectedFields = buildExpectedCustomFieldsFromArray(customFields, fieldIdToNameMap);
                                
                                const testCaseId = await createTestCase({
                                    name: scenario,
                                    steps: []
                                }, projectId, expectedFields);
                                if (!testCaseId) {
                                    console.error(`Ошибка создания тест-кейса для сценария "${scenario}"`);
                                    continue;
                                }
                                await addCustomFieldsToTestCase(testCaseId, customFields);
                                console.log(`Создан тест-кейс "${scenario}" без шагов`);
                            }
                        }
                    }
                }
            }
        }
        console.log('Все тест-кейсы успешно созданы и кастомные поля добавлены!');
    } catch (error) {
        console.error(`Ошибка выполнения: ${error.message}`);
    }
}


/**
 * Экспорт XMIND в Allure для обычных проектов для обратной совместимости
 * @param parsedJson
 * @param projectId
 * @returns {Promise<void>}
 */
export async function exportStructureAllure(parsedJson, projectId) {
    try {
        const featureFieldId = await getProjectCustomFieldIdRequest(customProjectField.feature, projectId);
        const storyFieldId = await getProjectCustomFieldIdRequest(customProjectField.story, projectId);
        const scenarioFieldId = await getProjectCustomFieldIdRequest(customProjectField.scenario, projectId);
        const codeFieldId = await getProjectCustomFieldIdRequest(customProjectField.code, projectId);
        console.log(`ХУЙ ${featureFieldId} ${storyFieldId} ${scenarioFieldId} ${codeFieldId}`)
        // Если не найдено ни одно из кастомных полей в проекте
        if (!featureFieldId || !storyFieldId || !scenarioFieldId || !codeFieldId) {
            console.error('Не удалось получить ID кастомных полей!');
            return;
        }

        // Обрабатываем каждый feature в parsedJson
        for (const featureObj of parsedJson) {
            const feature = featureObj.feature || 'Не указано'; // Значение по умолчанию
            console.log(feature)
            // Обрабатываем каждый story для текущего feature
            for (const storyObj of featureObj.stories) {
                const story = storyObj.story || 'Не указано'; // Значение по умолчанию
                console.log(story)
                // Обрабатываем каждый scenario для текущего story
                for (const scenarioObj of storyObj.scenarios) {
                    const scenario = scenarioObj.scenario;
                    console.log('Вошли в')
                    console.log(scenario)
                    const customFields = [
                        { id: featureFieldId, value: feature },
                        { id: storyFieldId, value: story },
                        { id: scenarioFieldId, value: scenario },
                    ];
                    console.log(customFields)

                    // Если в scenario есть 4-й уровень, то обрабатываем ее и добавляем кейсы
                    if (scenarioObj.codeList.length) {
                        console.log('Вошли в код')
                        for (const codeObj of scenarioObj.codeList) {
                            const code = codeObj.code;
                            console.log(code)
                            console.log('SCENARIO', scenario);
                            console.log('CODE', code);

                            customFields.push({ id: codeFieldId, value: code });

                            // Формируем ожидаемые кастомные поля для проверки дублей (Feature, Story, Scenario, Code)
                            const fieldIdToNameMap = {};
                            if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                            if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                            if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                            if (codeFieldId) fieldIdToNameMap[codeFieldId] = customProjectField.code;
                            
                            const expectedFields = buildExpectedCustomFieldsFromArray(customFields, fieldIdToNameMap);

                            // Создаем тест-кейс
                            /**
                             * если есть scenarioObj.code, то выполняем запрос createTestCase({name: code}, id);
                             * иначе createTestCase({name: scenario}, id);
                             * @type {*|undefined}

                             */
                            const testCaseId = await createTestCase({ name: code }, projectId, expectedFields);

                            if (!testCaseId) {
                                console.error(`Ошибка создания тест-кейса для сценария "${code}"`);
                                continue; // Переходим к следующему, если не удалось создать тест-кейс
                            }

                            // Добавляем кастомные поля в тест-кейс
                            await addCustomFieldsToTestCase(testCaseId, customFields);

                            console.log(`Кастомные поля добавлены в тест-кейс ${testCaseId}`);
                        }
                    } else {
                        // Формируем ожидаемые кастомные поля для проверки дублей (Feature, Story, Scenario)
                        const fieldIdToNameMap = {};
                        if (featureFieldId) fieldIdToNameMap[featureFieldId] = customProjectField.feature;
                        if (storyFieldId) fieldIdToNameMap[storyFieldId] = customProjectField.story;
                        if (scenarioFieldId) fieldIdToNameMap[scenarioFieldId] = customProjectField.scenario;
                        
                        const expectedFields = buildExpectedCustomFieldsFromArray(customFields, fieldIdToNameMap);
                        
                        const testCaseId = await createTestCase({ name: scenario }, projectId, expectedFields);

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
        }

        console.log('Все тест-кейсы успешно созданы и кастомные поля добавлены!');
    } catch (error) {
        console.error(`Ошибка выполнения: ${error.message}`);
    }
}


function getLayerIdByName(layerListResp, name) {
    const layers = (layerListResp && layerListResp.content)
        ? layerListResp.content
        : [];

    return layers.find(l => l.name === name)?.id;
}




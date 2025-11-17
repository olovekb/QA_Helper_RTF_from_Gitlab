import fetch from 'node-fetch';
import axios from 'axios'
import { spinningLoader } from './spinning-loader.mjs';
import { callWithCloudRuFallback } from './cloudruClient.mjs';
import config from './config.json' assert { type: 'json' };

// TODO: Нужно рефачить - переиспользовать из tia-mapping-service\utils\allureAuth.js

const OPENROUTER_KEY = config.openRouterAiKey;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Конфигурация
const BASE_URL = config.baseUrl;
const ALLURE_TOKEN = config.allureToken;
const API_TOKEN = await getJwtToken();
const HEADERS = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
};
// Обновляем токен и возвращаем новый
let isRefreshing = false;
let tokenPromise = null;

export async function getJwtToken() {
    try {
        let spinnerInterval = spinningLoader('Авторизуемся по токену Allure...');
        const response = await axios.post(
            `${BASE_URL}/uaa/oauth/token`,
            new URLSearchParams({
                grant_type: "apitoken",
                scope: "openid",
                token: ALLURE_TOKEN,
            }),
            {
                headers: {
                    "Accept": "application/json",
                }
            }
        );
        clearInterval(spinnerInterval);
        const jwtToken = response.data.access_token;
        return jwtToken;
    } catch (error) {
        console.error("Ошибка получения JWT токена:", error.message);
        throw error;
    }
}

async function refreshJwtToken() {
    if (!isRefreshing) {
        isRefreshing = true;
        tokenPromise = getJwtToken().then((newToken) => {
            isRefreshing = false;
            HEADERS['Authorization'] = `Bearer ${newToken}`;
            return newToken;
        });
    }
    return tokenPromise;
}

// Обёртка для fetch
export async function fetchWithAuth(url, options = {}) {
    options.headers = {
        ...HEADERS, // Текущие заголовки
        ...(options.headers || {}), // Дополнительные заголовки из запроса
    };

    const response = await fetch(url, options);

    if (response.status === 401) {
        console.warn(`401 Unauthorized для URL: ${url}. Обновляем токен...`);

        try {
            const newToken = await refreshJwtToken(); // Получаем новый токен
            options.headers['Authorization'] = `Bearer ${newToken}`; // Обновляем заголовки

            // Повторяем запрос
            return await fetch(url, options);
        } catch (error) {
            console.error("Не удалось обновить токен:", error.message);
            throw new Error("Не удалось авторизоваться. Проверьте доступы.");
        }
    }

    return response;
}

/**
 * Функция для получения обзора тест-кейса
 */
export async function getTestCaseOverview(testCaseId) {
    const BASE_URL = config.baseUrl;
    const url = `${BASE_URL}/testcase/${testCaseId}/overview`;
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения overview для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data; // предполагается, что ответ содержит поле name
}

/**
 * Функция для получения всех тест-кейсов
 * @param {*} projectId - ID проекта из Allure
 * @param {*} size - максимальный размер количества тест-кейсов в ответе
 * @returns allCases - JSON с описанием набора тест-кейсов
 */
export async function getAllTestCases(projectId, size = 10000) {
    const url = `${BASE_URL}/testcase`;
    let page = 0;
    let allCases = [];

    while (true) {
        // const response = await fetch(`${url}?projectId=${projectId}&page=${page}&size=${size}`, { headers: HEADERS });
        const response = await fetchWithAuth(`${url}?projectId=${projectId}&page=${page}&size=${size}`);
        if (!response.ok) {
            const errorMessage = await response.text();
            console.log(`Текст ошибки: ${errorMessage}`);
            throw new Error(`Ошибка получения тест-кейсов: ${response.statusText}`);
        }
        const data = await response.json();
        allCases = allCases.concat(data.content);

        if (data.last) break; // Если это последняя страница, останавливаемся
        page += 1;
    }

    return allCases;
}

export async function getTestCaseSharedStep(sharedStepId) {
    try {
        const url = `${BASE_URL}/sharedstep/${sharedStepId}`;
        // const response = await fetch(url, { headers: HEADERS });
        const response = await fetchWithAuth(url);
        if (!response.ok) {
            throw new Error(`Ошибка получения данных для общего шага ${sharedStepId}: ${response.statusText}`);
        }

        const data = await response.json();

        if (typeof data.name !== 'string') {
            console.error('Ошибка: поле "name" не является строкой или отсутствует');
            console.log('Поле "name" имеет тип:', typeof data.name);
            return 'Неизвестный общий шаг'; // Подставляем значение по умолчанию
        }

        return data.name;
    } catch (error) {
        console.error(`Ошибка в getTestCaseSharedStep: ${error.message}`);
        throw error; // Пробрасываем ошибку дальше
    }
}



// Функция для получения ожидаемого результата
export async function getTestCaseExpectedResult(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    // const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.expectedResult
}

// Функция для получения слоя тестирования
export async function getTestCaseLayer(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    //const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.testLayer
}

// Функция для получения статуса тестирования
export async function getTestCaseStatus(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    //  const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.status
}

// Функция для получения предусловий
export async function getTestCasePrecondition(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    // const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.precondition
}


// Функция для получения связью с задачей Jira тест-кейса
export async function getCaseIssue(testCaseId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/issue`;
    // const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения связей для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    return response.json();
}

// Функция для получения тегов тест-кейса
export async function getCaseTags(testCaseId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/tag`;
    // const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения тегов для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    return response.json();
}

export async function getTestCaseSteps(testCaseId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/step`
    //  const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        console.error(`Ошибка получения шагов для тест-кейса ${testCaseId}: ${response.statusText}`);
        return [];  // Если ошибка, возвращаем пустой массив
    }
    return response.json();
}


export async function getTestCaseCustomFields(testCaseId, projectId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/cfv?projectId=${projectId}&v2=true`;
    // const response = await fetch(url, { headers: HEADERS });
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    return await response.json();
}

/**
 * Получить дефекты из Allure
 * @param {string} projectId
 * @param {string} [query]
 * @param {number} [page]
 * @param {number} [size]
 */
export async function getAllureDefects(projectId, query = '', page = 0, size = 25) {
    if (!projectId) throw new Error('projectId is required');
    const url = new URL(`${BASE_URL}/defect`);
    url.searchParams.set('projectId', projectId);
    url.searchParams.set('sort', 'id,desc');
    url.searchParams.set('page', page);
    url.searchParams.set('size', size);
    if (query) url.searchParams.set('name', query);

    const resp = await fetchWithAuth(url.toString(), { credentials: 'include' });
    if (!resp.ok) throw new Error(`Allure GET defects failed: ${resp.statusText}`);
    const json = await resp.json();
    return json.content || [];
}

/**
 * Привязать к дефекту задачу из Jira
 * @param {string} defectId
 * @param {number} integrationId
 * @param {string} issueName
 */
export async function linkIssueToAllureDefect(defectId, integrationId, issueName) {
    const url = `${BASE_URL}/defect/${defectId}/issue`;
    const resp = await fetchWithAuth(url, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ integrationId, name: issueName })
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`Allure POST link issue failed: ${text}`);
    }
    return resp.json();
}


export async function analyzeBugWithAI(task, apiKey = null) {
    const { summary, description, steps, actual, expected } = task;
    const prompt = `
Ты — эксперт по написанию баг-репортов. Проверь следующие поля по нашему чек-листу:

1. Тема  
   - Кратко: Что? Где? При каких условиях?  
   - Без личных местоимений и размытых формулировок.  
2. Подробное описание  
   - Должно раскрывать суть ошибки и приводить репродукцию.  
3. Шаги воспроизведения  
   - Каждый шаг начинается с глагола, обезличен, ясен.  
4. Фактический результат  
   - Ясно и однозначно описывает проблему.  
5. Ожидаемый результат  
   - Ясно и однозначно, что система должна делать.

Вот текущее содержимое:
\`\`\`
Тема: ${summary || '<пусто>'}

Подробное описание:
${description || '<пусто>'}

Шаги воспроизведения:
${steps || '<пусто>'}

Фактический результат:
${actual || '<пусто>'}

Ожидаемый результат:
${expected || '<пусто>'}
\`\`\`

Для каждого блока верни **короткую** рекомендацию (1–2 предложения) в **чистом** JSON формате:
\`\`\`json
{
  "summaryFeedback": "...",
  "descriptionFeedback": "...",
  "stepsFeedback": "...",
  "actualFeedback": "...",
  "expectedFeedback": "..."
}
\`\`\`
`;

    const json = await callWithCloudRuFallback(
        OPENROUTER_URL,
        [{ role: 'user', content: prompt }],
        apiKey || OPENROUTER_KEY, // используем пользовательский ключ или дефолтный
        {
            temperature: 0.25,
            max_tokens: 4096
        }
    );
    const content = json.choices?.[0]?.message?.content || '';

    // Вытаскиваем первый JSON-объект из текста
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error('Не удалось найти JSON в ответе AI:\n' + content);
    }
    try {
        return JSON.parse(match[0]);
    } catch (e) {
        throw new Error('Не удалось распарсить извлечённый JSON: ' + e.message + '\n' + match[0]);
    }
}



/**
 * Получить детали дефекта (с описанием).
 */
export async function getAllureDefectById(defectId) {
    const url = `${BASE_URL}/defect/${defectId}`;
    const resp = await fetchWithAuth(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`Allure GET defect failed: ${resp.statusText}`);
    return resp.json(); // вернёт { id, projectId, name, description, … }
}

export async function getStepsForDefect(defectId) {
    // 1) узнаём связанный testResult
    const trUrl = `${BASE_URL}/defect/${defectId}/testresult?page=0&size=1`;
    const trResp = await fetchWithAuth(trUrl, { credentials: 'include' });
    if (!trResp.ok) throw new Error(`Allure GET defect testresult failed: ${trResp.statusText}`);
    const trJson = await trResp.json();
    const first = trJson.content?.[0];
    if (!first) return [];

    // 2) получаем execution с полями steps + вложенными steps
    const executionUrl = `${BASE_URL}/testresult/${first.id}/execution?v2=true`;
    const exResp = await fetchWithAuth(executionUrl, { credentials: 'include' });
    if (!exResp.ok) throw new Error(`Allure GET execution failed: ${exResp.statusText}`);
    const exJson = await exResp.json();

    // 3) Формируем уже пронумерованный и отформатированный список строк:
    //    родительский – курсивом (_…_), дочерние – с отступом и «n.m»
    const lines = [];
    exJson.steps.forEach((step, i) => {
        const idx = i + 1;
        // общий шаг – курсивом
        lines.push(`${idx}. _${step.body}_`);
        // вложенные шаги
        (step.steps || []).forEach((child, j) => {
            const cidx = j + 1;
            lines.push(`    ${idx}.${cidx}. ${child.body}`);
        });
    });

    return lines;
}


/**
 * Получить список общих шагов (shared steps) с поддержкой pagination и поиска
 * @param {Object} opts
 * @param {string|number} opts.projectId – ID проекта (обязательный)
 * @param {number} [opts.page=0] – номер страницы (для lazy loading)
 * @param {number} [opts.size=20] – сколько элементов вернуть за один запрос
 * @param {boolean} [opts.archived=false] – включить архивные или нет
 * @param {string} [opts.search] – текстовый фильтр
 */
export async function getSharedStepsList({
    projectId,
    page = 0,
    size = 20,
    archived = false,
    search = ''
}) {
    if (!projectId) {
        throw new Error('projectId is required to fetch shared steps');
    }

    const params = new URLSearchParams({
        projectId: String(projectId),
        page: String(page),
        size: String(size),
        archived: String(archived),
    });
    if (search) {
        params.set('search', search.trim());
    }

    const url = `${BASE_URL}/sharedstep?${params.toString()}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Ошибка получения shared steps: ${text}`);
    }

    // возвращаем весь JSON (в нём обычно есть content, totalPages, totalElements и пр.)
    return response.json();
}

/**
 * Создать общий шаг (shared step)
 * @param {Object} opts
 * @param {string|number} opts.projectId – ID проекта (обязательный)
 * @param {string} opts.name – Название shared step (обязательный)
 * @returns {Promise<Object>} – Созданный shared step с полями id, projectId, name и т.д.
 */
export async function createSharedStep({ projectId, name }) {
    if (!projectId || !name) {
        throw new Error('projectId and name are required to create shared step');
    }

    const url = `${BASE_URL}/sharedstep`;
    const response = await fetchWithAuth(url, {
        method: 'POST',
        body: JSON.stringify({ projectId, name })
    });

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Ошибка создания shared step: ${text}`);
    }

    return response.json();
}

/**
 * Добавить шаг в shared step
 * @param {Object} opts
 * @param {string|number} opts.sharedStepId – ID shared step (обязательный)
 * @param {string} [opts.body] – Текст шага (если не используется sharedStepId)
 * @param {string} [opts.expectedResult] – Ожидаемый результат (опционально)
 * @param {boolean} [opts.withExpectedResult=false] – Включать ли Expected Result в запрос
 * @returns {Promise<Object>} – Созданный шаг с полем id
 */
export async function addStepToSharedStep({ sharedStepId, body, expectedResult, withExpectedResult = false }) {
    if (!sharedStepId) {
        throw new Error('sharedStepId is required to add step to shared step');
    }

    // Формируем bodyJson в формате TipTap (ProseMirror)
    const bodyJson = {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: body || ""
                    }
                ]
            }
        ]
    };

    const payload = {
        bodyJson,
        sharedStepId: Number(sharedStepId)
    };

    // Если есть Expected Result, добавляем его
    if (expectedResult && withExpectedResult) {
        payload.expectedResultJson = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: expectedResult
                        }
                    ]
                }
            ]
        };
    }

    const url = `${BASE_URL}/sharedstep/step?withExpectedResult=${withExpectedResult}`;
    const response = await fetchWithAuth(url, {
        method: 'POST',
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Ошибка добавления шага в shared step: ${text}`);
    }

    return response.json();
}

/**
 * Получить детали shared step (включая шаги и Expected Result)
 * @param {string|number} sharedStepId – ID shared step
 * @returns {Promise<Object>} – Детали shared step
 */
export async function getSharedStepDetails(sharedStepId) {
    if (!sharedStepId) {
        throw new Error('sharedStepId is required to get shared step details');
    }

    const url = `${BASE_URL}/sharedstep/${sharedStepId}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Ошибка получения shared step: ${text}`);
    }

    return response.json();
}


// 1. Создать ТК
export async function createTestCaseAllure({ projectId, name }) {
    const resp = await fetchWithAuth(`${BASE_URL}/testcase`, {
        method: 'POST',
        body: JSON.stringify({ projectId, name }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure API create test case failed ${resp.status}: ${txt}`);
    }
    return resp.json(); // { id, projectId, name, ... }
}

// 2. Обновить основные поля (precondition + expectedResult)
export async function updateTestCase(testCaseId, { precondition, expectedResult }) {
    const body = { id: testCaseId };
    if (precondition !== undefined) body.precondition = precondition;
    if (expectedResult !== undefined) body.expectedResult = expectedResult;
    const resp = await fetchWithAuth(`${BASE_URL}/testcase/${testCaseId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure PATCH test case failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

// 3. Добавить шаг (body или sharedStepId + вставить после afterId)
export async function addStepToTestCase(testCaseId, { body, sharedStepId, afterId }) {
    const payload = { testCaseId };
    if (sharedStepId !== undefined) {
        // ✅ Убеждаемся, что sharedStepId - число (как в примере curl)
        payload.sharedStepId = Number(sharedStepId);
    } else {
        // ✅ Убеждаемся, что body - строка (Allure API ожидает String, а не Object)
        // Всегда преобразуем в строку, даже если передан объект
        if (typeof body !== 'string') {
            if (body === null || body === undefined) {
                payload.body = '';
            } else if (typeof body === 'object') {
                // ⚠️ Если передан объект - это ошибка, извлекаем text или преобразуем в строку
                console.warn(`[addStepToTestCase] ⚠️ Получен объект вместо строки для body. Объект:`, JSON.stringify(body));
                // Пытаемся извлечь text из объекта
                if (body.text && typeof body.text === 'string') {
                    payload.body = body.text;
                } else {
                    // Если text нет - преобразуем объект в строку (не JSON, а обычную строку)
                    payload.body = String(body);
                }
            } else {
                // Примитив - преобразуем в строку
                payload.body = String(body);
            }
        } else {
            // body уже строка - используем как есть
            payload.body = body;
        }
    }
    if (afterId !== undefined) payload.afterId = afterId;
    
    // ✅ Добавляем параметр withExpectedResult=false в URL (как в примере curl)
    const resp = await fetchWithAuth(`${BASE_URL}/testcase/step?withExpectedResult=false`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST step failed ${resp.status}: ${txt}`);
    }
    return resp.json(); // возвращает созданный шаг с полем id
}

/**
 * Добавить Expected Result к шагу тест-кейса
 * @param {number} testCaseId - ID тест-кейса
 * @param {number} stepId - ID шага, к которому добавляется Expected Result
 * @param {string} expectedResultText - Текст ожидаемого результата
 * @returns {Promise<Object>} - Созданный Expected Result с полями id и expectedResultId
 */
export async function addExpectedResultToStep(testCaseId, stepId, expectedResultText) {
    if (!expectedResultText || !expectedResultText.trim()) {
        throw new Error('expectedResultText is required');
    }
    
    // 1. Создаем контейнер "Expected Result" (родительский шаг)
    const containerPayload = {
        testCaseId,
        bodyJson: {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "Expected Result"
                        }
                    ]
                }
            ]
        }
    };
    
    const containerResp = await fetchWithAuth(`${BASE_URL}/testcase/step?withExpectedResult=false`, {
        method: 'POST',
        body: JSON.stringify(containerPayload),
    });
    
    if (!containerResp.ok) {
        const txt = await containerResp.text();
        throw new Error(`Allure POST Expected Result container failed ${containerResp.status}: ${txt}`);
    }
    
    const container = await containerResp.json();
    // ✅ Из curl примера: ответ содержит createdStepId в корне
    // Структура: { createdStepId: 123, scenario: { scenarioSteps: { "123": {...} } } }
    let containerId = container.createdStepId;
    if (!containerId && container.scenario?.scenarioSteps) {
        // Если createdStepId нет в корне, берем первый ключ из scenarioSteps
        const stepKeys = Object.keys(container.scenario.scenarioSteps);
        if (stepKeys.length > 0) {
            containerId = parseInt(stepKeys[0]);
        }
    }
    if (!containerId) {
        containerId = container.id;
    }
    
    if (!containerId) {
        throw new Error(`Не удалось извлечь ID контейнера Expected Result из ответа: ${JSON.stringify(container).substring(0, 500)}`);
    }
    
    // 2. Создаем дочерний шаг с текстом результата
    const resultPayload = {
        testCaseId,
        bodyJson: {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: expectedResultText.trim()
                        }
                    ]
                }
            ]
        },
        parentId: containerId  // ✅ Связываем с контейнером
    };
    
    const resultResp = await fetchWithAuth(`${BASE_URL}/testcase/step?withExpectedResult=false`, {
        method: 'POST',
        body: JSON.stringify(resultPayload),
    });
    
    if (!resultResp.ok) {
        const txt = await resultResp.text();
        throw new Error(`Allure POST Expected Result text failed ${resultResp.status}: ${txt}`);
    }
    
    const result = await resultResp.json();
    // ✅ Из curl примера: ответ содержит createdStepId в корне
    let resultId = result.createdStepId;
    if (!resultId && result.scenario?.scenarioSteps) {
        const stepKeys = Object.keys(result.scenario.scenarioSteps);
        if (stepKeys.length > 0) {
            resultId = parseInt(stepKeys[0]);
        }
    }
    if (!resultId) {
        resultId = result.id;
    }
    
    // 3. Связываем основной шаг с контейнером через PATCH
    // ✅ Из curl примера: используется PATCH /testcase/{testCaseId}/step/{stepId}
    const updateResp = await fetchWithAuth(`${BASE_URL}/testcase/${testCaseId}/step/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify({
            expectedResultId: containerId
        }),
    });
    
    if (!updateResp.ok) {
        const txt = await updateResp.text();
        throw new Error(`Allure PATCH step expectedResultId failed ${updateResp.status}: ${txt}`);
    }
    
    return {
        containerId,
        resultId,
        expectedResultId: containerId
    };
}

// 4. Добавить тег к ТК
export async function addTagToTestCase(testCaseId, name) {
    // endpoint ожидает массив из одного объекта { name }
    const resp = await fetchWithAuth(
        `${BASE_URL}/testcase/${testCaseId}/tag`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ name }])
        }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST tag to TC failed: ${txt}`);
    }
}


/**
 * Добавить (или обновить) внешние/внутренние ссылки у тест-кейса
 */
export async function addLinkToTestCase(testCaseId, { name, url, type }) {
    // Собираем один элемент массива links
    const linkObj = { name, url };
    if (type) {
        linkObj.type = type;
    }
    // Отправляем PATCH /testcase/{id} { links: [ ... ] }
    const resp = await fetchWithAuth(
        `${BASE_URL}/testcase/${testCaseId}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ links: [linkObj] })
        }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure PATCH testcase links failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

/**
 * Привязать к тест-кейсу задачу из Jira
 * @param {number} testCaseId
 * @param {number} integrationId — ID интеграции (например, 67)
 * @param {string} issueName — ключ задачи, например "JM-1292"
 */
export async function linkIssueToTestCase(testCaseId, integrationId, issueName) {
    // Формируем массив DTO, как в вашем curl
    const payload = [{
        integrationId,
        name: issueName
    }];
    const resp = await fetchWithAuth(
        `${BASE_URL}/testcase/${testCaseId}/issue`,
        {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        }
    );
    if (!resp.ok) {
        const txt = await resp.text().catch(() => resp.statusText);
        throw new Error(`Allure POST issue link failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

// 7. Установить layer / priority / version
export async function setTestCaseLayer(testCaseId, testLayerId) {
    const resp = await fetchWithAuth(`${BASE_URL}/testcase/${testCaseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ testLayerId }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure PATCH layer failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}
export async function setTestCasePriority(testCaseId, priority) {
    const resp = await fetchWithAuth(`${BASE_URL}/testcase/${testCaseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure PATCH priority failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}
export async function setTestCaseVersion(testCaseId, version) {
    const resp = await fetchWithAuth(`${BASE_URL}/testcase/${testCaseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ version }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure PATCH version failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

// 8. Добавить параметр
export async function addParameterToTestCase(testCaseId, { name, value, type }) {
    const payload = { name, value };
    if (type) payload.type = type;
    const resp = await fetchWithAuth(`${BASE_URL}/testcase/${testCaseId}/parameter`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST parameter failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

/**
 * Создать примеры (examples) для параметризованного тест-кейса
 * @param {number} testCaseId
 * @param {Array<Array<{name: string, value: string}>>} examples - массив примеров, каждый пример - массив параметров
 * @returns {Promise<Array>} - массив созданных примеров с id
 */
export async function createTestCaseExamples(testCaseId, examples) {
    const resp = await fetchWithAuth(
        `${BASE_URL}/testcase/${testCaseId}/example`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(examples),
        }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST testcase examples failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

/**
 * Генерация pairwise комбинаций параметров
 * @param {number} n - степень pairwise (обычно 2)
 * @param {Array<{name: string, values: Array<string>}>} parameters - массив параметров с их значениями
 * @returns {Promise<Array>} - массив примеров (комбинаций параметров)
 */
export async function generatePairwiseExamples(n, parameters) {
    const resp = await fetchWithAuth(
        `${BASE_URL}/testcase/example/nwise?n=${encodeURIComponent(n)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parameters),
        }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST pairwise examples failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

/**
 * Удалить параметр из тест-кейса
 * @param {number} testCaseId
 * @param {string} parameterName - имя параметра для удаления
 */
export async function deleteTestCaseParameter(testCaseId, parameterName) {
    // Note: Allure API может не иметь прямого DELETE для параметра
    // В этом случае нужно получить все параметры, удалить нужный и обновить
    const resp = await fetchWithAuth(
        `${BASE_URL}/testcase/${testCaseId}/parameter`,
        {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: parameterName }),
        }
    );
    if (!resp.ok && resp.status !== 404) {
        const txt = await resp.text();
        throw new Error(`Allure DELETE parameter failed ${resp.status}: ${txt}`);
    }
    return resp.ok ? resp.json() : null;
}

// 9. Создать значение кастомного поля на уровне проекта
export async function createProjectCustomFieldValue(projectId, customFieldId, name) {
    const resp = await fetchWithAuth(`${BASE_URL}/project/${projectId}/cfv`, {
        method: 'POST',
        body: JSON.stringify({
            customField: { id: customFieldId },
            name,
        }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST project cfv failed ${resp.status}: ${txt}`);
    }
    return resp.json();
}

/**
 * Устанавливает значения кастомных полей для тест-кейса
 * @param {string|number} testCaseId
 * @param {Array<{ customField: { id: number }, name: string }>} cfvArray
 */
export async function setTestCaseCustomFieldValues(testCaseId, cfvArray) {
    // Валидация входных данных
    if (!Array.isArray(cfvArray)) {
        throw new Error(`cfvArray must be an array, got ${typeof cfvArray}`);
    }
    
    // Проверяем формат каждого элемента
    for (let i = 0; i < cfvArray.length; i++) {
        const item = cfvArray[i];
        if (!item || typeof item !== 'object') {
            throw new Error(`cfvArray[${i}] must be an object, got ${typeof item}`);
        }
        if (!item.customField || typeof item.customField !== 'object' || typeof item.customField.id !== 'number') {
            throw new Error(`cfvArray[${i}].customField.id must be a number, got ${JSON.stringify(item.customField)}`);
        }
        if (typeof item.name !== 'string') {
            throw new Error(`cfvArray[${i}].name must be a string, got ${typeof item.name}`);
        }
    }
    
    const url = `${BASE_URL}/testcase/${testCaseId}/cfv`;
    const body = JSON.stringify(cfvArray);
    
    console.log(`[setTestCaseCustomFieldValues] POST ${url}`);
    console.log(`[setTestCaseCustomFieldValues] Body:`, body);
    
    const resp = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
    });
    
    if (!resp.ok) {
        const txt = await resp.text();
        let errorDetails = '';
        try {
            const errorJson = JSON.parse(txt);
            errorDetails = JSON.stringify(errorJson, null, 2);
        } catch {
            errorDetails = txt;
        }
        
        console.error(`[setTestCaseCustomFieldValues] ❌ Ошибка ${resp.status} для ТК ${testCaseId}`);
        console.error(`[setTestCaseCustomFieldValues] Статус: ${resp.status} ${resp.statusText}`);
        console.error(`[setTestCaseCustomFieldValues] Ответ сервера:`, errorDetails);
        console.error(`[setTestCaseCustomFieldValues] Отправленные данные:`, body);
        console.error(`[setTestCaseCustomFieldValues] URL: ${url}`);
        
        // ✅ Анализ ошибки
        const hasNegativeIds = cfvArray.some(item => item.customField?.id < 0);
        if (hasNegativeIds && resp.status === 500) {
            const negativeIds = cfvArray.filter(item => item.customField?.id < 0).map(item => item.customField.id);
            console.error(`[setTestCaseCustomFieldValues] ⚠️ В запросе есть поля с отрицательными ID: ${negativeIds.join(', ')}`);
            console.error(`[setTestCaseCustomFieldValues] ⚠️ Это может быть причиной ошибки 500 - системные поля Allure могут не поддерживать установку через /cfv API`);
        }
        
        throw new Error(`Allure POST testcase cfv failed ${resp.status}: ${txt}`);
    }
    
    const result = await resp.json();
    console.log(`[setTestCaseCustomFieldValues] ✅ Успешно установлены кастомные поля для ТК ${testCaseId}`);
    return result;
}

/**
 * Получить доступные слои тестирования (test layers)
 * @param {number} [size=20] - сколько элементов запрошить
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function suggestTestLayers(size = 20) {
    const resp = await fetchWithAuth(
        `${BASE_URL}/testlayer/suggest?size=${encodeURIComponent(size)}`,
        {
            headers: { 'Accept': 'application/json' }
        }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure GET test layers failed ${resp.status}: ${txt}`);
    }
    const json = await resp.json();
    // В ответе ожидаем { content: [ { id, name }, ... ], ... }
    return Array.isArray(json.content) ? json.content : [];
}


export async function getProjectCustomFieldSchema(projectId) {
    const resp = await fetchWithAuth(
        `${BASE_URL}/cfschema?projectId=${projectId}`,
        { headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure GET cfschema failed ${resp.status}: ${txt}`);
    }
    // распарсим один раз
    const data = await resp.json();
    console.log('cfschema content:', data.content);
    return data.content;
}

export async function createTag(name) {
    const resp = await fetchWithAuth(
        `${BASE_URL}/tag`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        }
    );
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Allure POST tag failed: ${txt}`);
    }
    return resp.json(); // { id, name }
}


/**
 * Предложить существующие теги проекта
 * @param {number|string} projectId
 * @param {number} [size=20]
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function suggestTags(projectId, size = 20) {
    const resp = await fetchWithAuth(
        `${BASE_URL}/tag/suggest?projectId=${encodeURIComponent(projectId)}&size=${size}`,
        { headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) {
        const txt = await resp.text().catch(() => resp.statusText);
        throw new Error(`Allure GET tag suggest failed ${resp.status}: ${txt}`);
    }
    const json = await resp.json();
    // некоторые эндпоинты возвращают { content: [...] }
    if (Array.isArray(json)) {
        return json;
    }
    if (Array.isArray(json.content)) {
        return json.content;
    }
    // а если неожиданно вернулось что-то другое — просто попытка вернуть сам ответ
    return [];
}

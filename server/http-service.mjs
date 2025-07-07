import fetch from 'node-fetch';
import axios from 'axios'
import { spinningLoader } from './spinning-loader.mjs';
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
                    // "Expect": "",
                }
            }
        );
        clearInterval(spinnerInterval);
        // Извлекаем access_token из ответа
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
async function fetchWithAuth(url, options = {}) {
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


export async function analyzeBugWithAI(task) {
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

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'deepseek/deepseek-chat:free',
            messages: [{ role: 'user', content: prompt }]
        })
    });
    const json = await res.json();
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

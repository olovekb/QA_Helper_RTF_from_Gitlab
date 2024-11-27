import fetch from 'node-fetch';
import axios from 'axios'
import { spinningLoader } from './spinning-loader.mjs';
import config from './config.json' assert { type: 'json' };

// Конфигурация
const BASE_URL = config.baseUrl;
const ALLURE_TOKEN = config.allureToken;
const API_TOKEN = await getJwtToken();
const HEADERS = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
};

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
                    "Expect": "",
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
        const response = await fetch(`${url}?projectId=${projectId}&page=${page}&size=${size}`, { headers: HEADERS });
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
        const response = await fetch(url, { headers: HEADERS });
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
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.expectedResult
}

// Функция для получения слоя тестирования
export async function getTestCaseLayer(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.testLayer
}

// Функция для получения статуса тестирования
export async function getTestCaseStatus(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.status
}

// Функция для получения предусловий
export async function getTestCasePrecondition(testCaseId) {
    const url = `${BASE_URL}/rs/testcase/${testCaseId}`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.precondition
}


// Функция для получения связью с задачей Jira тест-кейса
export async function getCaseIssue(testCaseId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/issue`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`Ошибка получения связей для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    return response.json();
}

// Функция для получения тегов тест-кейса
export async function getCaseTags(testCaseId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/tag`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        throw new Error(`Ошибка получения тегов для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    return response.json();
}

export async function getTestCaseSteps(testCaseId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/step`
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
        console.error(`Ошибка получения шагов для тест-кейса ${testCaseId}: ${response.statusText}`);
        return [];  // Если ошибка, возвращаем пустой массив
    }
    return response.json();
}


export async function getTestCaseCustomFields(testCaseId, projectId) {
    const url = `${BASE_URL}/testcase/${testCaseId}/cfv?projectId=${projectId}&v2=true`;
    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
        throw new Error(`Ошибка получения данных для тест-кейса ${testCaseId}: ${response.statusText}`);
    }
    return await response.json();
}


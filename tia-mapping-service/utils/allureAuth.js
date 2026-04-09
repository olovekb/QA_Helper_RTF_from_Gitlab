import axios from 'axios';
import config from '../config/index.js';
import { logInfo, logError } from './logger.js';

/**
 * Глобальные переменные для управления состоянием токена
 * @type {boolean} isRefreshing - Флаг, указывающий, идёт ли процесс обновления токена
 * @type {Promise|null} tokenPromise - Промис для кэширования запроса на обновление токена
 */
let isRefreshing = false;
let tokenPromise = null;

/**
 * Объект с заголовками для авторизации, содержащий текущий JWT-токен
 * @type {Object}
 */
export const authHeaders = {
    'Authorization': '',
    'Content-Type': 'application/json',
};

/**
 * Асинхронная функция для получения JWT-токена через API Allure с использованием основного токена
 * @returns {Promise<string>} - Полученный JWT-токен
 * @throws {Error} - Если произошла ошибка при получении токена
 */
export async function getJwtToken() {
    try {
        let spinnerInterval = spinningLoader('Авторизуемся по токену Allure...');

        const response = await axios.post(
            `${config.allureBaseUrl}/api/uaa/oauth/token`,
            new URLSearchParams({
                grant_type: 'apitoken',
                scope: 'openid',
                token: config.allureToken,
            }),
            {
                headers: {
                    'Accept': 'application/json',
                },
            }
        );

        clearInterval(spinnerInterval);

        const jwtToken = response.data.access_token;
        logInfo(`Успешно получен JWT-токен для авторизации в Allure`);
        return jwtToken;
    } catch (error) {
        logError('Ошибка получения JWT-токена от Allure:', error.message);
        throw new Error(`Не удалось получить JWT-токен: ${error.message}`);
    }
}

/**
 * Асинхронная функция для обновления JWT-токена, если текущий истёк
 * Использует блокировку, чтобы избежать параллельных запросов
 * @returns {Promise<string>} - Новый или текущий JWT-токен
 */
async function refreshJwtToken() {
    if (!isRefreshing) {
        isRefreshing = true;
        tokenPromise = getJwtToken().then((newToken) => {
            isRefreshing = false;
            authHeaders['Authorization'] = `Bearer ${newToken}`;
            return newToken;
        }).catch((error) => {
            isRefreshing = false;
            throw error;
        });
    }
    return tokenPromise;
}

/**
 * Функция-обёртка для выполнения fetch-запросов с автоматическим обновлением токена при 401
 * @param {string} url - URL для запроса
 * @param {Object} options - Опции fetch-запроса (headers, method и т.д.)
 * @returns {Promise<Response>} - Ответ от сервера
 * @throws {Error} - Если запрос не удался после обновления токена
 */
export async function fetchWithAuth(url, options = {}) {
    const requestHeaders = {
        ...authHeaders,
        ...(options.headers || {}),
    };

    const timeout = options.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            headers: requestHeaders,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 401) {
            logWarn(`401 Unauthorized для URL: ${url}. Обновляем токен...`);

            try {
                const newToken = await refreshJwtToken();
                requestHeaders['Authorization'] = `Bearer ${newToken}`;

                const retryController = new AbortController();
                const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                try {
                    const retryResponse = await fetch(url, {
                        ...options,
                        headers: requestHeaders,
                        signal: retryController.signal
                    });
                    clearTimeout(retryTimeoutId);
                    return retryResponse;
                } catch (retryError) {
                    clearTimeout(retryTimeoutId);
                    throw retryError;
                }

            } catch (error) {
                logError('Не удалось обновить токен:', error.message);
                throw new Error('Не удалось авторизоваться. Проверьте доступы.');
            }
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Запрос к ${url} превысил таймаут ${timeout}ms`);
        }
        throw error;
    }
}

/**
 * Собрать URL .../testcasetree/entity с query-параметрами
 */
export function buildTestCaseTreeEntityUrl(allureBaseUrl, options) {
    const base = String(allureBaseUrl || '');
    const entityBase = `${base}/api/testcasetree/entity`;
    const {
        projectId,
        treeId,
        page,
        size,
        pathPrefix = [],
        leaf,
        deleted,
    } = options;
    const q = new URLSearchParams();
    q.set('projectId', String(projectId));
    q.set('treeId', String(treeId));
    q.set('page', String(page));
    q.set('size', String(size));
    for (const id of pathPrefix) {
        q.append('path', String(id));
    }
    if (deleted != null) {
        q.set('deleted', String(deleted));
    }
    if (leaf) {
        q.set('leaf', 'true');
    }
    q.set('sort', 'nodeSortOrder,asc');
    return `${entityBase}?${q.toString()}`;
}

/**
 * Ноды страницы из ответа testcasetree/entity
 */
export function getTestCaseTreeEntityContent(data) {
    const fromChildren = data?.children?.content;
    const fromTop = data?.content;
    if (Array.isArray(fromChildren)) return fromChildren;
    if (Array.isArray(fromTop)) return fromTop;
    return [];
}

/**
 * Логирование предупреждений
 * @param {string} message - Сообщение для логирования
 */
function logWarn(message) {
    console.warn(message);
}


export function spinningLoader(text) {
    const spinnerFrames = ['|', '/', '-', '\\'];
    let i = 0;

    const interval = setInterval(() => {
        process.stdout.write(`\r${text}` + spinnerFrames[i]);
        i = (i + 1) % spinnerFrames.length;
    }, 100);

    return interval;
}

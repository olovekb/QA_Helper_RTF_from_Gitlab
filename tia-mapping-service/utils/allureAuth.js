import axios from 'axios'; // Импорт библиотеки для HTTP-запросов
import config from '../config/index.js'; // Импорт конфигурации проекта (через ES-модули)
import { logInfo, logError } from './logger.js'; // Импорт функций логирования

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
    'Authorization': '', // Инициализируем пустой токен, он будет обновлён при первом запросе
    'Content-Type': 'application/json', // Тип контента для запросов
};

/**
 * Асинхронная функция для получения JWT-токена через API Allure с использованием основного токена
 * @returns {Promise<string>} - Полученный JWT-токен
 * @throws {Error} - Если произошла ошибка при получении токена
 */
export async function getJwtToken ()
{
    try {
        // Отображаем спиннер во время выполнения запроса
        let spinnerInterval = spinningLoader('Авторизуемся по токену Allure...');

        // Выполняем POST-запрос к эндпоинту авторизации Allure
        const response = await axios.post(
            `${config.allureBaseUrl}/api/uaa/oauth/token`,
            new URLSearchParams({
                grant_type: 'apitoken', // Тип гранта для получения токена через API-токен
                scope: 'openid', // Область действия токена
                token: config.allureToken, // Основной токен Allure из конфигурации
            }),
            {
                headers: {
                    'Accept': 'application/json', // Ожидаем JSON-ответ
                },
            }
        );

        // Останавливаем спиннер после получения ответа
        clearInterval(spinnerInterval);

        // Извлекаем access_token из ответа
        const jwtToken = response.data.access_token;
        logInfo(`Успешно получен JWT-токен для авторизации в Allure`); // Логирование успеха
        return jwtToken;
    } catch (error) {
        logError('Ошибка получения JWT-токена от Allure:', error.message); // Логирование ошибки
        throw new Error(`Не удалось получить JWT-токен: ${error.message}`); // Выбрасываем ошибку с подробностями
    }
}

/**
 * Асинхронная функция для обновления JWT-токена, если текущий истёк
 * Использует блокировку, чтобы избежать параллельных запросов
 * @returns {Promise<string>} - Новый или текущий JWT-токен
 */
async function refreshJwtToken ()
{
    if (!isRefreshing) {
        isRefreshing = true; // Устанавливаем флаг, чтобы предотвратить параллельные обновления
        tokenPromise = getJwtToken().then((newToken) =>
        {
            isRefreshing = false; // Сбрасываем флаг после обновления
            authHeaders['Authorization'] = `Bearer ${newToken}`; // Обновляем заголовки
            return newToken; // Возвращаем новый токен
        }).catch((error) =>
        {
            isRefreshing = false; // Сбрасываем флаг в случае ошибки
            throw error; // Пробрасываем ошибку
        });
    }
    return tokenPromise; // Возвращаем промис с токеном
}

/**
 * Функция-обёртка для выполнения fetch-запросов с автоматическим обновлением токена при 401
 * @param {string} url - URL для запроса
 * @param {Object} options - Опции fetch-запроса (headers, method и т.д.)
 * @returns {Promise<Response>} - Ответ от сервера
 * @throws {Error} - Если запрос не удался после обновления токена
 */
export async function fetchWithAuth (url, options = {})
{
    // Копируем текущие заголовки и добавляем пользовательские, если есть
    const requestHeaders = {
        ...authHeaders, // Используем глобальные заголовки с токеном
        ...(options.headers || {}), // Дополнительные заголовки из запроса
    };

    // Настройка таймаута (по умолчанию 30 секунд)
    const timeout = options.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        // Выполняем запрос с текущими заголовками
        const response = await fetch(url, {
            ...options,
            headers: requestHeaders,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Проверяем, не истёк ли токен (код 401)
        if (response.status === 401) {
            logWarn(`401 Unauthorized для URL: ${url}. Обновляем токен...`); // Логирование предупреждения

            try {
                const newToken = await refreshJwtToken(); // Получаем новый токен
                requestHeaders['Authorization'] = `Bearer ${newToken}`; // Обновляем заголовки для повторного запроса

                // Повторяем запрос с новым токеном (тоже с таймаутом)
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
                logError('Не удалось обновить токен:', error.message); // Логирование ошибки
                throw new Error('Не удалось авторизоваться. Проверьте доступы.'); // Выбрасываем ошибку
            }
        }

        return response; // Возвращаем успешный ответ
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
export function buildTestCaseTreeEntityUrl (allureBaseUrl, options)
{
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
export function getTestCaseTreeEntityContent (data)
{
    const fromChildren = data?.children?.content;
    const fromTop = data?.content;
    if (Array.isArray(fromChildren)) return fromChildren;
    if (Array.isArray(fromTop)) return fromTop;
    return [];
}

/**
 * Логирование предупреждений (можно добавить в logger.js, если нужно)
 * @param {string} message - Сообщение для логирования
 */
function logWarn (message)
{
    console.warn(message);
}


export function spinningLoader (text)
{
    const spinnerFrames = ['|', '/', '-', '\\'];
    let i = 0;

    const interval = setInterval(() =>
    {
        process.stdout.write(`\r${text}` + spinnerFrames[i]);
        i = (i + 1) % spinnerFrames.length;
    }, 100);

    return interval;
}

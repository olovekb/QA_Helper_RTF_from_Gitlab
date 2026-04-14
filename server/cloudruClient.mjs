import fetch from 'node-fetch';
import https from 'https';
import config from './config.json' assert { type: 'json' };


const CLOUDRU_BASE_URL = 'https://foundation-models.api.cloud.ru/v1';
const API_TOKEN = config.cloudruApiKey;
const DEFAULT_MODEL = 'Qwen/Qwen3-Coder-480B-A35B-Instruct';

const MAX_ATTEMPTS = 5;
const BASE_RETRY_MS = 1000;
const REQUEST_TIMEOUT_MS = 900000;

const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 65000
});

function getAgentForUrl(url) {
    return url.startsWith('https') ? httpsAgent : undefined;
}

function isTransientNetworkError(error) {
    const msg = String(error && error.message || '').toLowerCase();
    const code = String(error && (error.code || ''));
    return (
        msg.includes('socket hang up') ||
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'EPIPE' ||
        msg.includes('premature close') ||
        msg.includes('network error')
    );
}

function getFreshAgent(url) {
    return url.startsWith('https') ? new https.Agent({ keepAlive: false, maxSockets: 1, timeout: 65000 }) : undefined;
}

/**
 * Экранирует плейсхолдеры {{}} в тексте для предотвращения их интерпретации Cloud.ru API
 * @param {string} text - Текст с плейсхолдерами
 * @returns {string} - Текст с экранированными плейсхолдерами
 */
function escapePlaceholders(text) {
    if (typeof text !== 'string') return text;

    const escaped = text.replace(/\{\{([^}]+)\}\}/g, '\\{\\{$1\\}\\}');

    const matches = text.match(/\{\{([^}]+)\}\}/g);
    const count = matches ? matches.length : 0;

    if (count > 0) {
        console.log(`[cloudru] Экранировано плейсхолдеров: ${count}`);
    }

    return escaped;
}

/**
 * Экранирует плейсхолдеры во всех сообщениях
 * @param {Array} messages - Массив сообщений {role, content}
 * @returns {Array} - Массив сообщений с экранированными плейсхолдерами
 */
function escapePlaceholdersInMessages(messages) {
    if (!Array.isArray(messages)) return messages;

    return messages.map(msg => {
        if (typeof msg.content === 'string') {
            return {
                ...msg,
                content: escapePlaceholders(msg.content)
            };
        } else if (Array.isArray(msg.content)) {
            return {
                ...msg,
                content: msg.content.map(item => {
                    if (item.type === 'text' && typeof item.text === 'string') {
                        return {
                            ...item,
                            text: escapePlaceholders(item.text)
                        };
                    }
                    return item;
                })
            };
        }
        return msg;
    });
}

/**
 * Обработка больших запросов через разделение на чанки
 * @param {Array} messages - Исходные сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Объединенный результат
 */
async function processLargeRequest(messages, opts) {
    const { model, temperature, max_tokens, response_format } = opts;

    let largestMessage = null;
    let largestIndex = -1;
    let maxSize = 0;

    messages.forEach((msg, index) => {
        const size = JSON.stringify(msg.content).length;
        if (size > maxSize) {
            maxSize = size;
            largestMessage = msg;
            largestIndex = index;
        }
    });

    if (!largestMessage || largestIndex === -1) {
        throw new Error('Не удалось найти самое большое сообщение для разделения');
    }

    console.log(`\n[cloudru] Разделение сообщения ${largestIndex} (${maxSize} символов) на части...`);

    const content = largestMessage.content;
    const chunkSize = 150000;
    const chunks = [];

    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }

    console.log(`[cloudru] Создано частей: ${chunks.length}`);

    const results = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`\n[cloudru] Обработка части ${i + 1}/${chunks.length}...`);

        const chunkMessages = [...messages];
        chunkMessages[largestIndex] = {
            ...largestMessage,
            content: chunks[i]
        };

        if (chunks.length > 1) {
            chunkMessages[largestIndex].content = `ЧАСТЬ ${i + 1} ИЗ ${chunks.length}:\n\n${chunks[i]}`;
        }

        try {
            const chunkResult = await makeDirectAPICall(chunkMessages, {
                model,
                temperature,
                max_tokens: Math.min(max_tokens, 8000),
                response_format
            });

            results.push(chunkResult.choices?.[0]?.message?.content || '');
            console.log(`[cloudru] Часть ${i + 1} успешно обработана`);

        } catch (error) {
            console.error(`[cloudru] Ошибка в части ${i + 1}:`, error.message);
            results.push('');
        }
    }

    const combinedContent = results.filter(r => r.trim()).join('\n\n');

    console.log(`\n[cloudru] Объединено ${results.length} частей в финальный результат (${combinedContent.length} символов)`);

    return {
        choices: [{
            message: {
                content: combinedContent
            }
        }],
        usage: {
            prompt_tokens: Math.ceil((JSON.stringify(messages || []).length || 0) / 4),
            completion_tokens: Math.ceil((combinedContent?.length || 0) / 4),
            total_tokens: Math.ceil(((JSON.stringify(messages || []).length || 0) + (combinedContent?.length || 0)) / 4)
        },
        model: model
    };
}
const MAX_RATE_LIMIT_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal, agent: options.agent ?? getAgentForUrl(url) });
        return response;
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Таймаут запроса после ${timeoutMs}мс`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Прямой вызов API без проверки размера (для обработки чанков)
 * @param {Array} messages - Сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Результат API
 */
async function makeDirectAPICall(messages, opts) {
    const { model, temperature, max_tokens, response_format } = opts;

    const headers = {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
    };

    const requestBody = {
        model,
        messages,
        temperature,
        max_completion_tokens: max_tokens
    };

    if (response_format) {
        requestBody.response_format = response_format;
    }

    const endpoint = `${CLOUDRU_BASE_URL}/chat/completions`;
    const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        agent: getAgentForUrl(endpoint)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Ошибка Cloud.ru API ${response.status}: ${errorText}`);
    }

    return await response.json();
}

/**
 * Вызывает Cloud.ru API с логикой повторных попыток и обработкой ошибок
 * @param {Array} messages - Массив сообщений в формате {role, content}
 * @param {Object} opts - Опции, включая модель, температуру, max_tokens и т.д.
 * @returns {Promise<Object>} - Ответ API
 */
export async function callCloudRuAPI(messages, opts = {}) {
    const {
        model = DEFAULT_MODEL,
        temperature = 0.25,
        max_tokens = 24000,
        response_format = null,
        tools = null,
        tool_choice = null,
        fastFailOnNetwork = false,
        useResponseFormatForCloudRu = false
    } = opts;

    messages = escapePlaceholdersInMessages(messages);

    if (!API_TOKEN || API_TOKEN === 'YOUR_CLOUDRU_API_KEY_HERE') {
        console.log(`\nКЛЮЧ API CLOUD.RU НЕ НАСТРОЕН`);
        console.log(`${'='.repeat(60)}`);
        console.log(`Ключ API: ${API_TOKEN || 'НЕ УСТАНОВЛЕН'}`);
        console.log(`Пожалуйста, установите ключ API Cloud.ru в config.json`);
        console.log(`Получить ключ можно по адресу: https://foundation-models.api.cloud.ru`);
        console.log(`${'='.repeat(60)}\n`);
        throw new Error('Ключ API Cloud.ru не настроен. Пожалуйста, установите cloudruApiKey в config.json');
    }

    console.log(`\nДИАГНОСТИКА КЛЮЧА API CLOUD.RU`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Формат ключа: ${API_TOKEN.slice(0, 20)}...${API_TOKEN.slice(-10)}`);
    console.log(`Длина ключа: ${API_TOKEN.length} символов`);
    console.log(`Ожидаемый формат: UUID-подобная строка (например, MGQyOTVlZDYtNDI4Ni00M2Y2LWFkMzItM2NkZWE2ZThlZjAz.8a08cf2f0146293a2ee01df32726d9e7)`);
    console.log(`Ключ выглядит валидным: ${API_TOKEN.includes('.') && API_TOKEN.length > 50 ? 'ДА' : 'НЕТ'}`);
    console.log(`${'='.repeat(60)}\n`);

    const requestSize = JSON.stringify(messages).length;
    const estimatedTokens = Math.ceil(requestSize / 4);
    const MAX_TOKENS_CLOUDRU = 262144;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`ЗАПУСК ВЫЗОВА CLOUD.RU API`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Модель: ${model}`);
    console.log(`Температура: ${temperature}`);
    console.log(`Макс. токенов: ${max_tokens}`);
    console.log(`Количество сообщений: ${messages.length}`);
    console.log(`Размер запроса: ${requestSize} симв.`);
    console.log(`Оценочное кол-во токенов: ${estimatedTokens}`);
    console.log(`Лимит токенов: ${MAX_TOKENS_CLOUDRU}`);
    console.log(`Ключ API: ${API_TOKEN.slice(0, 8)}...${API_TOKEN.slice(-4)}`);
    console.log(`Базовый URL: ${CLOUDRU_BASE_URL}`);

    if (estimatedTokens > MAX_TOKENS_CLOUDRU) {
        console.log(`\n[cloudru] Запрос слишком большой (${estimatedTokens} токенов > ${MAX_TOKENS_CLOUDRU}), разделение на части...`);
        return await processLargeRequest(messages, opts);
    }
    console.log(`\nПРОВЕРКА ДОСТУПНОСТИ CLOUD.RU API`);
    console.log(`${'='.repeat(60)}`);
    try {
        const testResponse = await fetch(`${CLOUDRU_BASE_URL}/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
            },
            agent: getAgentForUrl(`${CLOUDRU_BASE_URL}/models`)
        });
        console.log(`Статус тестового запроса: ${testResponse.status} ${testResponse.statusText}`);
        if (testResponse.ok) {
            const testData = await testResponse.json();
            console.log(`API Cloud.ru доступно`);
            console.log(`Доступные модели: ${testData.data?.length || 0}`);
        } else {
            const errorText = await testResponse.text();
            console.log(`Тест API Cloud.ru не удался: ${errorText}`);
        }
    } catch (testError) {
        console.log(`Ошибка теста API Cloud.ru: ${testError.message}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    const headers = {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
    };

    const MAX_TOTAL_TOKENS = 262144;
    const RESERVE_TOKENS = 5000;
    const maxAllowedCompletionTokens = Math.max(0, MAX_TOTAL_TOKENS - estimatedTokens - RESERVE_TOKENS);

    let adjustedMaxTokens = max_tokens;
    if (estimatedTokens + max_tokens > MAX_TOTAL_TOKENS) {
        adjustedMaxTokens = Math.min(max_tokens, maxAllowedCompletionTokens);
        console.warn(` [cloudru] Превышен лимит токенов! Вход: ${estimatedTokens}, макс_токенов: ${max_tokens}, лимит: ${MAX_TOTAL_TOKENS}`);
        console.warn(` [cloudru] Уменьшаю макс_токенов с ${max_tokens} до ${adjustedMaxTokens} для соответствия лимиту модели`);

        if (adjustedMaxTokens < 1000) {
            throw new Error(` [cloudru] Входные сообщения слишком большие (${estimatedTokens} токенов)! Максимум для завершения: ${maxAllowedCompletionTokens}.`);
        }
    } else {
        console.log(`[cloudru] Лимит токенов в норме: вход ${estimatedTokens} + завершение ${max_tokens} = ${estimatedTokens + max_tokens} ≤ ${MAX_TOTAL_TOKENS}`);
    }

    const requestBody = {
        model,
        messages,
        temperature,
        max_completion_tokens: adjustedMaxTokens
    };

    if (response_format) {
        if (useResponseFormatForCloudRu) {
            requestBody.response_format = response_format;
            console.log(`\n [cloudru] формат_ответа включен, размер: ${JSON.stringify(response_format).length} символов\n`);
        }
    }
    if (tools) {
        requestBody.tools = tools;
        console.log(`  Инструменты: ${tools.length}`);
    }
    if (tool_choice) {
        requestBody.tool_choice = tool_choice;
        console.log(`  Выбор инструмента: ${JSON.stringify(tool_choice)}`);
    }

    let rateRetries = 0;
    let forceFresh = false;
    const endpoint = `${CLOUDRU_BASE_URL}/chat/completions`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            console.log(`\n [cloudru] ПОПЫТКА ${attempt}/${MAX_ATTEMPTS}`);
            console.log(` Размер тела запроса: ${JSON.stringify(requestBody).length} симв.`);
            console.log(` Отправка на: ${endpoint}`);

            let requestBodyString;
            try {
                requestBodyString = JSON.stringify(requestBody);
                JSON.parse(requestBodyString);
                console.log(`Валидация JSON пройдена`);
            } catch (jsonError) {
                console.error(`Ошибка валидации JSON:`, jsonError.message);
                if (requestBody.messages) {
                    requestBody.messages.forEach((msg, idx) => {
                        try {
                            JSON.stringify(msg);
                        } catch (e) {
                            console.error(` Некорректное сообщение по индексу ${idx}:`, e.message);
                            console.error(`Превью контента:`, msg.content?.substring(0, 500));
                        }
                    });
                }
                throw new Error(`Недопустимый JSON в теле запроса: ${jsonError.message}`);
            }

            const callHeaders = { ...headers };
            const agent = forceFresh ? getFreshAgent(endpoint) : getAgentForUrl(endpoint);
            if (forceFresh) callHeaders['Connection'] = 'close';

            const response = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: callHeaders,
                body: requestBodyString,
                agent
            });

            console.log(`Статус ответа: ${response.status} ${response.statusText}`);
            console.log(`Заголовки ответа: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');

                console.log(`\n ОШИБКА CLOUD.RU API`);
                console.log(`${'='.repeat(60)}`);
                console.log(` Статус: ${response.status} ${response.statusText}`);
                console.log(` URL: ${CLOUDRU_BASE_URL}/chat/completions`);
                console.log(` Ответ с ошибкой: ${errorText}`);
                console.log(` Повторить через: ${response.headers.get('retry-after') || 'Не установлено'}`);
                console.log(` Попытка: ${attempt}/${MAX_ATTEMPTS}`);
                console.log(` Повторов лимита: ${rateRetries}/${MAX_RATE_LIMIT_RETRIES}`);

                if (requestBody.messages) {
                    const hasPlaceholders = requestBody.messages.some(msg =>
                        typeof msg.content === 'string' && msg.content.includes('{{')
                    );
                    if (hasPlaceholders) {
                        console.log(`\n  ОБНАРУЖЕНЫ ПЛЕЙСХОЛДЕРЫ {{}} В СООБЩЕНИЯХ`);
                        console.log(` Это может вызвать проблемы в API Cloud.ru`);
                        console.log(` Рассмотрите возможность экранирования или удаления плейсхолдеров перед отправкой`);

                        requestBody.messages.forEach((msg, idx) => {
                            if (typeof msg.content === 'string' && msg.content.includes('{{')) {
                                const matches = msg.content.match(/\{\{[^}]+\}\}/g);
                                if (matches && matches.length > 0) {
                                    console.log(`  Сообщение ${idx} (${msg.role}): Найдено ${matches.length} плейсхолдер(ов)`);
                                    console.log(`  Примеры: ${matches.slice(0, 3).join(', ')}`);
                                }
                            }
                        });
                    }
                }
                console.log(` Модель: ${model}`);
                console.log(` Размер запроса: ${JSON.stringify(requestBody).length} симв.`);
                console.log(` Оценочное кол-во токенов: ${Math.ceil(JSON.stringify(requestBody).length / 4)}`);
                console.log(`${'='.repeat(60)}\n`);

                if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : BASE_RETRY_MS * attempt;

                    console.log(` [cloudru] Обнаружено ограничение частоты запросов (429)`);
                    console.log(` Ожидание ${Math.round(waitMs / 1000)}с перед повтором...`);
                    await sleep(waitMs);
                    rateRetries++;

                    if (rateRetries > MAX_RATE_LIMIT_RETRIES) {
                        console.log(` [cloudru] Превышено количество попыток при ограничении частоты (${MAX_RATE_LIMIT_RETRIES})`);
                        throw new Error(`Лимит частоты Cloud.ru превышен после ${MAX_RATE_LIMIT_RETRIES} попыток`);
                    }
                    attempt--;
                    continue;
                }
                if (response.status >= 500) {
                    const waitMs = BASE_RETRY_MS * Math.pow(2, attempt - 1);
                    console.log(` [cloudru] Ошибка сервера ${response.status} - повтор через ${waitMs}мс`);
                    await sleep(waitMs);
                    continue;
                }

                if (response.status === 400) {
                    const tokenLimitMatch = errorText.match(/maximum context length is (\d+) tokens/);
                    const inputTokensMatch = errorText.match(/has (\d+) input tokens/);

                    if (tokenLimitMatch && inputTokensMatch) {
                        const modelMaxTokens = parseInt(tokenLimitMatch[1]);
                        const realInputTokens = parseInt(inputTokensMatch[1]);
                        const availableTokens = modelMaxTokens - realInputTokens - RESERVE_TOKENS;

                        if (availableTokens > 0 && adjustedMaxTokens > availableTokens) {
                            const newMaxTokens = Math.max(1000, Math.floor(availableTokens * 0.9));
                            console.warn(`\n [cloudru] Обнаружено превышение лимита токенов!`);
                            console.warn(` Реальный вход: ${realInputTokens} токенов, лимит модели: ${modelMaxTokens}`);
                            console.warn(` Доступно для завершения: ${availableTokens} токенов`);
                            console.warn(` Уменьшаю макс_токенов с ${adjustedMaxTokens} до ${newMaxTokens} и повторяю запрос...`);

                            adjustedMaxTokens = newMaxTokens;
                            requestBody.max_completion_tokens = adjustedMaxTokens;
                            await sleep(BASE_RETRY_MS);
                            continue;
                        }
                    }
                }

                console.log(` [cloudru] Ошибка клиента ${response.status} - повтор невозможен`);
                throw new Error(`Ошибка Cloud.ru API ${response.status}: ${errorText}`);
            }

            const responseText = await response.text();
            console.log(`\n УСПЕШНЫЙ ОТВЕТ CLOUD.RU API`);
            console.log(`${'='.repeat(60)}`);
            console.log(` Длина сырого ответа: ${responseText.length} симв.`);
            console.log(` Превью сырого ответа (первые 1000 симв.): ${responseText.substring(0, 1000)}`);

            if (!responseText || responseText.trim().length === 0) {
                console.error(` ОШИБКА: Пустой ответ от Cloud.ru API!`);
                throw new Error('Cloud.ru API вернул пустой ответ. Возможно, сервер перегружен или произошла ошибка на стороне API.');
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.error(` Ошибка парсинга JSON ответа: ${parseError.message}`);
                console.error(` Длина сырого ответа: ${responseText.length} симв.`);
                console.error(` Сырой ответ (первые 2000 симв.): ${responseText.substring(0, 2000)}`);
                console.error(` Сырой ответ (последние 500 симв.): ${responseText.substring(Math.max(0, responseText.length - 500))}`);

                if (parseError.message.includes('end of input') ||
                    parseError.message.includes('Unexpected end') ||
                    parseError.message.includes('JSON')) {
                    console.log(` Попытка восстановить обрезанный/поврежденный JSON...`);
                    const trimmedResponse = responseText.trim();

                    if (trimmedResponse.length === 0) {
                        throw new Error('Cloud.ru API вернул пустой ответ');
                    }

                    const lastBrace = trimmedResponse.lastIndexOf('}');
                    const lastBracket = trimmedResponse.lastIndexOf(']');
                    const cutPos = Math.max(lastBrace, lastBracket);

                    if (cutPos > 0 && cutPos > trimmedResponse.length * 0.8) {
                        try {
                            const partialText = trimmedResponse.substring(0, cutPos + 1);
                            data = JSON.parse(partialText);
                            console.log(` Успешно восстановлен обрезанный JSON (обрезано ${trimmedResponse.length - cutPos - 1} символов)`);
                        } catch (recoveryError) {
                            console.error(` Не удалось восстановить JSON: ${recoveryError.message}`);
                            throw new Error(`Не удалось восстановить обрезанный JSON ответ от Cloud.ru API. Оригинальная ошибка: ${parseError.message}`);
                        }
                    } else if (cutPos <= 0) {
                        console.error(` КРИТИЧЕСКАЯ ОШИБКА: В ответе нет закрывающих скобок!`);
                        throw new Error(`Ответ от Cloud.ru API не содержит валидного JSON (нет закрывающих скобок). Возможно, ответ был полностью обрезан.`);
                    } else {
                        console.error(` КРИТИЧЕСКАЯ ОШИБКА: Ответ обрезан более чем на 20%!`);
                        throw new Error(`Ответ от Cloud.ru API обрезан более чем на 20% (обрезано ${trimmedResponse.length - cutPos} из ${trimmedResponse.length} символов). Возможно, превышен лимит ответа.`);
                    }
                } else {
                    throw new Error(`Ошибка парсинга JSON ответа от Cloud.ru API: ${parseError.message}`);
                }
            }

            const finishReason = data.choices?.[0]?.finish_reason;
            if (finishReason && finishReason !== 'stop') {
                console.warn(` [cloudru] причина_завершения=${finishReason} - ответ может быть обрезан`);
                if (finishReason === 'length') {
                    console.warn(` [cloudru] Ответ обрезан из-за лимита макс_токенов!`);
                }
            } else if (finishReason === 'stop') {
                console.log(` [cloudru] причина_завершения=stop - ответ полный`);
            }
            const content = data.choices?.[0]?.message?.content || '';
            if (!content || content.length === 0) {
                if (data.choices?.[0]?.message?.tool_calls) {
                    console.log(` [cloudru] Содержимое пустое, но есть вызовы инструментов - это нормально`);
                } else {
                    console.warn(` [cloudru] Содержимое пустое и нет вызовов инструментов!`);
                }
            } else {
                const trimmedContent = content.trim();
                if (trimmedContent.length > 0 && !trimmedContent.endsWith('}') && !trimmedContent.endsWith(']')) {
                    console.warn(` [cloudru] Содержимое возможно обрезано: не заканчивается на } или ]`);
                    console.warn(` Последние 200 симв. содержимого: ${trimmedContent.substring(Math.max(0, trimmedContent.length - 200))}`);
                }

                console.log(` Длина содержимого: ${content.length} симв.`);
                console.log(` Начало содержимого (первые 300): ${content.substring(0, 300)}`);
                console.log(` Конец содержимого (последние 300): ${content.substring(Math.max(0, content.length - 300))}`);
            }

            console.log(` Использование: ${JSON.stringify(data.usage || {}, null, 2)}`);
            console.log(` Длина ответа: ${JSON.stringify(data).length} симв.`);
            console.log(` Использованная модель: ${data.model || 'Неизвестно'}`);
            console.log(` Количество вариантов (choices): ${data.choices?.length || 0}`);

            console.log(` Анализ структуры ответа:`);
            console.log(`  - есть_варианты: ${!!data.choices}`);
            console.log(`  - количество_вариантов: ${data.choices?.length || 0}`);
            if (data.choices && data.choices.length > 0) {
                console.log(`  - ключи_варианта[0]: ${Object.keys(data.choices[0] || {}).join(', ')}`);
                console.log(`  - причина_завершения: ${data.choices[0]?.finish_reason || 'н/д'}`);
                console.log(`  - есть_сообщение: ${!!data.choices[0]?.message}`);
                if (data.choices[0]?.message) {
                    console.log(`  - ключи_сообщения: ${Object.keys(data.choices[0].message || {}).join(', ')}`);
                    console.log(`  - есть_контент: ${!!data.choices[0]?.message?.content}`);
                    console.log(`  - тип_контента: ${typeof data.choices[0]?.message?.content}`);
                    console.log(`  - длина_контента: ${data.choices[0]?.message?.content?.length || 0}`);
                    console.log(`  - есть_вызовы_инструментов: ${!!data.choices[0]?.message?.tool_calls}`);
                    console.log(`  - количество_вызовов_инструментов: ${data.choices[0]?.message?.tool_calls?.length || 0}`);
                    if (!data.choices[0]?.message?.content && !data.choices[0]?.message?.tool_calls) {
                        console.log(`  ПРОБЛЕМА: сообщение пустое, но завершающие токены > 0`);
                        console.log(`  Полная структура сообщения: ${JSON.stringify(data.choices[0]?.message, null, 2)}`);
                        console.log(`  Полная структура варианта[0]: ${JSON.stringify(data.choices[0], null, 2)}`);
                        if (data.choices[0]?.delta) {
                            console.log(`  Найден delta: ${JSON.stringify(data.choices[0].delta, null, 2)}`);
                        }
                        if (data.choices[0]?.text) {
                            console.log(`  Найден text: ${data.choices[0].text}`);
                        }
                        if (data.content) {
                            console.log(`  Найден content в корне: ${data.content}`);
                        }
                    }
                }
            }

            if (data.choices?.[0]?.delta) {
                console.log(`Обнаружен потоковый формат (delta), ожидается обычный`);
                console.log(`Структура delta: ${JSON.stringify(data.choices[0].delta, null, 2)}`);
            }

            if (data.choices?.[0]?.message?.tool_calls) {
                console.log(`Детали вызовов инструментов:`);
                data.choices[0].message.tool_calls.forEach((tc, i) => {
                    console.log(`  Инструмент ${i + 1}: ${tc.function?.name} (аргументы: ${tc.function?.arguments?.length || 0} симв.)`);
                });
            }

            if (!content && data.choices?.[0]?.message?.tool_calls) {
                console.log(`Содержимое пустое, но есть вызовы инструментов - ожидаемо для Cloud.ru`);
            }

            console.log(`Сырое содержимое: "${content}"`);

            if (content === '```' || (content.startsWith('```') && !content.includes('```', 3))) {
                console.log(`[cloudru] Обнаружен неполный ответ markdown, попытка исправления...`);

                try {
                    const retryResponse = await fetchWithTimeout(`${CLOUDRU_BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            ...requestBody,
                            max_completion_tokens: Math.min(max_tokens * 2, 32000),
                            temperature: Math.min(temperature + 0.1, 0.5)
                        }),
                        agent: getAgentForUrl(`${CLOUDRU_BASE_URL}/chat/completions`)
                    });

                    if (retryResponse.ok) {
                        const retryData = await retryResponse.json();
                        const retryContent = retryData.choices?.[0]?.message?.content || '';
                        console.log(`[cloudru] Содержимое повтора: "${retryContent.slice(0, 200)}..."`);

                        if (retryContent && retryContent !== '```' && retryContent.length > content.length) {
                            console.log(`[cloudru] Повтор успешен, использую новый ответ`);
                            data.choices[0].message.content = retryContent;
                            data.usage = retryData.usage;
                        } else {
                            console.log(`[cloudru] Повтор также вернул неполный ответ, использую оригинал`);
                        }
                    }
                } catch (retryError) {
                    console.log(`[cloudru] Повтор не удался: ${retryError.message}`);
                }
            }

            if (data.choices?.[0]?.message?.content) {
                const finalContent = data.choices[0].message.content;
                console.log(`Превью финального содержимого: ${finalContent.slice(0, 200)}${finalContent.length > 200 ? '...' : ''}`);
            }
            console.log(`${'='.repeat(60)}\n`);

            return data;

        } catch (error) {
            console.log(`\n ИСКЛЮЧЕНИЕ CLOUD.RU`);
            console.log(`${'='.repeat(60)}`);
            console.log(` Тип ошибки: ${error.constructor.name}`);
            console.log(` Сообщение об ошибке: ${error.message}`);
            console.log(` Попытка: ${attempt}/${MAX_ATTEMPTS}`);
            console.log(` Повторов лимита: ${rateRetries}/${MAX_RATE_LIMIT_RETRIES}`);
            console.log(` Код ошибки: ${error.code || 'н/д'}`);
            console.log(` Конечная точка: ${endpoint}`);
            console.log(` Модель: ${model}`);
            if (error.stack) {
                console.log(` Стек вызовов: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
            }
            console.log(`${'='.repeat(60)}\n`);

            if (attempt === MAX_ATTEMPTS) {
                console.log(`[cloudru] Все попытки исчерпаны - выбрасываю ошибку`);
                throw error;
            }

            if (isTransientNetworkError(error)) {
                if (fastFailOnNetwork) {
                    console.log(`[cloudru] Ошибка сети, быстрый отказ для переключения модели`);
                    const err = new Error(`network-fast-fail: ${error.message}`);
                    err.code = 'NETWORK_FAST_FAIL';
                    throw err;
                }
                const waitMs = 500 * attempt;
                console.log(`[cloudru] Ошибка сети, ожидание ${waitMs}мс перед повтором...`);
                await sleep(waitMs);
                forceFresh = true;
                continue;
            }

            const waitMs = BASE_RETRY_MS * Math.pow(2, attempt - 1);
            console.log(`[cloudru] Ожидание ${waitMs}мс перед повтором...`);
            await sleep(waitMs);
        }
    }

    console.log(`[cloudru] Все попытки провалены`);
    throw new Error('Cloud.ru API: Все попытки провалены');
}

/**
 * Универсальная функция, которая сначала пробует Cloud.ru, а затем переключается на OpenRouter
 * @param {string} url - URL OpenRouter (для отката)
 * @param {Array} messages - Массив сообщений в формате {role, content}
 * @param {string} openRouterApiKey - API ключ OpenRouter
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Ответ API
 */
export async function callWithCloudRuFallback(url, messages, openRouterApiKey, opts = {}) {
    const {
        models = config.cloudruModels,
        temperature = 0.25,
        max_tokens = 24000,
        response_format = null,
        tools = null,
        tool_choice = null,
        logRateLimit = true,
        cloudFirstTimeoutMs = 120000,
        useResponseFormatForCloudRu = false
    } = opts;

    console.log(`\n ЗАПУСК ГИБРИДНОГО ВЫЗОВА API`);
    console.log(`${'='.repeat(80)}`);
    console.log(` Стратегия: Сначала Cloud.ru, затем OpenRouter`);
    console.log(` Модели Cloud.ru для попыток: ${Array.isArray(models) ? models.join(', ') : '—'}`);
    console.log(` Температура: ${typeof temperature === 'number' ? temperature : '—'}`);
    console.log(` Макс. токенов: ${typeof max_tokens === 'number' ? max_tokens : '—'}`);
    console.log(` Количество сообщений: ${Array.isArray(messages) ? messages.length : 0}`);
    console.log(`${'='.repeat(80)}\n`);

    const deadline = Date.now() + cloudFirstTimeoutMs;
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        try {
            console.log(`\n[hybrid] Попытка модели Cloud.ru ${i + 1}/${models.length}: ${model}`);

            const result = await callCloudRuAPI(messages, {
                model,
                temperature,
                max_tokens,
                response_format,
                tools,
                tool_choice,
                fastFailOnNetwork: true,
                useResponseFormatForCloudRu
            });

            console.log(`\n[hybrid] Успех Cloud.ru с моделью: ${model}`);
            const rawMsg = result?.choices?.[0]?.message || {};
            const hasTool = Array.isArray(rawMsg.tool_calls) && rawMsg.tool_calls.length > 0;
            const contentStr = String(rawMsg.content || '').trim();
            if (!hasTool && !contentStr) {
                console.log(`[hybrid] Cloud.ru вернул пустой контент без инструментов → использую OpenRouter`);
                throw new Error('cloudru-empty');
            }
            console.log(`Возврат результата Cloud.ru, пропуск OpenRouter`);
            return result;

        } catch (error) {
            console.log(`\n[hybrid] Ошибка модели Cloud.ru ${model}`);
            console.log(` Ошибка: ${error.message}`);

            if (
                error.message.includes('rate limit') ||
                error.message.includes('server error') ||
                error.message.includes('cloudru-empty') ||
                error.code === 'NETWORK_FAST_FAIL'
            ) {
                console.log(`[hybrid] Лимит запросов или ошибка сервера - попытка следующей модели Cloud.ru`);
                if (Date.now() > deadline) {
                    console.log(`[hybrid] Превышен бюджет времени для Cloud.ru (${cloudFirstTimeoutMs}мс). Переход к OpenRouter.`);
                    break;
                }
                continue;
            }

            console.log(`[hybrid] Критическая ошибка - немедленный переход к OpenRouter`);
            console.log(` Детали ошибки: ${error.message}`);
            console.log(` Тип ошибки: ${error.constructor.name}`);
            if (error.code) console.log(` Код ошибки: ${error.code}`);
            break;
        }
    }

    console.log(`\n[hybrid] Все модели Cloud.ru провалены, переход к OpenRouter`);
    console.log(` Модели OpenRouter: ${config.fallbackModels.join(', ')}`);
    console.log(` URL OpenRouter: ${url}`);

    const { callWithBackoff } = await import('./server.js');

    try {
        const result = await callWithBackoff(url, messages, openRouterApiKey, {
            models: config.fallbackModels,
            temperature,
            max_tokens,
            response_format,
            tools,
            tool_choice,
            logRateLimit
        });

        console.log(`\n[hybrid] Успешный ответ OpenRouter`);
        return result;

    } catch (error) {
        console.log(`\n[hybrid] Ошибка OpenRouter также провалена`);
        console.log(` Финальная ошибка: ${error.message}`);
        throw error;
    }
}

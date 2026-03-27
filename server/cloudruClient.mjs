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
        console.log(`[cloudru] Экранированы ${count} placeholder(s)`);
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
        throw new Error('Could not find largest message to split');
    }

    console.log(`\n[cloudru] Splitting message ${largestIndex} (${maxSize} chars) into chunks...`);

    const content = largestMessage.content;
    const chunkSize = 150000;
    const chunks = [];

    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }

    console.log(`[cloudru] Created ${chunks.length} chunks`);

    const results = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`\n[cloudru] Processing chunk ${i + 1}/${chunks.length}...`);

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
            console.log(`[cloudru] Chunk ${i + 1} processed successfully`);

        } catch (error) {
            console.error(`[cloudru] Chunk ${i + 1} failed:`, error.message);
            results.push('');
        }
    }

    const combinedContent = results.filter(r => r.trim()).join('\n\n');

    console.log(`\n[cloudru] Combined ${results.length} chunks into final result (${combinedContent.length} chars)`);

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
            throw new Error(`Request timeout after ${timeoutMs}ms`);
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
        throw new Error(`Cloud.ru API error ${response.status}: ${errorText}`);
    }

    return await response.json();
}

/**
 * Call Cloud.ru API with retry logic and error handling
 * @param {Array} messages - Array of {role, content} messages
 * @param {Object} opts - Options including model, temperature, max_tokens, etc.
 * @returns {Promise<Object>} - API response
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

    // === ПРОВЕРКА API КЛЮЧА ===
    if (!API_TOKEN || API_TOKEN === 'YOUR_CLOUDRU_API_KEY_HERE') {
        console.log(`\nCLOUD.RU API KEY NOT CONFIGURED`);
        console.log(`${'='.repeat(60)}`);
        console.log(`API Key: ${API_TOKEN || 'NOT SET'}`);
        console.log(`Please set your Cloud.ru API key in config.json`);
        console.log(`Get your key at: https://foundation-models.api.cloud.ru`);
        console.log(`${'='.repeat(60)}\n`);
        throw new Error('Cloud.ru API key not configured. Please set cloudruApiKey in config.json');
    }

    console.log(`\nCLOUD.RU API KEY DIAGNOSTICS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`API Key format: ${API_TOKEN.slice(0, 20)}...${API_TOKEN.slice(-10)}`);
    console.log(`API Key length: ${API_TOKEN.length} characters`);
    console.log(`Expected format: UUID-like string (e.g., MGQyOTVlZDYtNDI4Ni00M2Y2LWFkMzItM2NkZWE2ZThlZjAz.8a08cf2f0146293a2ee01df32726d9e7)`);
    console.log(`Key looks valid: ${API_TOKEN.includes('.') && API_TOKEN.length > 50 ? 'YES' : 'NO'}`);
    console.log(`${'='.repeat(60)}\n`);

    const requestSize = JSON.stringify(messages).length;
    const estimatedTokens = Math.ceil(requestSize / 4);
    const MAX_TOKENS_CLOUDRU = 262144;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`CLOUD.RU API CALL START`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Model: ${model}`);
    console.log(`Temperature: ${temperature}`);
    console.log(`Max tokens: ${max_tokens}`);
    console.log(`Messages count: ${messages.length}`);
    console.log(`Request size: ${requestSize} chars`);
    console.log(`Estimated tokens: ${estimatedTokens}`);
    console.log(`Token limit: ${MAX_TOKENS_CLOUDRU}`);
    console.log(`API Key: ${API_TOKEN.slice(0, 8)}...${API_TOKEN.slice(-4)}`);
    console.log(`Base URL: ${CLOUDRU_BASE_URL}`);

    if (estimatedTokens > MAX_TOKENS_CLOUDRU) {
        console.log(`\n[cloudru] Request too large (${estimatedTokens} tokens > ${MAX_TOKENS_CLOUDRU}), splitting into chunks...`);
        return await processLargeRequest(messages, opts);
    }
    console.log(`\nTESTING CLOUD.RU API CONNECTIVITY`);
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
        console.log(`Test request status: ${testResponse.status} ${testResponse.statusText}`);
        if (testResponse.ok) {
            const testData = await testResponse.json();
            console.log(`Cloud.ru API is accessible`);
            console.log(`Available models: ${testData.data?.length || 0} models`);
        } else {
            const errorText = await testResponse.text();
            console.log(`Cloud.ru API test failed: ${errorText}`);
        }
    } catch (testError) {
        console.log(`Cloud.ru API test error: ${testError.message}`);
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
        console.warn(` [cloudru] Превышен лимит токенов! Вход: ${estimatedTokens}, max_tokens: ${max_tokens}, лимит: ${MAX_TOTAL_TOKENS}`);
        console.warn(`  [cloudru] Уменьшаю max_tokens с ${max_tokens} до ${adjustedMaxTokens} для соответствия лимиту модели`);

        if (adjustedMaxTokens < 1000) {
            throw new Error(` [cloudru] Входные сообщения слишком большие (${estimatedTokens} токенов)! Максимум для completion: ${maxAllowedCompletionTokens}. Используйте chunking для входных данных.`);
        }
    } else {
        console.log(`[cloudru] Лимит токенов в порядке: вход ${estimatedTokens} + completion ${max_tokens} = ${estimatedTokens + max_tokens} ≤ ${MAX_TOTAL_TOKENS}`);
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
            console.log(`\n [cloudru] response_format включен, размер: ${JSON.stringify(response_format).length} символов\n`);
        }
    }
    if (tools) {
        requestBody.tools = tools;
        console.log(`  Tools: ${tools.length} tool(s)`);
    }
    if (tool_choice) {
        requestBody.tool_choice = tool_choice;
        console.log(`  Tool choice: ${JSON.stringify(tool_choice)}`);
    }

    let rateRetries = 0;
    let forceFresh = false;
    const endpoint = `${CLOUDRU_BASE_URL}/chat/completions`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            console.log(`\n [cloudru] ATTEMPT ${attempt}/${MAX_ATTEMPTS}`);
            console.log(` Request body size: ${JSON.stringify(requestBody).length} chars`);
            console.log(` Sending to: ${endpoint}`);

            let requestBodyString;
            try {
                requestBodyString = JSON.stringify(requestBody);
                JSON.parse(requestBodyString);
                console.log(`JSON validation passed`);
            } catch (jsonError) {
                console.error(`JSON validation failed:`, jsonError.message);
                if (requestBody.messages) {
                    requestBody.messages.forEach((msg, idx) => {
                        try {
                            JSON.stringify(msg);
                        } catch (e) {
                            console.error(` Invalid message at index ${idx}:`, e.message);
                            console.error(`Message content preview:`, msg.content?.substring(0, 500));
                        }
                    });
                }
                throw new Error(`Invalid JSON in request body: ${jsonError.message}`);
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

            console.log(`Response status: ${response.status} ${response.statusText}`);
            console.log(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');

                console.log(`\n CLOUD.RU API ERROR`);
                console.log(`${'='.repeat(60)}`);
                console.log(` Status: ${response.status} ${response.statusText}`);
                console.log(` URL: ${CLOUDRU_BASE_URL}/chat/completions`);
                console.log(` Error response: ${errorText}`);
                console.log(` Retry-After: ${response.headers.get('retry-after') || 'Not set'}`);
                console.log(` Attempt: ${attempt}/${MAX_ATTEMPTS}`);
                console.log(` Rate retries: ${rateRetries}/${MAX_RATE_LIMIT_RETRIES}`);

                if (requestBody.messages) {
                    const hasPlaceholders = requestBody.messages.some(msg =>
                        typeof msg.content === 'string' && msg.content.includes('{{')
                    );
                    if (hasPlaceholders) {
                        console.log(`\n  DETECTED {{}} PLACEHOLDERS IN MESSAGES`);
                        console.log(` This might cause issues with Cloud.ru API`);
                        console.log(` Consider escaping or removing placeholders before sending`);

                        requestBody.messages.forEach((msg, idx) => {
                            if (typeof msg.content === 'string' && msg.content.includes('{{')) {
                                const matches = msg.content.match(/\{\{[^}]+\}\}/g);
                                if (matches && matches.length > 0) {
                                    console.log(`  Message ${idx} (${msg.role}): Found ${matches.length} placeholder(s)`);
                                    console.log(`  Examples: ${matches.slice(0, 3).join(', ')}`);
                                }
                            }
                        });
                    }
                }
                console.log(` Model: ${model}`);
                console.log(` Request size: ${JSON.stringify(requestBody).length} chars`);
                console.log(` Estimated tokens: ${Math.ceil(JSON.stringify(requestBody).length / 4)}`);
                console.log(`${'='.repeat(60)}\n`);

                if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : BASE_RETRY_MS * attempt;

                    console.log(` [cloudru] 429 rate limit detected`);
                    console.log(` Waiting ${Math.round(waitMs / 1000)}s before retry...`);
                    await sleep(waitMs);
                    rateRetries++;

                    if (rateRetries > MAX_RATE_LIMIT_RETRIES) {
                        console.log(` [cloudru] Rate limit retries exceeded (${MAX_RATE_LIMIT_RETRIES})`);
                        throw new Error(`Cloud.ru rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES} retries`);
                    }
                    attempt--;
                    continue;
                }
                if (response.status >= 500) {
                    const waitMs = BASE_RETRY_MS * Math.pow(2, attempt - 1);
                    console.log(` [cloudru] ${response.status} server error - retrying in ${waitMs}ms`);
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
                            console.warn(` Доступно для completion: ${availableTokens} токенов`);
                            console.warn(` Уменьшаю max_tokens с ${adjustedMaxTokens} до ${newMaxTokens} и повторяю запрос...`);

                            adjustedMaxTokens = newMaxTokens;
                            requestBody.max_completion_tokens = adjustedMaxTokens;
                            await sleep(BASE_RETRY_MS);
                            continue;
                        }
                    }
                }

                console.log(` [cloudru] Client error ${response.status} - not retrying`);
                throw new Error(`Cloud.ru API error ${response.status}: ${errorText}`);
            }

            const responseText = await response.text();
            console.log(`\n CLOUD.RU API SUCCESS`);
            console.log(`${'='.repeat(60)}`);
            console.log(` Raw response length: ${responseText.length} chars`);
            console.log(` Raw response preview (first 1000 chars): ${responseText.substring(0, 1000)}`);

            if (!responseText || responseText.trim().length === 0) {
                console.error(` ОШИБКА: Пустой ответ от Cloud.ru API!`);
                throw new Error('Cloud.ru API вернул пустой ответ. Возможно, сервер перегружен или произошла ошибка на стороне API.');
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.error(` Ошибка парсинга JSON ответа: ${parseError.message}`);
                console.error(` Raw response length: ${responseText.length} chars`);
                console.error(` Raw response (first 2000 chars): ${responseText.substring(0, 2000)}`);
                console.error(` Raw response (last 500 chars): ${responseText.substring(Math.max(0, responseText.length - 500))}`);

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
                console.warn(`⚠️  [cloudru] finish_reason=${finishReason} - ответ может быть обрезан`);
                if (finishReason === 'length') {
                    console.warn(`⚠️  [cloudru] Ответ обрезан из-за max_tokens лимита!`);
                }
            } else if (finishReason === 'stop') {
                console.log(` [cloudru] finish_reason=stop - ответ полный`);
            }
            const content = data.choices?.[0]?.message?.content || '';
            if (!content || content.length === 0) {
                if (data.choices?.[0]?.message?.tool_calls) {
                    console.log(`ℹ️  [cloudru] Content пустой, но есть tool_calls - это нормально`);
                } else {
                    console.warn(`⚠️  [cloudru] Content пустой и нет tool_calls!`);
                }
            } else {
                // ✅ Проверяем, обрезан ли content
                const trimmedContent = content.trim();
                if (trimmedContent.length > 0 && !trimmedContent.endsWith('}') && !trimmedContent.endsWith(']')) {
                    console.warn(`⚠️  [cloudru] Content возможно обрезан: не заканчивается на } или ]`);
                    console.warn(`📝 Content последние 200 chars: ${trimmedContent.substring(Math.max(0, trimmedContent.length - 200))}`);
                }

                // ✅ Логируем полный content для диагностики
                console.log(`📝 Content length: ${content.length} chars`);
                console.log(`📝 Content start (first 300): ${content.substring(0, 300)}`);
                console.log(`📝 Content end (last 300): ${content.substring(Math.max(0, content.length - 300))}`);
            }

            console.log(`📊 Usage: ${JSON.stringify(data.usage || {}, null, 2)}`);
            console.log(`📝 Response length: ${JSON.stringify(data).length} chars`);
            console.log(`🎯 Model used: ${data.model || 'Unknown'}`);
            console.log(`📄 Choices count: ${data.choices?.length || 0}`);

            // ✅ ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ СТРУКТУРЫ ОТВЕТА
            console.log(`🔍 Response structure analysis:`);
            console.log(`  - has_choices: ${!!data.choices}`);
            console.log(`  - choices_length: ${data.choices?.length || 0}`);
            if (data.choices && data.choices.length > 0) {
                console.log(`  - choice[0] keys: ${Object.keys(data.choices[0] || {}).join(', ')}`);
                console.log(`  - finish_reason: ${data.choices[0]?.finish_reason || 'N/A'}`);
                console.log(`  - has_message: ${!!data.choices[0]?.message}`);
                if (data.choices[0]?.message) {
                    console.log(`  - message keys: ${Object.keys(data.choices[0].message || {}).join(', ')}`);
                    console.log(`  - has_content: ${!!data.choices[0]?.message?.content}`);
                    console.log(`  - content_type: ${typeof data.choices[0]?.message?.content}`);
                    console.log(`  - content_length: ${data.choices[0]?.message?.content?.length || 0}`);
                    console.log(`  - has_tool_calls: ${!!data.choices[0]?.message?.tool_calls}`);
                    console.log(`  - tool_calls_count: ${data.choices[0]?.message?.tool_calls?.length || 0}`);
                    // ✅ НОВОЕ: Логируем полную структуру message для диагностики
                    if (!data.choices[0]?.message?.content && !data.choices[0]?.message?.tool_calls) {
                        console.log(`  ⚠️  ПРОБЛЕМА: message пустой, но completion_tokens > 0`);
                        console.log(`  📋 Полная структура message: ${JSON.stringify(data.choices[0]?.message, null, 2)}`);
                        console.log(`  📋 Полная структура choice[0]: ${JSON.stringify(data.choices[0], null, 2)}`);
                        // ✅ НОВОЕ: Проверяем альтернативные форматы ответа
                        if (data.choices[0]?.delta) {
                            console.log(`  🔍 Найден delta: ${JSON.stringify(data.choices[0].delta, null, 2)}`);
                        }
                        if (data.choices[0]?.text) {
                            console.log(`  🔍 Найден text: ${data.choices[0].text}`);
                        }
                        if (data.content) {
                            console.log(`  🔍 Найден content в корне: ${data.content}`);
                        }
                    }
                }
            }

            // ✅ НОВОЕ: Проверяем, может быть ответ в streaming формате
            if (data.choices?.[0]?.delta) {
                console.log(`⚠️  Обнаружен streaming формат (delta), но мы ожидаем обычный формат`);
                console.log(`📋 Delta структура: ${JSON.stringify(data.choices[0].delta, null, 2)}`);
            }

            // Если есть tool_calls - логируем их детально
            if (data.choices?.[0]?.message?.tool_calls) {
                console.log(`🛠️ Tool calls details:`);
                data.choices[0].message.tool_calls.forEach((tc, i) => {
                    console.log(`  Tool ${i + 1}: ${tc.function?.name} (args: ${tc.function?.arguments?.length || 0} chars)`);
                });
            }

            // Если content пустой но есть tool_calls - это НОРМАЛЬНО для Cloud.ru
            if (!content && data.choices?.[0]?.message?.tool_calls) {
                console.log(`ℹ️ Content пустой, но есть tool_calls - это ожидаемое поведение для Cloud.ru`);
            }

            // Проверяем и исправляем неполный markdown ответ
            console.log(`📝 Raw content: "${content}"`);

            if (content === '```' || (content.startsWith('```') && !content.includes('```', 3))) {
                console.log(`⚠️  [cloudru] Detected incomplete markdown response, attempting to fix...`);

                // Пытаемся получить полный ответ с увеличенными параметрами
                try {
                    const retryResponse = await fetchWithTimeout(`${CLOUDRU_BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            ...requestBody,
                            max_completion_tokens: Math.min(max_tokens * 2, 32000), // Увеличиваем лимит
                            temperature: Math.min(temperature + 0.1, 0.5) // Немного повышаем температуру
                        }),
                        agent: getAgentForUrl(`${CLOUDRU_BASE_URL}/chat/completions`)
                    });

                    if (retryResponse.ok) {
                        const retryData = await retryResponse.json();
                        const retryContent = retryData.choices?.[0]?.message?.content || '';
                        console.log(`🔄 [cloudru] Retry content: "${retryContent.slice(0, 200)}..."`);

                        if (retryContent && retryContent !== '```' && retryContent.length > content.length) {
                            console.log(`✅ [cloudru] Retry successful, using retry response`);
                            data.choices[0].message.content = retryContent;
                            data.usage = retryData.usage;
                        } else {
                            console.log(`⚠️  [cloudru] Retry also returned incomplete response, using original`);
                        }
                    }
                } catch (retryError) {
                    console.log(`❌ [cloudru] Retry failed: ${retryError.message}`);
                }
            }

            if (data.choices?.[0]?.message?.content) {
                const finalContent = data.choices[0].message.content;
                console.log(`📝 Final content preview: ${finalContent.slice(0, 200)}${finalContent.length > 200 ? '...' : ''}`);
            }
            console.log(`${'='.repeat(60)}\n`);

            return data;

        } catch (error) {
            console.log(`\n💥 CLOUD.RU EXCEPTION`);
            console.log(`${'='.repeat(60)}`);
            console.log(`🚨 Error type: ${error.constructor.name}`);
            console.log(`📝 Error message: ${error.message}`);
            console.log(`🔄 Attempt: ${attempt}/${MAX_ATTEMPTS}`);
            console.log(`📊 Rate retries: ${rateRetries}/${MAX_RATE_LIMIT_RETRIES}`);
            console.log(`🔍 Error code: ${error.code || 'N/A'}`);
            console.log(`🌐 Endpoint: ${endpoint}`);
            console.log(`📋 Model: ${model}`);
            if (error.stack) {
                console.log(`📚 Stack trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
            }
            console.log(`${'='.repeat(60)}\n`);

            if (attempt === MAX_ATTEMPTS) {
                console.log(`❌ [cloudru] All attempts exhausted - throwing error`);
                throw error;
            }

            // Targeted retry for transient network errors
            if (isTransientNetworkError(error)) {
                if (fastFailOnNetwork) {
                    console.log(`⛔ [cloudru] Fast-fail on transient network error → bubble up to switch model/provider`);
                    const err = new Error(`network-fast-fail: ${error.message}`);
                    err.code = 'NETWORK_FAST_FAIL';
                    throw err;
                }
                const waitMs = 500 * attempt; // short backoff for network glitches
                console.log(`⏳ [cloudru] Transient network error detected, waiting ${waitMs}ms before retry...`);
                await sleep(waitMs);
                forceFresh = true; // next attempt without keep-alive
                continue;
            }

            // Wait before retry for other errors
            const waitMs = BASE_RETRY_MS * Math.pow(2, attempt - 1);
            console.log(`⏳ [cloudru] Waiting ${waitMs}ms before retry...`);
            await sleep(waitMs);
        }
    }

    console.log(`❌ [cloudru] All attempts failed - this should not be reached`);
    throw new Error('Cloud.ru API: All attempts failed');
}

/**
 * Universal function that tries Cloud.ru first, then falls back to OpenRouter
 * @param {string} url - OpenRouter URL (for fallback)
 * @param {Array} messages - Array of {role, content} messages  
 * @param {string} openRouterApiKey - OpenRouter API key (for fallback)
 * @param {Object} opts - Options
 * @returns {Promise<Object>} - API response
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

    console.log(`\n🔄 HYBRID API CALL START`);
    console.log(`${'=' * 80}`);
    console.log(`🎯 Strategy: Cloud.ru first, then OpenRouter fallback`);
    console.log(`📋 Cloud.ru models to try: ${Array.isArray(models) ? models.join(', ') : '—'}`);
    console.log(`🌡️  Temperature: ${typeof temperature === 'number' ? temperature : '—'}`);
    console.log(`🔢 Max tokens: ${typeof max_tokens === 'number' ? max_tokens : '—'}`);
    console.log(`📝 Messages count: ${Array.isArray(messages) ? messages.length : 0}`);
    console.log(`${'=' * 80}\n`);

    // Try Cloud.ru models first with overall timeout budget
    const deadline = Date.now() + cloudFirstTimeoutMs;
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        try {
            console.log(`\n🚀 [hybrid] Trying Cloud.ru model ${i + 1}/${models.length}: ${model}`);

            // ✅ Убрано двойное экранирование (уже делается внутри callCloudRuAPI)
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

            console.log(`\n✅ [hybrid] Cloud.ru SUCCESS with model: ${model}`);
            // Sanity check: if tool_call args are broken or content is empty, do fallback
            const rawMsg = result?.choices?.[0]?.message || {};
            const hasTool = Array.isArray(rawMsg.tool_calls) && rawMsg.tool_calls.length > 0;
            const contentStr = String(rawMsg.content || '').trim();
            if (!hasTool && !contentStr) {
                console.log(`⚠️  [hybrid] Cloud.ru returned empty content and no tool_call → using OpenRouter fallback`);
                throw new Error('cloudru-empty');
            }
            console.log(`🎉 Returning Cloud.ru result, skipping OpenRouter fallback`);
            return result;

        } catch (error) {
            console.log(`\n❌ [hybrid] Cloud.ru model ${model} FAILED`);
            console.log(`📝 Error: ${error.message}`);

            // If it's a rate limit/server/network fast-fail, try next model/provider
            if (
                error.message.includes('rate limit') ||
                error.message.includes('server error') ||
                error.message.includes('cloudru-empty') ||
                error.code === 'NETWORK_FAST_FAIL'
            ) {
                console.log(`🔄 [hybrid] Rate limit/server error - trying next Cloud.ru model`);
                if (Date.now() > deadline) {
                    console.log(`⏳ [hybrid] Cloud-first timeout budget exceeded (${cloudFirstTimeoutMs}ms). Falling back to OpenRouter.`);
                    break;
                }
                continue;
            }

            // For other errors (like invalid API key), fall back to OpenRouter immediately
            console.log(`🚨 [hybrid] Non-retryable error - falling back to OpenRouter immediately`);
            console.log(`📝 Error details: ${error.message}`);
            console.log(`🔍 Error type: ${error.constructor.name}`);
            if (error.code) console.log(`🔍 Error code: ${error.code}`);
            break;
        }
    }

    // Fall back to OpenRouter
    console.log(`\n🔄 [hybrid] All Cloud.ru models failed, falling back to OpenRouter`);
    console.log(`📋 OpenRouter fallback models: ${config.fallbackModels.join(', ')}`);
    console.log(`🔗 OpenRouter URL: ${url}`);

    // Import OpenRouter function dynamically to avoid circular dependencies
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

        console.log(`\n✅ [hybrid] OpenRouter fallback SUCCESS`);
        return result;

    } catch (error) {
        console.log(`\n❌ [hybrid] OpenRouter fallback also FAILED`);
        console.log(`📝 Final error: ${error.message}`);
        throw error;
    }
}

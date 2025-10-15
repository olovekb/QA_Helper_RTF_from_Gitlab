// cloudruClient.mjs
import fetch from 'node-fetch';
import https from 'https';
import config from './config.json' assert { type: 'json' };

/**
 * Cloud.ru Foundation Models API client
 * Compatible with OpenAI API format but uses Cloud.ru endpoints
 */

const CLOUDRU_BASE_URL = 'https://foundation-models.api.cloud.ru/v1';
const API_TOKEN = config.cloudruApiKey;
const DEFAULT_MODEL = 'Qwen/Qwen3-Coder-480B-A35B-Instruct';

// Retry configuration
const MAX_ATTEMPTS = 5;
const BASE_RETRY_MS = 1000;
const REQUEST_TIMEOUT_MS = 500000; // 60s per request timeout

// Keep-alive HTTPS agent to avoid "socket hang up" on reused connections
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

// Fresh (non-keepalive) agent for one-off retries
function getFreshAgent(url) {
    return url.startsWith('https') ? new https.Agent({ keepAlive: false, maxSockets: 1, timeout: 65000 }) : undefined;
}

/**
 * Обработка больших запросов через разделение на чанки
 * @param {Array} messages - Исходные сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Объединенный результат
 */
async function processLargeRequest(messages, opts) {
    const { model, temperature, max_tokens, response_format } = opts;
    
    // Находим самое большое сообщение (обычно user content)
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
    
    console.log(`\n🔪 [cloudru] Splitting message ${largestIndex} (${maxSize} chars) into chunks...`);
    
    // Разбиваем большое сообщение на чанки
    const content = largestMessage.content;
    const chunkSize = 150000; // Размер чанка в символах (примерно 37,500 токенов)
    const chunks = [];
    
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    
    console.log(`📦 [cloudru] Created ${chunks.length} chunks`);
    
    // Обрабатываем каждый чанк
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`\n🔄 [cloudru] Processing chunk ${i + 1}/${chunks.length}...`);
        
        // Создаем копию сообщений с текущим чанком
        const chunkMessages = [...messages];
        chunkMessages[largestIndex] = {
            ...largestMessage,
            content: chunks[i]
        };
        
        // Добавляем инструкцию для чанка
        if (chunks.length > 1) {
            chunkMessages[largestIndex].content = `ЧАСТЬ ${i + 1} ИЗ ${chunks.length}:\n\n${chunks[i]}`;
        }
        
        try {
            // Прямой вызов API без рекурсии
            const chunkResult = await makeDirectAPICall(chunkMessages, {
                model,
                temperature,
                max_tokens: Math.min(max_tokens, 8000), // Ограничиваем размер ответа
                response_format
            });
            
            results.push(chunkResult.choices?.[0]?.message?.content || '');
            console.log(`✅ [cloudru] Chunk ${i + 1} processed successfully`);
            
        } catch (error) {
            console.error(`❌ [cloudru] Chunk ${i + 1} failed:`, error.message);
            results.push(''); // Добавляем пустую строку для неудачного чанка
        }
    }
    
    // Объединяем результаты
    const combinedContent = results.filter(r => r.trim()).join('\n\n');
    
    console.log(`\n🔗 [cloudru] Combined ${results.length} chunks into final result (${combinedContent.length} chars)`);
    
    // Возвращаем результат в формате, ожидаемом вызывающим кодом
    return {
        choices: [{
            message: {
                content: combinedContent
            }
        }],
        usage: {
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil(combinedContent.length / 4),
            total_tokens: Math.ceil((JSON.stringify(messages).length + combinedContent.length) / 4)
        },
        model: model
    };
}
const MAX_RATE_LIMIT_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with timeout helper
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
        tool_choice = null
    } = opts;

    // === ПРОВЕРКА API КЛЮЧА ===
    if (!API_TOKEN || API_TOKEN === 'YOUR_CLOUDRU_API_KEY_HERE') {
        console.log(`\n❌ CLOUD.RU API KEY NOT CONFIGURED`);
        console.log(`${'='*60}`);
        console.log(`🚨 API Key: ${API_TOKEN || 'NOT SET'}`);
        console.log(`📝 Please set your Cloud.ru API key in config.json`);
        console.log(`🔗 Get your key at: https://foundation-models.api.cloud.ru`);
        console.log(`${'='*60}\n`);
        throw new Error('Cloud.ru API key not configured. Please set cloudruApiKey in config.json');
    }

    // === ДИАГНОСТИКА API КЛЮЧА ===
    console.log(`\n🔍 CLOUD.RU API KEY DIAGNOSTICS`);
    console.log(`${'='*60}`);
    console.log(`🔑 API Key format: ${API_TOKEN.slice(0, 20)}...${API_TOKEN.slice(-10)}`);
    console.log(`📏 API Key length: ${API_TOKEN.length} characters`);
    console.log(`🎯 Expected format: UUID-like string (e.g., MGQyOTVlZDYtNDI4Ni00M2Y2LWFkMzItM2NkZWE2ZThlZjAz.8a08cf2f0146293a2ee01df32726d9e7)`);
    console.log(`✅ Key looks valid: ${API_TOKEN.includes('.') && API_TOKEN.length > 50 ? 'YES' : 'NO'}`);
    console.log(`${'='*60}\n`);

    // === ПРОВЕРКА РАЗМЕРА ЗАПРОСА ===
    const requestSize = JSON.stringify(messages).length;
    const estimatedTokens = Math.ceil(requestSize / 4); // Примерная оценка: 1 токен ≈ 4 символа
    const MAX_TOKENS_CLOUDRU = 200000; // Оставляем запас от лимита 262144
    
    console.log(`\n${'='*80}`);
    console.log(`🚀 CLOUD.RU API CALL START`);
    console.log(`${'='*80}`);
    console.log(`📋 Model: ${model}`);
    console.log(`🌡️  Temperature: ${temperature}`);
    console.log(`🔢 Max tokens: ${max_tokens}`);
    console.log(`📝 Messages count: ${messages.length}`);
    console.log(`📏 Request size: ${requestSize} chars`);
    console.log(`🔢 Estimated tokens: ${estimatedTokens}`);
    console.log(`⚠️  Token limit: ${MAX_TOKENS_CLOUDRU}`);
    console.log(`🔑 API Key: ${API_TOKEN.slice(0, 8)}...${API_TOKEN.slice(-4)}`);
    console.log(`🌐 Base URL: ${CLOUDRU_BASE_URL}`);
    
    // Если запрос слишком большой - разбиваем на чанки
    if (estimatedTokens > MAX_TOKENS_CLOUDRU) {
        console.log(`\n⚠️  [cloudru] Request too large (${estimatedTokens} tokens > ${MAX_TOKENS_CLOUDRU}), splitting into chunks...`);
        return await processLargeRequest(messages, opts);
    }
    
    // Логируем первые несколько сообщений для контекста
    messages.slice(0, 2).forEach((msg, i) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        console.log(`📄 Message ${i + 1} (${msg.role}): ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`);
    });
    if (messages.length > 2) {
        console.log(`📄 ... and ${messages.length - 2} more messages`);
    }
    console.log(`${'='*80}\n`);

    // === ТЕСТОВЫЙ ЗАПРОС ДЛЯ ПРОВЕРКИ API ===
    console.log(`\n🧪 TESTING CLOUD.RU API CONNECTIVITY`);
    console.log(`${'='*60}`);
    try {
        const testResponse = await fetch(`${CLOUDRU_BASE_URL}/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
            },
            // @ts-ignore node-fetch v2 supports agent option
            agent: getAgentForUrl(`${CLOUDRU_BASE_URL}/models`)
        });
        console.log(`📡 Test request status: ${testResponse.status} ${testResponse.statusText}`);
        if (testResponse.ok) {
            const testData = await testResponse.json();
            console.log(`✅ Cloud.ru API is accessible`);
            console.log(`📋 Available models: ${testData.data?.length || 0} models`);
        } else {
            const errorText = await testResponse.text();
            console.log(`❌ Cloud.ru API test failed: ${errorText}`);
        }
    } catch (testError) {
        console.log(`💥 Cloud.ru API test error: ${testError.message}`);
    }
    console.log(`${'='*60}\n`);

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

    // Add optional parameters
    if (response_format) {
        requestBody.response_format = response_format;
        console.log(`🔧 Response format: ${JSON.stringify(response_format, null, 2)}`);
    }
    if (tools) {
        requestBody.tools = tools;
        console.log(`🛠️  Tools: ${tools.length} tool(s)`);
    }
    if (tool_choice) {
        requestBody.tool_choice = tool_choice;
        console.log(`🎯 Tool choice: ${JSON.stringify(tool_choice)}`);
    }

    let rateRetries = 0;
    let forceFresh = false;
    const endpoint = `${CLOUDRU_BASE_URL}/chat/completions`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            console.log(`\n🔄 [cloudru] ATTEMPT ${attempt}/${MAX_ATTEMPTS}`);
            console.log(`📤 Request body size: ${JSON.stringify(requestBody).length} chars`);
            console.log(`📤 Sending to: ${endpoint}`);
            const callHeaders = { ...headers };
            const agent = forceFresh ? getFreshAgent(endpoint) : getAgentForUrl(endpoint);
            if (forceFresh) callHeaders['Connection'] = 'close';

            const response = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: callHeaders,
                body: JSON.stringify(requestBody),
                agent
            });

            console.log(`📥 Response status: ${response.status} ${response.statusText}`);
            console.log(`📥 Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                
                console.log(`\n❌ CLOUD.RU API ERROR`);
                console.log(`${'='*60}`);
                console.log(`🚨 Status: ${response.status} ${response.statusText}`);
                console.log(`🔗 URL: ${CLOUDRU_BASE_URL}/chat/completions`);
                console.log(`📝 Error response: ${errorText}`);
                console.log(`⏰ Retry-After: ${response.headers.get('retry-after') || 'Not set'}`);
                console.log(`🔄 Attempt: ${attempt}/${MAX_ATTEMPTS}`);
                console.log(`📊 Rate retries: ${rateRetries}/${MAX_RATE_LIMIT_RETRIES}`);
                console.log(`${'='*60}\n`);

                // Handle rate limiting
                if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : BASE_RETRY_MS * attempt;
                    
                    console.log(`⏳ [cloudru] 429 rate limit detected`);
                    console.log(`⏳ Waiting ${Math.round(waitMs / 1000)}s before retry...`);
                    await sleep(waitMs);
                    rateRetries++;
                    
                    if (rateRetries > MAX_RATE_LIMIT_RETRIES) {
                        console.log(`❌ [cloudru] Rate limit retries exceeded (${MAX_RATE_LIMIT_RETRIES})`);
                        throw new Error(`Cloud.ru rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES} retries`);
                    }
                    attempt--; // Don't count this as an attempt
                    continue;
                }

                // Handle other HTTP errors
                if (response.status >= 500) {
                    // Server error - retry with backoff
                    const waitMs = BASE_RETRY_MS * Math.pow(2, attempt - 1);
                    console.log(`🔄 [cloudru] ${response.status} server error - retrying in ${waitMs}ms`);
                    await sleep(waitMs);
                    continue;
                }

                // Client error - don't retry
                console.log(`❌ [cloudru] Client error ${response.status} - not retrying`);
                throw new Error(`Cloud.ru API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            
            console.log(`\n✅ CLOUD.RU API SUCCESS`);
            console.log(`${'='*60}`);
            console.log(`📊 Usage: ${JSON.stringify(data.usage || {}, null, 2)}`);
            console.log(`📝 Response length: ${JSON.stringify(data).length} chars`);
            console.log(`🎯 Model used: ${data.model || 'Unknown'}`);
            console.log(`📄 Choices count: ${data.choices?.length || 0}`);
            
            // Проверяем и исправляем неполный markdown ответ
            const content = data.choices?.[0]?.message?.content || '';
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
            console.log(`${'='*60}\n`);
            
            return data;

        } catch (error) {
            console.log(`\n💥 CLOUD.RU EXCEPTION`);
            console.log(`${'='*60}`);
            console.log(`🚨 Error type: ${error.constructor.name}`);
            console.log(`📝 Error message: ${error.message}`);
            console.log(`🔄 Attempt: ${attempt}/${MAX_ATTEMPTS}`);
            console.log(`📊 Rate retries: ${rateRetries}/${MAX_RATE_LIMIT_RETRIES}`);
            if (error.stack) {
                console.log(`📚 Stack trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
            }
            console.log(`${'='*60}\n`);
            
            if (attempt === MAX_ATTEMPTS) {
                console.log(`❌ [cloudru] All attempts exhausted - throwing error`);
                throw error;
            }
            
            // Targeted retry for transient network errors
            if (isTransientNetworkError(error)) {
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
        logRateLimit = true
    } = opts;

    console.log(`\n🔄 HYBRID API CALL START`);
    console.log(`${'='*80}`);
    console.log(`🎯 Strategy: Cloud.ru first, then OpenRouter fallback`);
    console.log(`📋 Cloud.ru models to try: ${models.join(', ')}`);
    console.log(`🌡️  Temperature: ${temperature}`);
    console.log(`🔢 Max tokens: ${max_tokens}`);
    console.log(`📝 Messages count: ${messages.length}`);
    console.log(`${'='*80}\n`);

    // Try Cloud.ru models first
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        try {
            console.log(`\n🚀 [hybrid] Trying Cloud.ru model ${i + 1}/${models.length}: ${model}`);
            
            const result = await callCloudRuAPI(messages, {
                model,
                temperature,
                max_tokens,
                response_format,
                tools,
                tool_choice
            });

            console.log(`\n✅ [hybrid] Cloud.ru SUCCESS with model: ${model}`);
            console.log(`🎉 Returning Cloud.ru result, skipping OpenRouter fallback`);
            return result;

        } catch (error) {
            console.log(`\n❌ [hybrid] Cloud.ru model ${model} FAILED`);
            console.log(`📝 Error: ${error.message}`);
            
            // If it's a rate limit or server error, try next model
            if (error.message.includes('rate limit') || error.message.includes('server error')) {
                console.log(`🔄 [hybrid] Rate limit/server error - trying next Cloud.ru model`);
                continue;
            }
            
            // For other errors (like invalid API key), fall back to OpenRouter immediately
            console.log(`🚨 [hybrid] Non-retryable error - falling back to OpenRouter immediately`);
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

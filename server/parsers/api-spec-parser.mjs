/**
 * API Specification Parser
 * Извлекает API спецификацию из текста требований
 * Это единственный источник правды для валидации Codes в тестовой модели
 */

/**
 * Парсит требования и извлекает API спецификацию
 * @param {string} requirements - Текст требований
 * @returns {object} API Specification
 */
export function parseAPISpecification(requirements) {
    const spec = {
        endpoints: [],
        entities: {},
        errors: []
    };

    try {
        // ═══════════════════════════════════════════════════════════════
        // ИЗВЛЕЧЕНИЕ API СЕКЦИИ
        // ═══════════════════════════════════════════════════════════════
        
        const apiSectionMatch = requirements.match(/(?:^|\n)(3\.|##)\s*API[\s\S]*?(?=\n(?:\d+\.|##)\s+|$)/i);
        
        if (!apiSectionMatch) {
            spec.errors.push('API секция не найдена в требованиях');
            return spec;
        }

        const apiSection = apiSectionMatch[0];
        console.log('[parseAPISpecification] Найдена API секция длиной:', apiSection.length);

        // ═══════════════════════════════════════════════════════════════
        // ПАРСИНГ ЭНДПОИНТОВ
        // ═══════════════════════════════════════════════════════════════
        
        // Формат 1: Structured (с отдельными строками)
        // 3.1. Получение списка категорий
        // - Метод: GET
        // - URL: /api/v1/images/categories
        // - Ответ (200 OK): [{"id": 1, "name": "..."}]
        
        const structuredPattern = /(?:^|\n)\d+\.\d+\.?\s*([^\n]+)\n([\s\S]*?)(?=\n\d+\.\d+\.?|\n\d+\.|$)/gi;
        let match;
        
        while ((match = structuredPattern.exec(apiSection)) !== null) {
            const endpoint = parseStructuredEndpoint(match[1], match[2]);
            if (endpoint) {
                spec.endpoints.push(endpoint);
            }
        }

        // Формат 2: Inline (компактный)
        // GET /api/v1/images/categories → 200 OK: [...]
        const inlinePattern = /(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s→\n]+)\s*(?:→|->|:)?\s*(\d{3})?\s*(?:OK|Bad Request|Not Found)?:?\s*({[\s\S]*?}|\[[\s\S]*?\])?/gi;
        
        while ((match = inlinePattern.exec(apiSection)) !== null) {
            const endpoint = {
                method: match[1],
                url: match[2],
                statusCode: match[3] || '200',
                response: parseJSON(match[4]),
                parameters: extractParametersFromURL(match[2]),
                description: ''
            };
            
            // Проверяем, не добавлен ли уже этот эндпоинт
            const exists = spec.endpoints.some(e => 
                e.method === endpoint.method && e.url === endpoint.url
            );
            
            if (!exists) {
                spec.endpoints.push(endpoint);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // ИЗВЛЕЧЕНИЕ СУЩНОСТЕЙ (ENTITIES)
        // ═══════════════════════════════════════════════════════════════
        
        for (const endpoint of spec.endpoints) {
            if (endpoint.response && typeof endpoint.response === 'object') {
                extractEntities(endpoint.response, spec.entities, endpoint.url);
            }
        }

        console.log(`[parseAPISpecification] Извлечено эндпоинтов: ${spec.endpoints.length}`);
        console.log(`[parseAPISpecification] Извлечено сущностей: ${Object.keys(spec.entities).length}`);
        
    } catch (error) {
        console.error('[parseAPISpecification] Ошибка парсинга:', error);
        spec.errors.push(`Ошибка парсинга: ${error.message}`);
    }

    return spec;
}

/**
 * Парсит структурированное описание эндпоинта
 */
function parseStructuredEndpoint(title, body) {
    try {
        const endpoint = {
            description: title.trim(),
            method: null,
            url: null,
            parameters: [],
            responses: [],
            request: null
        };

        // Извлекаем метод
        const methodMatch = body.match(/-\s*Метод:\s*(GET|POST|PUT|DELETE|PATCH)/i);
        if (methodMatch) {
            endpoint.method = methodMatch[1].toUpperCase();
        }

        // Извлекаем URL
        const urlMatch = body.match(/-\s*URL:\s*(\/[^\n]+)/i);
        if (urlMatch) {
            endpoint.url = urlMatch[1].trim();
            endpoint.parameters = extractParametersFromURL(endpoint.url);
        }

        // Извлекаем параметры
        const paramsMatch = body.match(/-\s*Параметры:([^\n]+)/i);
        if (paramsMatch) {
            const paramsText = paramsMatch[1];
            // Парсим параметры вида: file (binary), categoryId (number)
            const paramPattern = /(\w+)\s*\(([^)]+)\)/g;
            let paramMatch;
            while ((paramMatch = paramPattern.exec(paramsText)) !== null) {
                endpoint.parameters.push({
                    name: paramMatch[1],
                    type: paramMatch[2].trim(),
                    required: true
                });
            }
        }

        // Извлекаем ответы
        const responsePattern = /-\s*Ответ\s*\((\d{3})[^)]*\):\s*({[\s\S]*?}|\[[\s\S]*?\]|"[^"]+"|[^\n]+)/gi;
        let responseMatch;
        
        while ((responseMatch = responsePattern.exec(body)) !== null) {
            endpoint.responses.push({
                statusCode: responseMatch[1],
                body: parseJSON(responseMatch[2])
            });
        }

        // Если нет метода или URL - пропускаем
        if (!endpoint.method || !endpoint.url) {
            return null;
        }

        return endpoint;
        
    } catch (error) {
        console.warn('[parseStructuredEndpoint] Ошибка:', error.message);
        return null;
    }
}

/**
 * Извлекает параметры из URL (path parameters)
 */
function extractParametersFromURL(url) {
    const params = [];
    const pathParamPattern = /{([^}]+)}/g;
    let match;
    
    while ((match = pathParamPattern.exec(url)) !== null) {
        params.push({
            name: match[1],
            type: 'path',
            required: true
        });
    }
    
    return params;
}

/**
 * Безопасный парсинг JSON
 */
function parseJSON(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    
    try {
        // Очищаем текст от лишних пробелов и переносов
        const cleaned = text.trim();
        
        // Пробуем распарсить как JSON
        return JSON.parse(cleaned);
    } catch (e) {
        // Если не JSON, возвращаем как есть
        return text.trim();
    }
}

/**
 * Извлекает сущности из JSON структуры
 */
function extractEntities(obj, entities, context = '') {
    if (!obj || typeof obj !== 'object') {
        return;
    }

    if (Array.isArray(obj) && obj.length > 0) {
        // Если массив, анализируем первый элемент
        extractEntities(obj[0], entities, context);
        return;
    }

    // Определяем имя сущности по контексту
    const entityName = guessEntityName(context, obj);
    
    if (entityName && !entities[entityName]) {
        entities[entityName] = {
            name: entityName,
            fields: Object.keys(obj),
            example: obj
        };
    }

    // Рекурсивно обходим вложенные объекты
    for (const value of Object.values(obj)) {
        if (typeof value === 'object') {
            extractEntities(value, entities, context);
        }
    }
}

/**
 * Угадывает имя сущности по контексту URL
 */
function guessEntityName(url, obj) {
    // Извлекаем имя из URL
    const urlParts = url.split('/').filter(p => p && !p.startsWith('{'));
    const lastPart = urlParts[urlParts.length - 1];
    
    if (lastPart) {
        // Приводим к единственному числу (categories → category)
        return lastPart.replace(/ies$/, 'y').replace(/s$/, '');
    }

    // Если URL не помог, пробуем угадать по полям
    if (obj.id && obj.name) {
        return 'entity';
    }
    
    return null;
}

// ═══════════════════════════════════════════════════════════════
// ВАЛИДАЦИЯ КОДА ПРОТИВ API SPEC
// ═══════════════════════════════════════════════════════════════

/**
 * Валидирует Code из тестовой модели против API спецификации
 * @param {string} codeText - Текст Code
 * @param {object} apiSpec - API спецификация
 * @param {object} [logicConstraints] - Извлеченные ограничения логики (из logic-extractor)
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateCodeAgainstAPISpec(codeText, apiSpec, logicConstraints = null) {
    const result = {
        valid: true,
        errors: [],
        warnings: []
    };

    // Извлекаем HTTP метод и URL из Code
    const httpPattern = /(GET|POST|PUT|DELETE|PATCH)\s+\*\*([^*]+)\*\*/;
    const match = codeText.match(httpPattern);
    
    if (!match) {
        // Это не HTTP запрос, пропускаем
        return result;
    }

    const method = match[1];
    const url = match[2].trim();
    
    // Ищем эндпоинт в спецификации
    const endpoint = findEndpoint(apiSpec.endpoints, method, url);
    
    if (!endpoint) {
        result.valid = false;
        result.errors.push(
            `API эндпоинт ${method} ${url} НЕ найден в требованиях! Это выдумка LLM!`
        );
        return result;
    }

    // Проверяем параметры
    if (endpoint.parameters && endpoint.parameters.length > 0) {
        const requiredParams = endpoint.parameters.filter(p => p.required);
        for (const param of requiredParams) {
            if (!codeText.includes(param.name)) {
                result.warnings.push(
                    `Параметр "${param.name}" (${param.type}) должен быть указан для ${method} ${url}`
                );
            }
        }
    }

    // ✅ НОВОЕ: Валидация параметров против ограничений логики
    if (logicConstraints) {
        // Проверяем граничные значения в параметрах
        if (logicConstraints.boundary_values && logicConstraints.boundary_values.length > 0) {
            for (const bv of logicConstraints.boundary_values) {
                // Ищем упоминание поля в codeText
                if (codeText.toLowerCase().includes(bv.field.toLowerCase())) {
                    // Проверяем, что значения соответствуют ограничениям
                    if (bv.type === 'number' && bv.min !== undefined && bv.max !== undefined) {
                        // Ищем числовые значения в тексте
                        const numberPattern = /(\d+(?:\.\d+)?)/g;
                        const numbers = codeText.match(numberPattern);
                        if (numbers) {
                            for (const numStr of numbers) {
                                const num = parseFloat(numStr);
                                if (num < parseFloat(bv.min) || num > parseFloat(bv.max)) {
                                    result.warnings.push(
                                        `Значение ${num} для поля "${bv.field}" выходит за границы (${bv.min} - ${bv.max})`
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        // Проверяем валидации
        if (logicConstraints.validations && logicConstraints.validations.length > 0) {
            for (const validation of logicConstraints.validations) {
                if (codeText.toLowerCase().includes(validation.field.toLowerCase())) {
                    // Если в коде упоминается поле с валидацией, проверяем соответствие
                    if (validation.rule && !codeText.includes(validation.rule)) {
                        result.warnings.push(
                            `Поле "${validation.field}" имеет правило валидации "${validation.rule}", но оно не упомянуто в коде`
                        );
                    }
                }
            }
        }
    }

    // Проверяем JSON структуру в ответе
    if (codeText.includes('Возвращается')) {
        const responseMatch = codeText.match(/Возвращается.*?({[\s\S]*?}|\[[\s\S]*?\])/);
        if (responseMatch && endpoint.responses && endpoint.responses.length > 0) {
            const expectedResponse = endpoint.responses[0].body;
            if (expectedResponse && typeof expectedResponse === 'object') {
                // Проверяем наличие ключевых полей
                const expectedFields = Object.keys(expectedResponse);
                const missingFields = expectedFields.filter(field => !codeText.includes(field));
                
                if (missingFields.length > 0) {
                    result.warnings.push(
                        `В ответе API пропущены поля из требований: ${missingFields.join(', ')}`
                    );
                }
            }
        }
    }

    return result;
}

/**
 * Ищет эндпоинт в спецификации (с поддержкой path parameters)
 */
function findEndpoint(endpoints, method, url) {
    // Сначала точное совпадение
    let endpoint = endpoints.find(e => e.method === method && e.url === url);
    if (endpoint) return endpoint;
    
    // Затем с учётом path parameters
    // /api/v1/images/{imageId} должен матчиться с /api/v1/images/123
    for (const e of endpoints) {
        if (e.method !== method) continue;
        
        // Преобразуем шаблон в regex
        const pattern = e.url.replace(/{[^}]+}/g, '[^/]+');
        const regex = new RegExp(`^${pattern}$`);
        
        if (regex.test(url)) {
            return e;
        }
    }
    
    return null;
}

// ═══════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ПРОМПТА С API SPEC
// ═══════════════════════════════════════════════════════════════

/**
 * Генерирует секцию промпта с API спецификацией
 * @param {object} apiSpec - API спецификация
 * @returns {string} Formatted API spec for prompt
 */
export function formatAPISpecForPrompt(apiSpec) {
    if (!apiSpec || apiSpec.endpoints.length === 0) {
        return '';
    }

    let prompt = `
═══════════════════════════════════════════════════════════════
📜 API СПЕЦИФИКАЦИЯ (ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ!)
═══════════════════════════════════════════════════════════════

🚨 КРИТИЧЕСКОЕ ПРАВИЛО:
   
   ЕСЛИ ЧЕГО-ТО НЕТ В ТРЕБОВАНИЯХ → НЕ ПРИДУМЫВАЙ!
   
   ❌ НЕТ в требованиях API эндпоинта → НЕ генерируй тест на него!
   ❌ НЕТ в требованиях query-параметра → НЕ используй его!
   ❌ НЕТ в требованиях статус-кода → НЕ проверяй его!
   ❌ НЕТ в требованиях JSON поля → НЕ упоминай его!
   ❌ НЕТ в требованиях бизнес-логики → НЕ тестируй её!
   
   💀 ЛЮБАЯ ВЫДУМКА = КРИТИЧЕСКАЯ ОШИБКА!

🚨 СТРОГИЙ РЕЖИМ: ТОЛЬКО ЭТИ API! НИ ОДНОГО ЛИШНЕГО!

📋 ПОЛНЫЙ СПИСОК API (ВСЁ, ЧТО РАЗРЕШЕНО):
`;

    for (const endpoint of apiSpec.endpoints) {
        prompt += `\n${endpoint.method} **${endpoint.url}**\n`;
        
        if (endpoint.description) {
            prompt += `  📖 ${endpoint.description}\n`;
        }
        
        if (endpoint.parameters && endpoint.parameters.length > 0) {
            prompt += `  📥 Параметры: ${endpoint.parameters.map(p => `${p.name} (${p.type})`).join(', ')}\n`;
        }
        
        if (endpoint.responses && endpoint.responses.length > 0) {
            for (const resp of endpoint.responses) {
                const bodyStr = typeof resp.body === 'object' ? JSON.stringify(resp.body) : resp.body;
                prompt += `  📤 ${resp.statusCode}: ${bodyStr}\n`;
            }
        }
        
        prompt += '\n';
    }

    // Собираем все допустимые методы
    const allowedMethods = [...new Set(apiSpec.endpoints.map(e => e.method))];
    
    // Собираем все допустимые статус-коды
    const allowedStatuses = [...new Set(
        apiSpec.endpoints.flatMap(e => 
            (e.responses || []).map(r => r.statusCode)
        )
    )].sort();
    
    // Собираем все допустимые JSON поля
    const allowedFields = new Set();
    for (const endpoint of apiSpec.endpoints) {
        for (const response of endpoint.responses || []) {
            if (response.body && typeof response.body === 'object') {
                const extractFields = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (Array.isArray(obj)) {
                        obj.forEach(item => extractFields(item));
                        return;
                    }
                    Object.keys(obj).forEach(key => {
                        allowedFields.add(key);
                        extractFields(obj[key]);
                    });
                };
                extractFields(response.body);
            }
        }
    }
    
    prompt += `
🎯 ЗОЛОТОЕ ПРАВИЛО: Если чего-то НЕТ в списке выше - НЕ ИСПОЛЬЗУЙ!

📋 ДОПУСТИМЫЕ ЗНАЧЕНИЯ:
   HTTP методы: ${allowedMethods.join(', ')}
   Статус-коды: ${allowedStatuses.join(', ')}
   JSON поля: ${Array.from(allowedFields).slice(0, 20).join(', ')}${allowedFields.size > 20 ? ', ...' : ''}

💀 ЗА ВЫДУМАННЫЙ API = КРИТИЧЕСКАЯ ОШИБКА!

❌ ЗАПРЕЩЕНО:
   • Добавлять query-параметры, если они не указаны для эндпоинта
   • Использовать статус-коды, которых нет в списке
   • Добавлять JSON поля, которых нет в спецификации
   • Выдумывать новые эндпоинты
`;

    return prompt;
}

// ═══════════════════════════════════════════════════════════════
// ДИНАМИЧЕСКАЯ ВАЛИДАЦИЯ (вместо хардкода)
// ═══════════════════════════════════════════════════════════════

/**
 * Проверяет Code/Test на наличие ВЫДУМАННЫХ вещей
 * (не описанных в API спецификации)
 * 
 * ✅ УНИВЕРСАЛЬНО для любых требований!
 * 
 * @param {string} text - Текст для проверки
 * @param {object} apiSpec - API спецификация (результат parseAPISpecification)
 * @returns {{valid: boolean, errors: string[]}}
 */
export function checkAgainstAPISpec(text, apiSpec) {
    const errors = [];
    
    if (!apiSpec || !apiSpec.endpoints || apiSpec.endpoints.length === 0) {
        // Если API спецификация пуста - пропускаем проверку
        return { valid: true, errors: [] };
    }

    // ═══════════════════════════════════════════════════════════════
    // 1. ПРОВЕРКА HTTP МЕТОДОВ И ЭНДПОИНТОВ
    // ═══════════════════════════════════════════════════════════════
    
    const httpPattern = /(GET|POST|PUT|DELETE|PATCH)\s+\*\*([^*]+)\*\*/g;
    let match;
    
    while ((match = httpPattern.exec(text)) !== null) {
        const method = match[1];
        const url = match[2].trim();
        
        // Убираем query-параметры для поиска базового эндпоинта
        const baseUrl = url.split('?')[0];
        
        // Ищем эндпоинт в спецификации
        const endpoint = findEndpoint(apiSpec.endpoints, method, baseUrl);
        
        if (!endpoint) {
            errors.push(`❌ API эндпоинт ${method} ${baseUrl} НЕ найден в требованиях! Это выдумка!`);
            continue;
        }
        
        // Проверяем query-параметры
        if (url.includes('?')) {
            const queryString = url.split('?')[1];
            const queryParams = extractQueryParams(queryString);
            
            for (const qp of queryParams) {
                // Проверяем, описан ли этот query-параметр в эндпоинте
                const hasParam = endpoint.parameters?.some(p => 
                    p.name === qp && p.type === 'query'
                );
                
                if (!hasParam) {
                    errors.push(`❌ Query-параметр ?${qp}= НЕ описан для ${method} ${baseUrl} в требованиях!`);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. ПРОВЕРКА СТАТУС-КОДОВ
    // ═══════════════════════════════════════════════════════════════
    
    const statusPattern = /(\d{3})\s+(OK|No Content|Bad Request|Not Found|Created|Unauthorized|Forbidden)/gi;
    let statusMatch;
    
    while ((statusMatch = statusPattern.exec(text)) !== null) {
        const statusCode = statusMatch[1];
        
        // Проверяем, есть ли этот статус код в ЛЮБОМ эндпоинте API спеки
        const hasStatus = apiSpec.endpoints.some(ep => 
            ep.responses?.some(r => r.statusCode === statusCode)
        );
        
        if (!hasStatus) {
            errors.push(`❌ Статус ${statusCode} ${statusMatch[2]} НЕ описан ни в одном API эндпоинте требований!`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. ПРОВЕРКА JSON ПОЛЕЙ (если есть JSON в тексте)
    // ═══════════════════════════════════════════════════════════════
    
    const jsonPattern = /\{[^}]*"(\w+)":\s*[^}]*\}/g;
    let jsonMatch;
    const mentionedFields = new Set();
    
    while ((jsonMatch = jsonPattern.exec(text)) !== null) {
        // Извлекаем все поля из JSON-подобных структур
        const fieldPattern = /"(\w+)":/g;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(jsonMatch[0])) !== null) {
            mentionedFields.add(fieldMatch[1]);
        }
    }
    
    // Проверяем каждое упомянутое поле
    for (const field of mentionedFields) {
        // Ищем это поле во ВСЕХ response body из спецификации
        const hasField = apiSpec.endpoints.some(ep => 
            ep.responses?.some(r => {
                if (!r.body || typeof r.body !== 'object') return false;
                
                // Рекурсивный поиск поля в JSON
                const findField = (obj) => {
                    if (!obj || typeof obj !== 'object') return false;
                    if (Array.isArray(obj)) {
                        return obj.some(item => findField(item));
                    }
                    if (obj.hasOwnProperty(field)) return true;
                    return Object.values(obj).some(val => findField(val));
                };
                
                return findField(r.body);
            })
        );
        
        if (!hasField) {
            errors.push(`⚠️ Поле "${field}" НЕ описано ни в одном API response из требований (возможна выдумка)`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. ПРОВЕРКА БИЗНЕС-ЛОГИКИ (опционально, можно отключить)
    // ═══════════════════════════════════════════════════════════════
    
    // Проверяем упоминания тем, которых может не быть в требованиях
    // (это опционально, можно убрать если требования всегда полные)
    
    const businessPatterns = [
        { pattern: /\bправ[аы]|роле[йи]|permission|authorization|access control/i, term: 'права/роли' },
        { pattern: /\bаутентификаци|authentication|login|logout/i, term: 'аутентификация' },
        { pattern: /\bподписк[аи]|subscription/i, term: 'подписки' }
    ];
    
    for (const bp of businessPatterns) {
        if (bp.pattern.test(text)) {
            // Проверяем, упоминается ли эта тема в требованиях
            // (можно передать requirements в эту функцию, но это усложнит)
            errors.push(`⚠️ Упоминается тема "${bp.term}", которая может отсутствовать в требованиях`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Извлекает имена query-параметров из query string
 */
function extractQueryParams(queryString) {
    const params = [];
    const parts = queryString.split('&');
    
    for (const part of parts) {
        const [name] = part.split('=');
        if (name) {
            params.push(name.trim());
        }
    }
    
    return params;
}

// ═══════════════════════════════════════════════════════════════
// ОБРАТНАЯ СОВМЕСТИМОСТЬ (для кода, который использует checkBlacklist)
// ═══════════════════════════════════════════════════════════════

/**
 * @deprecated Используй checkAgainstAPISpec для динамической валидации
 */
export function checkBlacklist(text, apiSpec = null) {
    if (apiSpec) {
        return checkAgainstAPISpec(text, apiSpec);
    }
    
    // Fallback: минимальная проверка без спецификации
    return {
        valid: true,
        errors: []
    };
}


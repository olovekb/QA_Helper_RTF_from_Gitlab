import JSON5 from 'json5';

const DEFAULT_PREVIEW_LENGTH = 200;

/**
 * Создаёт реестр источников контекста, гарантируя уникальность идентификаторов и
 * единые правила нормализации содержимого.
 *
 * @param {Object} [opts]
 * @param {number} [opts.previewLength=200]
 * @returns {{ register: Function, safeTrim: Function, createPreview: Function, deriveTitleFromContent: Function, extractPageId: Function, getSources: Function, sources: Array }}
 */
export function createContextSourceRegistry(opts = {}) {
    const {
        previewLength = DEFAULT_PREVIEW_LENGTH
    } = opts || {};

    const sources = [];
    const usedIds = new Set();

    const safeTrim = (value) => (typeof value === 'string' ? value.trim() : '');

    const createPreview = (text, len = previewLength) => {
        const trimmed = safeTrim(text);
        if (!trimmed) return '';
        if (trimmed.length <= len) return trimmed;
        return `${trimmed.slice(0, len)}…`;
    };

    const deriveTitleFromContent = (text, fallbackTitle, pageIdentifier) => {
        const source = safeTrim(text);
        if (!source) return fallbackTitle || (pageIdentifier ? `Confluence page ${pageIdentifier}` : 'Неизвестный источник');

        const titleMatch = source.match(/^\s*title:\s*"([^"]+)"/im);
        if (titleMatch && titleMatch[1]) {
            const extracted = titleMatch[1].trim();
            if (extracted) return extracted;
        }

        const headingMatch = source.match(/^#{1,3}\s+(.+)$/m);
        if (headingMatch && headingMatch[1]) {
            const extracted = headingMatch[1].trim();
            if (extracted) return extracted;
        }

        const firstLine = source.split(/\r?\n/).find((line) => safeTrim(line).length > 0);
        if (firstLine && firstLine.length <= 160) {
            return firstLine.trim();
        }

        return fallbackTitle || (pageIdentifier ? `Confluence page ${pageIdentifier}` : 'Неизвестный источник');
    };

    const extractPageId = (text) => {
        const match = String(text || '').match(/pageId=(\d{4,})/);
        return match ? match[1] : null;
    };

    /**
     * Извлекает все ссылки на Confluence страницы из текста
     * @param {string} text - текст для анализа
     * @returns {Array<string>} - массив уникальных pageId
     */
    const extractAllPageIds = (text) => {
        if (!text || typeof text !== 'string') return [];
        
        const pageIdPattern = /pageId=(\d{4,})/g;
        const matches = [];
        let match;
        
        while ((match = pageIdPattern.exec(text)) !== null) {
            matches.push(match[1]);
        }
        
        // Возвращаем уникальные pageId
        return [...new Set(matches)];
    };

    const register = (rawSource = {}) => {
        if (!rawSource || rawSource.id == null) return;
        const id = String(rawSource.id);
        if (!id || usedIds.has(id)) return;

        const content = safeTrim(rawSource.content);
        const title = rawSource.title ? String(rawSource.title) : id;
        const description = rawSource.description ? String(rawSource.description) : '';
        const type = rawSource.type ? String(rawSource.type) : 'generic';
        const pageId = rawSource.pageId != null ? String(rawSource.pageId) : null;
        const loader = typeof rawSource.loader === 'function' ? rawSource.loader : null;
        const estimatedLength = Number.isFinite(rawSource.estimatedLength)
            ? Number(rawSource.estimatedLength)
            : (content ? content.length : null);
        const preview = rawSource.preview ? String(rawSource.preview) : createPreview(content);

        usedIds.add(id);
        sources.push({
            id,
            title,
            description,
            type,
            pageId,
            loader,
            content,
            preview,
            estimatedLength
        });
    };

    return {
        register,
        safeTrim,
        createPreview,
        deriveTitleFromContent,
        extractPageId,
        getSources: () => sources.slice(),
        sources
    };
}

/**
 * Создаёт инструменты для интерактивного запроса контекста у модели.
 *
 * @param {Object} options
 * @param {Array} [options.sources=[]] - список источников контента
 * @param {Function} [options.fetcher] - функция загрузки контента по pageId (async (pageId) => string)
 * @param {number} [options.defaultChunk=4000] - размер чанка по умолчанию
 * @returns {{ tools: Array, handlers: Object, summary: string }}
 */
export function createContextToolset(options = {}) {
    const {
        sources = [],
        fetcher = null,
        defaultChunk = 8000  
    } = options;

    const normalizedDefaultChunk = clamp(defaultChunk, 512, 50000); 
    const HARD_MAX_CHUNK_CHARS = 20000; 
    const MAX_CHUNKS_PER_SOURCE = 10;  

    const sourceMap = new Map();
    const contentCache = new Map();
    // ✅ Кэш для чанков (sourceId + offset + limit → chunk)
    const chunkCache = new Map();
    // ✅ Отслеживание количества запросов к каждому источнику (sourceId → count)
    const sourceRequestCounts = new Map();

    // ✅ Отслеживаем какие чанки уже были отданы (чтобы не дублировать контент)
    const deliveredChunkKeys = new Set(); // `${sourceId}_${offset}_${limit}`
    const deliveredChunksBySource = new Map(); // sourceId → [{offset, end}]

    const normalisedSources = Array.isArray(sources) ? sources : [];

    normalisedSources.forEach((rawSource, idx) => {
        if (!rawSource) return;

        const id = String(rawSource.id || `context-source-${idx + 1}`);
        const title = String(rawSource.title || `Источник ${idx + 1}`);
        const description = rawSource.description ? String(rawSource.description) : '';
        const pageId = rawSource.pageId ? String(rawSource.pageId) : null;
        const type = rawSource.type ? String(rawSource.type) : 'generic';

        sourceMap.set(id, {
            id,
            title,
            description,
            type,
            pageId,
            loader: typeof rawSource.loader === 'function' ? rawSource.loader : null,
            estimatedLength: Number.isFinite(rawSource.estimatedLength) ? Number(rawSource.estimatedLength) : null,
            preview: rawSource.preview ? String(rawSource.preview) : '',
            content: typeof rawSource.content === 'string' ? rawSource.content : (rawSource.content ? String(rawSource.content) : null)
        });
    });

    // Автоматическое извлечение и регистрация вложенных ссылок из всех источников
    if (fetcher) {
        const allPageIds = new Set();
        
        // Собираем все pageId из контента источников
        sourceMap.forEach((source) => {
            const content = source.content || '';
            const pageIdPattern = /pageId=(\d{4,})/g;
            let match;
            while ((match = pageIdPattern.exec(content)) !== null) {
                allPageIds.add(match[1]);
            }
        });
        
        // Регистрируем вложенные страницы как источники с ленивой загрузкой
        allPageIds.forEach((nestedPageId) => {
            const sourceId = `nested-page-${nestedPageId}`;
            
            // Проверяем, не зарегистрирована ли уже эта страница
            if (!sourceMap.has(sourceId)) {
                sourceMap.set(sourceId, {
                    id: sourceId,
                    title: `Вложенная страница Confluence ${nestedPageId}`,
                    description: `Автоматически обнаруженная ссылка на страницу Confluence (pageId=${nestedPageId})`,
                    type: 'confluence',
                    pageId: nestedPageId,
                    loader: null,
                    estimatedLength: null,
                    preview: `Страница Confluence ${nestedPageId}`,
                    content: null // Будет загружено лениво через fetcher
                });
            }
        });
        
        if (allPageIds.size > 0) {
            console.log(`[contextToolset] Автоматически обнаружено ${allPageIds.size} вложенных ссылок на Confluence страницы`);
        }
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(Number(value), min), max);
    }

    async function resolveContent(source) {
        if (!source) return '';

        if (contentCache.has(source.id)) {
            return contentCache.get(source.id);
        }

        let content = source.content;

        if (content == null && source.loader) {
            try {
                content = await source.loader();
            } catch (err) {
                console.warn(`[contextToolset] loader for ${source.id} failed: ${err.message}`);
                content = '';
            }
        }

        if (content == null && source.pageId && fetcher) {
            try {
                const fetched = await fetcher(source.pageId);
                content = fetched != null ? String(fetched) : '';
            } catch (err) {
                console.warn(`[contextToolset] fetcher for pageId=${source.pageId} failed: ${err.message}`);
                content = '';
            }
        }

        if (content == null) {
            content = '';
        }

        const finalContent = String(content);
        contentCache.set(source.id, finalContent);

        if (!source.estimatedLength) {
            source.estimatedLength = finalContent.length;
        }

        return finalContent;
    }

    const tools = [
        {
            type: 'function',
            function: {
                name: 'list_context_sources',
                description: 'Возвращает список доступных источников контекста с кратким описанием и идентификаторами.',
                parameters: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'fetch_context_chunk',
                description: 'Возвращает фрагмент текста из выбранного источника. Используй offset и limit для постраничного чтения.',
                parameters: {
                    type: 'object',
                    properties: {
                        sourceId: {
                            type: 'string',
                            description: 'Идентификатор источника из списка list_context_sources.'
                        },
                        offset: {
                            type: 'integer',
                            minimum: 0,
                            description: 'Смещение (в символах) от начала текста.',
                            default: 0
                        },
                        limit: {
                            type: 'integer',
                            minimum: 256,
                            maximum: 50000,  // ✅ Увеличено для больших документов
                            description: 'Максимальное количество символов в одном фрагменте (по умолчанию зависит от источника).',
                            default: normalizedDefaultChunk
                        }
                    },
                    required: ['sourceId'],
                    additionalProperties: false
                }
            }
        }
    ];

    const handlers = {
        /**
         * Возвращает список источников контекста.
         */
        list_context_sources: async () => {
            const sourcesList = Array.from(sourceMap.values()).map((source) => ({
                id: source.id,
                title: source.title,
                type: source.type,
                pageId: source.pageId,
                estimatedLength: source.estimatedLength || null,
                description: source.description || null,
                preview: source.preview || null,
                hasCachedContent: contentCache.has(source.id)
            }));

            return { sources: sourcesList };
        },

        /**
         * Возвращает чанк контента из выбранного источника.
         *
         * @param {Object} args
         * @param {string} args.sourceId
         * @param {number} [args.offset=0]
         * @param {number} [args.limit=defaultChunk]
         * @returns {Promise<Object>}
         */
        fetch_context_chunk: async (args = {}) => {
            let parsedArgs = args;

            if (typeof args === 'string') {
                try {
                    parsedArgs = JSON5.parse(args);
                } catch {
                    parsedArgs = { sourceId: args };
                }
            }

            const sourceId = parsedArgs?.sourceId ? String(parsedArgs.sourceId) : null;
            if (!sourceId) {
                return {
                    error: 'sourceId is required'
                };
            }

            const source = sourceMap.get(sourceId);
            if (!source) {
                return {
                    error: `Источник "${sourceId}" не найден`
                };
            }

            const offset = clamp(parsedArgs?.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
            const rawLimit = clamp(parsedArgs?.limit ?? normalizedDefaultChunk, 256, 50000);  // ✅ Увеличено до 50000
            const effectiveLimit = Math.min(rawLimit, HARD_MAX_CHUNK_CHARS);

            // ✅ Отслеживаем количество запросов к этому источнику
            const requestCount = (sourceRequestCounts.get(sourceId) || 0) + 1;
            sourceRequestCounts.set(sourceId, requestCount);

            const chunkKey = `${sourceId}_${offset}_${effectiveLimit}`;
            const deliveredForSource = deliveredChunksBySource.get(sourceId) || [];
            if (!deliveredChunksBySource.has(sourceId)) {
                deliveredChunksBySource.set(sourceId, deliveredForSource);
            }

            // ✅ КРИТИЧНО: Загружаем content ДО использования totalLength
            const content = await resolveContent(source);
            const totalLength = content.length;

            // ✅ Защита от зацикливания: если тот же chunk запрашивается повторно
            if (deliveredChunkKeys.has(chunkKey)) {
                console.warn(`[fetch_context_chunk] ⚠️ Повторный запрос того же chunk ${chunkKey}, возвращаю пустой ответ`);
                return buildAlreadyProvidedResponse(source, offset, totalLength, deliveredForSource);
            }

            // ✅ Ограничиваем количество уникальных чанков на источник
            if (!deliveredForSource.some(entry => entry.key === chunkKey) &&
                deliveredForSource.length >= MAX_CHUNKS_PER_SOURCE) {
                console.warn(`[fetch_context_chunk] ⚠️ Достигнут лимит чанков для ${sourceId} (${MAX_CHUNKS_PER_SOURCE}), возвращаю пустой ответ`);
                return buildLimitReachedResponse(source, offset, totalLength, deliveredForSource);
            }

            // ✅ Проверяем кэш чанков (с учётом урезанного effectiveLimit)
            const cacheKey = `${sourceId}_${offset}_${effectiveLimit}`;
            if (chunkCache.has(cacheKey)) {
                console.log(`[fetch_context_chunk] ✅ CACHE HIT для ${cacheKey}`);
                return chunkCache.get(cacheKey);
            }

            if (!totalLength) {
                const result = {
                    sourceId,
                    chunk: '',
                    hasMore: false,
                    nextOffset: 0,
                    totalLength
                };
                // ✅ Кэшируем результат
                chunkCache.set(cacheKey, result);
                return result;
            }

            if (offset >= totalLength) {
                const result = {
                    sourceId,
                    chunk: '',
                    hasMore: false,
                    nextOffset: totalLength,
                    totalLength
                };
                // ✅ Кэшируем результат
                chunkCache.set(cacheKey, result);
                return result;
            }

            // ✅ Если уже было 5+ запросов к этому источнику и остался контент - возвращаем большими частями
            if (requestCount >= 5 && offset < totalLength) {
                const remainingLength = totalLength - offset;
                // ✅ Ограничиваем размер чанка до 50k символов (~12.5k токенов), чтобы не упереться в лимит модели
                const maxChunkSize = 50000;
                const chunkSize = Math.min(remainingLength, maxChunkSize);
                const remainingContent = content.slice(offset, offset + chunkSize);
                const hasMoreAfter = (offset + chunkSize) < totalLength;
                
                console.log(`[fetch_context_chunk] ⚡ После ${requestCount} запросов к "${sourceId}" возвращаю большой чанк (${remainingContent.length} из ${remainingLength} оставшихся символов)`);
                
                const result = {
                    sourceId,
                    chunk: remainingContent,
                    offset,
                    limit: chunkSize,
                    nextOffset: offset + chunkSize,
                    hasMore: hasMoreAfter,  // Может быть еще контент
                    totalLength,
                    title: source.title,
                    pageId: source.pageId,
                    _autoComplete: true  // Флаг, что это автоматическое ускорение
                };
                chunkCache.set(cacheKey, result);
                return result;
            }

            const nextOffset = Math.min(offset + effectiveLimit, totalLength);
            const chunk = content.slice(offset, nextOffset);

            deliveredChunkKeys.add(chunkKey);
            deliveredForSource.push({ key: chunkKey, offset, end: nextOffset });

            const result = {
                sourceId,
                chunk,
                offset,
                limit: effectiveLimit,
                nextOffset,
                hasMore: nextOffset < totalLength,
                totalLength,
                title: source.title,
                pageId: source.pageId,
                note: rawLimit > effectiveLimit
                    ? `⚠️ Запрошено ${rawLimit} символов, но по правилам выдано только ${effectiveLimit}.`
                    : undefined
            };
            
            // ✅ Кэшируем результат
            chunkCache.set(cacheKey, result);
            return result;
        }
    };

    const summaryLines = Array.from(sourceMap.values()).map((source) => {
        const lengthLabel = source.estimatedLength
            ? `~${source.estimatedLength} символов`
            : 'длина неизвестна';

        const meta = [];
        if (source.pageId) meta.push(`pageId=${source.pageId}`);
        meta.push(lengthLabel);

        return `- ${source.id}: ${source.title}${meta.length ? ` (${meta.join(', ')})` : ''}${source.description ? ` — ${source.description}` : ''}`;
    });

    const summary = summaryLines.join('\n');

    return {
        tools,
        handlers,
        summary
    };
    function buildAlreadyProvidedResponse(source, offset, totalLength, deliveredForSource) {
        return {
            sourceId: source.id,
            chunk: '',
            offset,
            limit: 0,
            nextOffset: offset,
            hasMore: offset < totalLength,
            totalLength,
            title: source.title,
            pageId: source.pageId,
            note: '⚠️ Этот чанк уже был предоставлен ранее. Используй его из истории диалога вместо повторного запроса.'
        };
    }

    function buildLimitReachedResponse(source, offset, totalLength, deliveredForSource) {
        const summary = deliveredForSource
            .map((entry, idx) => `#${idx + 1}: ${entry.offset}…${entry.end}`)
            .join(', ');

        return {
            sourceId: source.id,
            chunk: '',
            offset,
            limit: 0,
            nextOffset: offset,
            hasMore: offset < totalLength,
            totalLength,
            title: source.title,
            pageId: source.pageId,
            note: `⚠️ Достигнут лимит ${MAX_CHUNKS_PER_SOURCE} уникальных чанков для "${source.title}". Используй ранее полученные диапазоны: ${summary}`
        };
    }
}



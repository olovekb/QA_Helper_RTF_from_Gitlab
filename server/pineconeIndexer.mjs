// pineconeIndexer.mjs
// Индексация чанков в Pinecone и семантический поиск

import { Pinecone } from '@pinecone-database/pinecone';

const PINECONE_NAMESPACE = 'test-model-chunks';

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================

let pineconeClient = null;
let pineconeIndex = null;

/**
 * Инициализирует подключение к Pinecone
 */
export async function initPinecone(apiKey, indexName = 'qa-helper') {
    if (pineconeClient && pineconeIndex) {
        console.log('[pineconeIndexer] Already initialized');
        return pineconeIndex;
    }
    
    try {
        console.log('[pineconeIndexer] Инициализация Pinecone...');
        
        pineconeClient = new Pinecone({ apiKey });
        
        // Проверяем доступные индексы
        const indexes = await pineconeClient.listIndexes();
        console.log('[pineconeIndexer] Доступные индексы:', indexes);
        
        // Проверяем, существует ли индекс
        const indexExists = indexes.some(idx => idx.name === indexName);
        
        if (!indexExists) {
            console.log(`[pineconeIndexer] Индекс ${indexName} не существует, создаю...`);
            await pineconeClient.createIndex({
                name: indexName,
                dimension: 1024, // Текущий Cloud.ru embedding output в проекте ожидается как 1024-dim
                metric: 'cosine'
            });
            console.log(`[pineconeIndexer] Индекс ${indexName} создан`);
        }
        
        pineconeIndex = pineconeClient.Index(indexName);
        
        console.log('[pineconeIndexer] ✅ Pinecone инициализирован');
        return pineconeIndex;
        
    } catch (error) {
        console.error('[pineconeIndexer] ❌ Ошибка инициализации Pinecone:', error.message);
        throw error;
    }
}

/**
 * Проверяет, инициализирован ли Pinecone
 */
export function isPineconeInitialized() {
    return pineconeIndex !== null;
}

/**
 * Получает эмбеддинг для текста через Cloud.ru
 * @param {string} text 
 * @param {string} apiKey 
 * @param {string} model - модель эмбеддинга (по умолчанию Qwen/Qwen3-Embedding-0.6B)
 * @returns {Promise<Array>} Вектор эмбеддинга
 */
export async function getEmbedding(text, apiKey, model = 'Qwen/Qwen3-Embedding-0.6B') {
    const CLOUDRU_EMBEDDING_URL = 'https://foundation-models.api.cloud.ru/v1/embeddings';
    
    try {
        const response = await fetch(CLOUDRU_EMBEDDING_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                input: text
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        
        // Извлекаем эмбеддинг из ответа
        // Формат ответа может отличаться - проверяем структуру
        if (data.data && Array.isArray(data.data) && data.data[0]) {
            return data.data[0].embedding;
        } else if (data.embedding) {
            return data.embedding;
        } else if (Array.isArray(data)) {
            return data[0]?.embedding || data[0];
        }
        
        throw new Error('Не удалось извлечь эмбеддинг из ответа');
        
    } catch (error) {
        console.error('[pineconeIndexer] Ошибка получения эмбеддинга:', error.message);
        throw error;
    }
}

// ============================================================
// ИНДЕКСАЦИЯ ЧАНКОВ
// ============================================================

/**
 * Индексирует массив чанков в Pinecone
 * @param {Array} chunks - Массив чанков
 * @param {string} apiKey - API ключ Cloud.ru
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} Результат индексации
 */
export async function indexChunks(chunks, apiKey, options = {}) {
    const { 
        model = 'Qwen/Qwen3-Embedding-0.6B',
        batchSize = 100,
        namespace = PINECONE_NAMESPACE 
    } = options;
    
    if (!pineconeIndex) {
        throw new Error('Pinecone не инициализирован. Вызовите initPinecone() сначала.');
    }
    
    console.log(`[pineconeIndexer] Начинаю индексацию ${chunks.length} чанков...`);
    
    const vectors = [];
    let processed = 0;
    let errors = 0;
    
    for (const chunk of chunks) {
        try {
            // Создаём эмбеддинг для текста чанка
            const embedding = await getEmbedding(
                chunk.cleaned_text || chunk.raw_text, 
                apiKey, 
                model
            );
            
            // Формируем вектор для Pinecone
            const vector = {
                id: chunk.id,
                values: embedding,
                metadata: {
                    doc_id: chunk.doc_id,
                    doc_title: chunk.doc_title,
                    section_path: JSON.stringify(chunk.section_path || []),
                    heading: chunk.heading || '',
                    chunk_type: chunk.chunk_type,
                    cleaned_text: chunk.cleaned_text?.substring(0, 5000) || '', // Ограничиваем для metadata
                    requirement_id: chunk.requirement_id || '',
                    feature_name: chunk.feature_name || '',
                    is_atomic: chunk.is_atomic,
                    is_composite: chunk.is_composite,
                    linked_chunk_ids: JSON.stringify(chunk.linked_chunk_ids || [])
                }
            };
            
            vectors.push(vector);
            processed++;
            
            // Индексируем батчами
            if (vectors.length >= batchSize) {
                await pineconeIndex.namespace(namespace).upsert(vectors);
                console.log(`[pineconeIndexer] Индексировано ${processed}/${chunks.length} чанков`);
                vectors.length = 0; // Очищаем массив
            }
            
        } catch (error) {
            console.error(`[pineconeIndexer] Ошибка индексации чанка ${chunk.id}:`, error.message);
            errors++;
        }
    }
    
    // Индексируем оставшиеся
    if (vectors.length > 0) {
        await pineconeIndex.namespace(namespace).upsert(vectors);
    }
    
    console.log(`[pineconeIndexer] ✅ Индексация завершена. Успешно: ${processed}, Ошибок: ${errors}`);
    
    return {
        total: chunks.length,
        processed,
        errors,
        namespace
    };
}

/**
 * Удаляет все чанки для документа из индекса
 * @param {string} docId - ID документа
 * @param {string} namespace 
 */
export async function deleteChunksByDocId(docId, namespace = PINECONE_NAMESPACE) {
    if (!pineconeIndex) {
        throw new Error('Pinecone не инициализирован');
    }
    
    console.log(`[pineconeIndexer] Удаляю чанки для docId: ${docId}`);
    
    try {
        await pineconeIndex.namespace(namespace).deleteMany({
            filter: {
                doc_id: { $eq: docId }
            }
        });
        
        console.log(`[pineconeIndexer] ✅ Чанки удалены для docId: ${docId}`);
    } catch (error) {
        console.error('[pineconeIndexer] Ошибка удаления чанков:', error.message);
        throw error;
    }
}

// ============================================================
// СЕМАНТИЧЕСКИЙ ПОИСК
// ============================================================

/**
 * Семантический поиск по чанкам
 * @param {string} query - Поисковый запрос
 * @param {string} apiKey - API ключ Cloud.ru
 * @param {Object} options - Опции поиска
 * @returns {Promise<Array>} Найденные чанки с метаданными
 */
export async function semanticSearch(query, apiKey, options = {}) {
    const { 
        model = 'Qwen/Qwen3-Embedding-0.6B',
        topK = 5,
        namespace = PINECONE_NAMESPACE,
        filter = {},
        includeText = true
    } = options;
    
    if (!pineconeIndex) {
        throw new Error('Pinecone не инициализирован');
    }
    
    console.log(`[pineconeIndexer] Семантический поиск: "${query.substring(0, 100)}...", topK=${topK}`);
    
    try {
        // Получаем эмбеддинг для запроса
        const queryEmbedding = await getEmbedding(query, apiKey, model);
        
        // Выполняем поиск
        const searchResult = await pineconeIndex.namespace(namespace).query({
            vector: queryEmbedding,
            topK: topK,
            filter: Object.keys(filter).length > 0 ? filter : undefined,
            includeMetadata: true,
            includeValues: false
        });
        
        // Форматируем результат
        const results = (searchResult.matches || []).map(match => ({
            id: match.id,
            score: match.score,
            metadata: {
                doc_id: match.metadata?.doc_id,
                doc_title: match.metadata?.doc_title,
                section_path: JSON.parse(match.metadata?.section_path || '[]'),
                heading: match.metadata?.heading,
                chunk_type: match.metadata?.chunk_type,
                cleaned_text: match.metadata?.cleaned_text,
                requirement_id: match.metadata?.requirement_id,
                feature_name: match.metadata?.feature_name,
                is_atomic: match.metadata?.is_atomic === 'true',
                is_composite: match.metadata?.is_composite === 'true',
                linked_chunk_ids: JSON.parse(match.metadata?.linked_chunk_ids || '[]')
            }
        }));
        
        console.log(`[pineconeIndexer] Найдено результатов: ${results.length}`);
        
        return results;
        
    } catch (error) {
        console.error('[pineconeIndexer] Ошибка семантического поиска:', error.message);
        throw error;
    }
}

/**
 * Поиск чанков по типу
 * @param {string} chunkType - Тип чанка
 * @param {number} topK 
 * @param {string} namespace 
 * @returns {Promise<Array>}
 */
export async function searchByType(chunkType, topK = 10, namespace = PINECONE_NAMESPACE) {
    if (!pineconeIndex) {
        throw new Error('Pinecone не инициализирован');
    }
    
    return semanticSearch('', null, {
        topK,
        namespace,
        filter: { chunk_type: { $eq: chunkType } },
        includeText: true
    });
}

/**
 * Получает связанные чанки по ID
 * @param {string} chunkId 
 * @param {number} topK 
 * @param {string} namespace 
 * @returns {Promise<Array>}
 */
export async function getRelatedChunksById(chunkId, topK = 5, namespace = PINECONE_NAMESPACE) {
    if (!pineconeIndex) {
        throw new Error('Pinecone не инициализирован');
    }
    
    try {
        // Получаем сам чанк
        const fetchResult = await pineconeIndex.namespace(namespace).fetch([chunkId]);
        const chunk = fetchResult.vectors?.[chunkId];
        
        if (!chunk) {
            console.warn(`[pineconeIndexer] Чанк ${chunkId} не найден`);
            return [];
        }
        
        // Используем linked_chunk_ids из metadata если есть
        const linkedIds = chunk.metadata?.linked_chunk_ids 
            ? JSON.parse(chunk.metadata.linked_chunk_ids) 
            : [];
        
        if (linkedIds.length > 0) {
            const linkedResult = await pineconeIndex.namespace(namespace).fetch(linkedIds);
            return Object.values(linkedResult.vectors || {}).map(v => ({
                id: v.id,
                score: 1.0,
                metadata: v.metadata
            }));
        }
        
        return [];
        
    } catch (error) {
        console.error('[pineconeIndexer] Ошибка получения связанных чанков:', error.message);
        return [];
    }
}

// ============================================================
// ПОЛУЧЕНИЕ СТАТИСТИКИ
// ============================================================

/**
 * Получает статистику по индексу
 * @param {string} namespace 
 * @returns {Promise<Object>}
 */
export async function getIndexStats(namespace = PINECONE_NAMESPACE) {
    if (!pineconeIndex) {
        throw new Error('Pinecone не инициализирован');
    }
    
    try {
        const stats = await pineconeIndex.describeIndexStats({
            describeIndexStatsRequest: { namespace }
        });
        
        return {
            totalVectors: stats.totalVectorCount,
            namespaces: stats.namespaces
        };
    } catch (error) {
        console.error('[pineconeIndexer] Ошибка получения статистики:', error.message);
        throw error;
    }
}

/**
 * Закрывает соединение с Pinecone
 */
export async function closePinecone() {
    pineconeClient = null;
    pineconeIndex = null;
    console.log('[pineconeIndexer] Соединение с Pinecone закрыто');
}

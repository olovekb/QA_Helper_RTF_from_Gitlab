// pgvectorStore.mjs
// PostgreSQL + pgvector хранилище для семантических чанков

import pg from 'pg';
const { Pool } = pg;

let pool = null;

/**
 * Инициализирует подключение к PostgreSQL и создаёт таблицы
 */
export async function initPgVectorStore(config = {}) {
    const {
        host = process.env.DB_HOST || 'localhost',
        port = parseInt(process.env.DB_PORT || '5432'),
        database = process.env.DB_NAME || 'tia_mapping_db',
        user = process.env.DB_USER || 'tia_user',
        password = process.env.DB_PASSWORD || 'password'
    } = config;

    console.log('[pgvectorStore] Инициализация PostgreSQL...');
    console.log(`[pgvectorStore] Подключение к ${host}:${port}/${database}`);

    pool = new Pool({
        host,
        port,
        database,
        user,
        password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    // Проверяем подключение
    const client = await pool.connect();
    try {
        console.log('[pgvectorStore] ✅ Подключение к PostgreSQL установлено');

        // Включаем расширение pgvector
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('[pgvectorStore] ✅ Расширение vector включено');

        // Создаём таблицу
        await client.query(`
            CREATE TABLE IF NOT EXISTS semantic_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                doc_id VARCHAR(255) NOT NULL,
                doc_title VARCHAR(1000),
                source_type VARCHAR(50) DEFAULT 'linked',
                authority FLOAT DEFAULT 0.7,
                chunk_type VARCHAR(100),
                heading VARCHAR(1000),
                content TEXT NOT NULL,
                embedding VECTOR(1024),
                metadata JSONB DEFAULT '{}',
                explicit_refs JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('[pgvectorStore] ✅ Таблица semantic_chunks создана');

        // Создаём индексы
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_doc_id ON semantic_chunks(doc_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_source_type ON semantic_chunks(source_type)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_chunk_type ON semantic_chunks(chunk_type)
        `);

        // Индекс для семантического поиска (IVFFlat)
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_embedding 
            ON semantic_chunks 
            USING ivfflat (embedding vector_cosine_ops)
        `).catch(() => {
            console.warn('[pgvectorStore] ⚠️ IVFFlat индекс не создан (нужно больше данных)');
        });

        console.log('[pgvectorStore] ✅ Индексы созданы');

    } finally {
        client.release();
    }

    return pool;
}

/**
 * Проверяет, инициализирован ли pgvector
 */
export function isPgVectorInitialized() {
    return pool !== null;
}

/**
 * Список моделей эмбеддеров с fallback
 */
const EMBEDDING_MODELS = [
    'BAAAI/bge-m3',
    'Qwen/Qwen3-Embedding-0.6B'
];

/**
 * Получает эмбеддинг через Cloud.ru с fallback на другие модели
 */
export async function getEmbedding(text, apiKey, preferredModel = null) {
    const modelsToTry = preferredModel 
        ? [preferredModel, ...EMBEDDING_MODELS.filter(m => m !== preferredModel)]
        : EMBEDDING_MODELS;
    
    let lastError = null;
    
    for (const model of modelsToTry) {
        try {
            console.log(`[pgvectorStore] Попытка получить эмбеддинг с моделью: ${model}`);
            
            const embedding = await fetchEmbeddingFromCloudRu(text, apiKey, model);
            console.log(`[pgvectorStore] ✅ Эмбеддинг получен с моделью: ${model} (${embedding.length} dimensions)`);
            return embedding;
            
        } catch (error) {
            console.warn(`[pgvectorStore] ⚠️ Модель ${model} недоступна:`, error.message);
            lastError = error;
        }
    }
    
    throw new Error(`Все модели эмбеддеров недоступны: ${lastError?.message}`);
}

async function fetchEmbeddingFromCloudRu(text, apiKey, model) {
    const CLOUDRU_EMBEDDING_URL = 'https://foundation-models.api.cloud.ru/v1/embeddings';
    
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

    if (data.data && Array.isArray(data.data) && data.data[0]?.embedding) {
        return data.data[0].embedding;
    }

    throw new Error('Не удалось извлечь эмбеддинг из ответа');
}

/**
 * Индексирует один чанк
 */
export async function indexChunk(chunk, apiKey) {
    if (!pool) throw new Error('pgvector не инициализирован');

    const embedding = await getEmbedding(chunk.content || chunk.cleaned_text, apiKey);
    const embeddingStr = `[${embedding.join(',')}]`;

    const query = `
        INSERT INTO semantic_chunks 
        (doc_id, doc_title, source_type, authority, chunk_type, heading, content, embedding, metadata, explicit_refs)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
            doc_title = EXCLUDED.doc_title,
            source_type = EXCLUDED.source_type,
            authority = EXCLUDED.authority,
            chunk_type = EXCLUDED.chunk_type,
            heading = EXCLUDED.heading,
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata,
            explicit_refs = EXCLUDED.explicit_refs,
            created_at = NOW()
    `;

    const values = [
        chunk.doc_id,
        chunk.doc_title,
        chunk.source_type || 'linked',
        chunk.authority || 0.7,
        chunk.chunk_type,
        chunk.heading,
        chunk.cleaned_text || chunk.content,
        embeddingStr,
        JSON.stringify(chunk.metadata || {}),
        JSON.stringify(chunk.explicit_refs || [])
    ];

    await pool.query(query, values);
    return chunk.id;
}

/**
 * Индексирует массив чанков
 */
export async function indexChunks(chunks, apiKey, options = {}) {
    if (!pool) throw new Error('pgvector не инициализирован');

    const { batchSize = 10 } = options;
    console.log(`[pgvectorStore] Индексация ${chunks.length} чанков...`);

    let processed = 0;
    let errors = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        
        for (const chunk of batch) {
            try {
                await indexChunk(chunk, apiKey);
                processed++;
            } catch (error) {
                console.error(`[pgvectorStore] Ошибка индексации чанка ${chunk.id}:`, error.message);
                errors++;
            }
        }

        console.log(`[pgvectorStore] Обработано ${processed}/${chunks.length}`);
    }

    console.log(`[pgvectorStore] ✅ Индексация завершена: ${processed} успешно, ${errors} ошибок`);
    return { total: chunks.length, processed, errors };
}

/**
 * Семантический поиск
 */
export async function semanticSearch(query, apiKey, options = {}) {
    if (!pool) throw new Error('pgvector не инициализирован');

    const {
        topK = 5,
        sourceType = null,
        docId = null,
        chunkType = null,
        minScore = 0.0
    } = options;

    console.log(`[pgvectorStore] Семантический поиск: "${query.substring(0, 50)}...", topK=${topK}`);

    // Получаем эмбеддинг запроса
    const embedding = await getEmbedding(query, apiKey);
    const embeddingStr = `[${embedding.join(',')}]`;

    // Формируем WHERE условия
    const conditions = [];
    const params = [embeddingStr, topK];
    let paramIndex = 3;

    if (sourceType) {
        conditions.push(`source_type = $${paramIndex++}`);
        params.push(sourceType);
    }
    if (docId) {
        conditions.push(`doc_id = $${paramIndex++}`);
        params.push(docId);
    }
    if (chunkType) {
        conditions.push(`chunk_type = $${paramIndex++}`);
        params.push(chunkType);
    }

    const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';

    const querySql = `
        SELECT 
            id, doc_id, doc_title, source_type, authority, chunk_type, 
            heading, content, metadata, explicit_refs,
            1 - (embedding <=> $1::vector) as score
        FROM semantic_chunks
        ${whereClause}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
    `;

    const result = await pool.query(querySql, params);

    return result.rows.map(row => ({
        id: row.id,
        doc_id: row.doc_id,
        doc_title: row.doc_title,
        source_type: row.source_type,
        authority: parseFloat(row.authority),
        chunk_type: row.chunk_type,
        heading: row.heading,
        content: row.content,
        metadata: row.metadata,
        explicit_refs: row.explicit_refs,
        score: parseFloat(row.score)
    }));
}

/**
 * Multi-hop структурированный поиск
 */
export async function multiHopStructuredSearch(query, apiKey, options = {}) {
    const {
        primaryTopK = 5,
        expansionTopK = 3,
        authorityMain = 1.0,
        authorityLinked = 0.7,
        depth = 2
    } = options;

    console.log(`[pgvectorStore] Multi-hop поиск: primaryTopK=${primaryTopK}, expansionTopK=${expansionTopK}`);

    // === ШАГ 1: Primary Retrieval (main document) ===
    const primaryResults = await semanticSearch(query, apiKey, {
        topK: primaryTopK,
        sourceType: 'main'
    });

    console.log(`[pgvectorStore] Primary results: ${primaryResults.length}`);

    // === ШАГ 2: Explicit Link Resolution ===
    const resolvedChunks = await resolveExplicitLinks(primaryResults, apiKey, { depth });
    console.log(`[pgvectorStore] After explicit link resolution: ${resolvedChunks.length}`);

    // === ШАГ 3: Controlled Semantic Expansion (linked documents) ===
    let finalResults = [...resolvedChunks];

    if (resolvedChunks.length < primaryTopK * 2) {
        const linkedResults = await semanticSearch(query, apiKey, {
            topK: expansionTopK,
            sourceType: 'linked'
        });

        // Применяем lower authority
        for (const chunk of linkedResults) {
            chunk.authority = authorityLinked;
            chunk.is_expanded = true;
        }

        finalResults = mergeAndRerank(resolvedChunks, linkedResults, authorityMain);
        console.log(`[pgvectorStore] After semantic expansion: ${finalResults.length}`);
    }

    return finalResults.slice(0, primaryTopK + expansionTopK);
}

/**
 * Разрешает явные ссылки между чанками
 */
async function resolveExplicitLinks(initialChunks, apiKey, options = {}) {
    const { depth = 2 } = options;
    const resolved = new Map();
    const toProcess = [...initialChunks];

    let currentDepth = 0;

    while (toProcess.length > 0 && currentDepth < depth) {
        const chunk = toProcess.shift();

        if (resolved.has(chunk.id)) continue;
        resolved.set(chunk.id, { ...chunk, hop_distance: currentDepth, is_resolved: currentDepth > 0 });

        // Ищем чанки по явным ссылкам
        const explicitRefs = chunk.explicit_refs || [];
        for (const ref of explicitRefs) {
            const linkedChunks = await findChunksByReference(ref, chunk.doc_id);
            for (const linked of linkedChunks) {
                if (!resolved.has(linked.id)) {
                    linked.resolved_from = chunk.id;
                    linked.resolved_via = ref.type;
                    toProcess.push(linked);
                }
            }
        }

        currentDepth++;
    }

    return Array.from(resolved.values());
}

/**
 * Находит чанки по явной ссылке
 */
async function findChunksByReference(ref, excludeDocId) {
    if (!pool) return [];

    let query = `
        SELECT id, doc_id, doc_title, source_type, authority, chunk_type, 
               heading, content, metadata, explicit_refs
        FROM semantic_chunks
        WHERE doc_id != $1
    `;

    const params = [excludeDocId];
    let paramIndex = 2;

    // Ищем по разным типам ссылок
    if (ref.type === 'section_ref' && ref.target) {
        query += ` AND (heading ILIKE $${paramIndex++} OR content ILIKE $${paramIndex++})`;
        params.push(`%${ref.target}%`, `%${ref.target}%`);
    } else if (ref.type === 'doc_ref' && ref.target) {
        query += ` AND doc_title ILIKE $${paramIndex++}`;
        params.push(`%${ref.target}%`);
    } else if (ref.type === 'pageId' && ref.target) {
        query += ` AND doc_id = $${paramIndex++}`;
        params.push(ref.target);
    }

    query += ' LIMIT 5';

    try {
        const result = await pool.query(query, params);
        return result.rows.map(row => ({
            id: row.id,
            doc_id: row.doc_id,
            doc_title: row.doc_title,
            source_type: row.source_type,
            authority: parseFloat(row.authority),
            chunk_type: row.chunk_type,
            heading: row.heading,
            content: row.content,
            metadata: row.metadata,
            explicit_refs: row.explicit_refs,
            score: 1.0
        }));
    } catch (error) {
        console.error('[pgvectorStore] Ошибка поиска по ссылке:', error.message);
        return [];
    }
}

/**
 * Объединяет и переранжирует результаты
 */
function mergeAndRerank(primary, secondary, authorityMain) {
    const merged = new Map();

    // Добавляем primary
    for (const chunk of primary) {
        const finalScore = chunk.score * (chunk.source_type === 'main' ? authorityMain : 1.0);
        merged.set(chunk.id, { ...chunk, final_score: finalScore });
    }

    // Добавляем secondary
    for (const chunk of secondary) {
        if (!merged.has(chunk.id)) {
            const finalScore = chunk.score * chunk.authority;
            merged.set(chunk.id, { ...chunk, final_score: finalScore });
        }
    }

    // Сортируем по final_score
    return Array.from(merged.values())
        .sort((a, b) => b.final_score - a.final_score);
}

/**
 * Удаляет чанки по doc_id
 */
export async function deleteChunksByDocId(docId) {
    if (!pool) throw new Error('pgvector не инициализирован');

    await pool.query('DELETE FROM semantic_chunks WHERE doc_id = $1', [docId]);
    console.log(`[pgvectorStore] Удалены чанки для doc_id: ${docId}`);
}

/**
 * Удаляет все чанки
 */
export async function clearAllChunks() {
    if (!pool) throw new Error('pgvector не инициализирован');

    await pool.query('DELETE FROM semantic_chunks');
    console.log('[pgvectorStore] Все чанки удалены');
}

/**
 * Получает статистику
 */
export async function getStats() {
    if (!pool) throw new Error('pgvector не инициализирован');

    const result = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT doc_id) as unique_docs,
            COUNT(CASE WHEN source_type = 'main' THEN 1 END) as main_chunks,
            COUNT(CASE WHEN source_type = 'linked' THEN 1 END) as linked_chunks,
            COUNT(DISTINCT chunk_type) as unique_types
        FROM semantic_chunks
    `);

    return result.rows[0];
}

/**
 * Закрывает соединение
 */
export async function closePgVectorStore() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('[pgvectorStore] Соединение закрыто');
    }
}

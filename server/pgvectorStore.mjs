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
                embedding_text TEXT,
                retrieval_class VARCHAR(50),
                eligibility_status VARCHAR(32),
                embedding VECTOR(1024),
                metadata JSONB DEFAULT '{}',
                explicit_refs JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('[pgvectorStore] ✅ Таблица semantic_chunks создана');

        // Создаём индексы
        await client.query(`
            ALTER TABLE semantic_chunks
            ADD COLUMN IF NOT EXISTS embedding_text TEXT
        `);
        await client.query(`
            ALTER TABLE semantic_chunks
            ADD COLUMN IF NOT EXISTS retrieval_class VARCHAR(50)
        `);
        await client.query(`
            ALTER TABLE semantic_chunks
            ADD COLUMN IF NOT EXISTS eligibility_status VARCHAR(32)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_doc_id ON semantic_chunks(doc_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_source_type ON semantic_chunks(source_type)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_chunk_type ON semantic_chunks(chunk_type)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_retrieval_class ON semantic_chunks(retrieval_class)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_semantic_chunks_eligibility_status ON semantic_chunks(eligibility_status)
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
 * Список моделей эмбеддеров в порядке приоритета.
 * Сначала используем Qwen, затем откатываемся на bge-m3.
 */
const EMBEDDING_MODELS = [
    'Qwen/Qwen3-Embedding-0.6B',
    'BAAAI/bge-m3'
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

export async function getEmbeddingWithModel(text, apiKey, model) {
    if (!model) {
        throw new Error('Embedding model is required for exact embedding lookup.');
    }

    return await fetchEmbeddingFromCloudRu(text, apiKey, model);
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

    const embeddingSource = chunk.embedding_text || chunk.content || chunk.cleaned_text;
    const embedding = await getEmbedding(embeddingSource, apiKey);
    const embeddingStr = `[${embedding.join(',')}]`;

    const query = `
        INSERT INTO semantic_chunks 
        (id, doc_id, doc_title, source_type, authority, chunk_type, heading, content, embedding_text, retrieval_class, eligibility_status, embedding, metadata, explicit_refs)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
            doc_title = EXCLUDED.doc_title,
            source_type = EXCLUDED.source_type,
            authority = EXCLUDED.authority,
            chunk_type = EXCLUDED.chunk_type,
            heading = EXCLUDED.heading,
            content = EXCLUDED.content,
            embedding_text = EXCLUDED.embedding_text,
            retrieval_class = EXCLUDED.retrieval_class,
            eligibility_status = EXCLUDED.eligibility_status,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata,
            explicit_refs = EXCLUDED.explicit_refs,
            created_at = NOW()
    `;

    const values = [
        chunk.id,
        chunk.doc_id,
        chunk.doc_title,
        chunk.source_type || 'linked',
        chunk.authority || 0.7,
        chunk.chunk_type,
        chunk.heading,
        chunk.cleaned_text || chunk.content,
        embeddingSource,
        chunk.retrieval_class || chunk.metadata?.retrieval_class || null,
        chunk.eligibility_status || chunk.metadata?.eligibility_status || null,
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
        docIds = null,
        chunkType = null,
        chunkTypes = null,
        chunkGranularity = null,
        retrievalClass = null,
        eligibilityStatuses = null,
        minScore = 0.0,
        enforceScoped = false,
        allowUnsafeUnscoped = false
    } = options;

    const hasScope = Boolean(
        sourceType ||
        docId ||
        (Array.isArray(docIds) && docIds.length > 0) ||
        chunkType ||
        (Array.isArray(chunkTypes) && chunkTypes.length > 0) ||
        chunkGranularity ||
        retrievalClass ||
        (Array.isArray(eligibilityStatuses) && eligibilityStatuses.length > 0)
    );
    if (enforceScoped && !hasScope && !allowUnsafeUnscoped) {
        throw new Error('Unsafe unscoped semanticSearch is not allowed in production retrieval path.');
    }

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
    if (Array.isArray(docIds) && docIds.length > 0) {
        conditions.push(`doc_id = ANY($${paramIndex++})`);
        params.push(docIds);
    }
    if (chunkType) {
        conditions.push(`chunk_type = $${paramIndex++}`);
        params.push(chunkType);
    }
    if (Array.isArray(chunkTypes) && chunkTypes.length > 0) {
        conditions.push(`chunk_type = ANY($${paramIndex++})`);
        params.push(chunkTypes);
    }
    if (chunkGranularity) {
        conditions.push(`COALESCE(metadata->>'chunk_granularity', 'atomic') = $${paramIndex++}`);
        params.push(String(chunkGranularity));
    }
    if (retrievalClass) {
        conditions.push(`retrieval_class = $${paramIndex++}`);
        params.push(retrievalClass);
    }
    if (Array.isArray(eligibilityStatuses) && eligibilityStatuses.length > 0) {
        conditions.push(`eligibility_status = ANY($${paramIndex++})`);
        params.push(eligibilityStatuses);
    }

    const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';

    const querySql = `
        SELECT 
            id, doc_id, doc_title, source_type, authority, chunk_type, 
            heading, content, embedding_text, retrieval_class, eligibility_status, metadata, explicit_refs,
            1 - (embedding <=> $1::vector) as score
        FROM semantic_chunks
        ${whereClause}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
    `;

    const result = await pool.query(querySql, params);

    const mappedRows = result.rows.map(row => ({
        id: row.id,
        doc_id: row.doc_id,
        doc_title: row.doc_title,
        source_type: row.source_type,
        authority: parseFloat(row.authority),
        chunk_type: row.chunk_type,
        heading: row.heading,
        content: row.content,
        embedding_text: row.embedding_text,
        retrieval_class: row.retrieval_class,
        eligibility_status: row.eligibility_status,
        metadata: row.metadata,
        explicit_refs: row.explicit_refs,
        score: parseFloat(row.score)
    }));
    if (!(Number(minScore) > 0)) {
        return mappedRows;
    }
    return mappedRows.filter(row => Number.isFinite(row?.score) && row.score >= Number(minScore));
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
        depth = 2,
        retrievalClass = null,
        eligibilityStatuses = null
    } = options;

    console.log(`[pgvectorStore] Multi-hop поиск: primaryTopK=${primaryTopK}, expansionTopK=${expansionTopK}`);

    // === ШАГ 1: Primary Retrieval (main document) ===
    const primaryResults = await semanticSearch(query, apiKey, {
        topK: primaryTopK,
        sourceType: 'main',
        retrievalClass,
        eligibilityStatuses
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
            sourceType: 'linked',
            retrievalClass,
            eligibilityStatuses
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
async function findChunksByReference(ref, excludeDocId, limit = 5) {
    if (!pool) return [];

    let query = `
        SELECT id, doc_id, doc_title, source_type, authority, chunk_type, 
               heading, content, embedding_text, retrieval_class, eligibility_status, metadata, explicit_refs
        FROM semantic_chunks
        WHERE 1 = 1
    `;

    const params = [];
    let paramIndex = 1;

    if (excludeDocId != null) {
        query += ` AND doc_id != $${paramIndex++}`;
        params.push(excludeDocId);
    }

    // Ищем по разным типам ссылок
    const refType = String(ref?.type || '');
    const refTarget = String(ref?.target || '').trim();
    const refLike = `%${refTarget}%`;
    const normalizedMethodTarget = refTarget.replace(/\s+/g, ' ').trim().toUpperCase();

    if (!refTarget || refType === 'relative_ref') {
        return [];
    }

    if (refType === 'section_ref') {
        query += ` AND (
            metadata->>'source_row_id' = $${paramIndex++}
            OR metadata->>'rowNumber' = $${paramIndex++}
            OR metadata->>'row_number' = $${paramIndex++}
            OR metadata->>'section_number' = $${paramIndex++}
            OR metadata->>'sectionNumber' = $${paramIndex++}
            OR heading ILIKE $${paramIndex++}
            OR content ILIKE $${paramIndex++}
            OR embedding_text ILIKE $${paramIndex++}
            OR metadata::text ILIKE $${paramIndex++}
        )`;
        params.push(refTarget, refTarget, refTarget, refTarget, refTarget, refLike, refLike, refLike, refLike);
    } else if (refType === 'api_section_ref') {
        query += ` AND (
            metadata->>'section_number' = $${paramIndex++}
            OR metadata->>'sectionNumber' = $${paramIndex++}
            OR heading ILIKE $${paramIndex++}
            OR content ILIKE $${paramIndex++}
            OR embedding_text ILIKE $${paramIndex++}
            OR metadata::text ILIKE $${paramIndex++}
        )`;
        params.push(refTarget, refTarget, refLike, refLike, refLike, refLike);
    } else if (refType === 'method_ref') {
        query += ` AND (
            UPPER(content) LIKE $${paramIndex++}
            OR UPPER(COALESCE(embedding_text, '')) LIKE $${paramIndex++}
            OR UPPER(metadata::text) LIKE $${paramIndex++}
            OR UPPER(explicit_refs::text) LIKE $${paramIndex++}
        )`;
        params.push(`%${normalizedMethodTarget}%`, `%${normalizedMethodTarget}%`, `%${normalizedMethodTarget}%`, `%${normalizedMethodTarget}%`);
    } else if (refType === 'layout_ref') {
        query += ` AND (
            heading ILIKE $${paramIndex++}
            OR content ILIKE $${paramIndex++}
            OR embedding_text ILIKE $${paramIndex++}
            OR metadata::text ILIKE $${paramIndex++}
        )`;
        params.push(refLike, refLike, refLike, refLike);
    } else if (refType === 'doc_ref') {
        query += ` AND doc_title ILIKE $${paramIndex++}`;
        params.push(refLike);
    } else if (refType === 'pageId') {
        query += ` AND doc_id = $${paramIndex++}`;
        params.push(refTarget);
    } else {
        return [];
    }

    query += ` LIMIT $${paramIndex++}`;
    params.push(limit);

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
            embedding_text: row.embedding_text,
            retrieval_class: row.retrieval_class,
            eligibility_status: row.eligibility_status,
            metadata: row.metadata,
            explicit_refs: row.explicit_refs,
            score: 1.0
        }));
    } catch (error) {
        console.error('[pgvectorStore] Ошибка поиска по ссылке:', error.message);
        return [];
    }
}

export async function findChunksByReferences(refs = [], excludeDocId = null, options = {}) {
    const { limit = 2 } = options;
    const normalizedRefs = Array.isArray(refs)
        ? refs
            .filter(ref => ref && ref.type && ref.target)
            .map(ref => ({
                type: String(ref.type),
                target: String(ref.target)
            }))
        : [];

    const uniqueRefs = normalizedRefs.filter((ref, index, arr) =>
        arr.findIndex(candidate => candidate.type === ref.type && candidate.target === ref.target) === index
    );

    const seen = new Set();
    const resolved = [];

    for (const ref of uniqueRefs) {
        const chunks = await findChunksByReference(ref, excludeDocId, limit);
        for (const chunk of chunks) {
            if (seen.has(chunk.id)) continue;
            seen.add(chunk.id);
            resolved.push(chunk);
        }
    }

    return resolved;
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

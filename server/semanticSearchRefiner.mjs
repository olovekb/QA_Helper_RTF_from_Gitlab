// semanticSearchRefiner.mjs
// Уточнение Code элементов через семантический поиск (pgvector)

import {
    isPgVectorInitialized,
    semanticSearch as pgvectorSearch,
    findChunksByReferences
} from './pgvectorStore.mjs';

export async function refineCodesWithSemanticSearch(model, apiKey, options = {}) {
    const { usePinecone = false, usePgVector = false, topK = 5, namespace = 'test-model-chunks', docId = null } = options;
    
    if (usePgVector) {
        if (!isPgVectorInitialized()) {
            console.log('[refineCodesWithSemanticSearch] pgvector недоступен, пропускаем');
            return model;
        }
        return refineWithPgVector(model, apiKey, { topK, docId });
    }
    
    if (usePinecone) {
        if (!isPineconeInitialized()) {
            console.log('[refineCodesWithSemanticSearch] Pinecone недоступен, пропускаем');
            return model;
        }
        return refineWithPinecone(model, apiKey, { topK, namespace });
    }
    
    console.log('[refineCodesWithSemanticSearch] Векторный поиск не настроен, пропускаем');
    return model;
}

async function refineWithPgVector(model, apiKey, options = {}) {
    const { topK = 5, docId = null } = options;
    const mainDocId = String(docId || '').trim() || null;
    
    console.log('[refineCodesWithSemanticSearch] Уточнение Code элементов через pgvector (intra-scenario)...');
    
    const allCodes = [];
    for (const feature of (model || [])) {
        for (const story of (feature.stories || [])) {
            for (const scenario of (story.scenarios || [])) {
                for (const code of (scenario.codes || [])) {
                    allCodes.push({ 
                        featureId: feature.id, 
                        featureText: feature.text, 
                        storyId: story.id, 
                        storyText: story.text, 
                        scenarioId: scenario.id, 
                        scenarioText: scenario.text, 
                        codeId: code.id, 
                        codeText: code.text, 
                        codeType: code.type 
                    });
                }
            }
        }
    }
    
    if (allCodes.length === 0) return model;
    
    console.log(`[refineCodesWithSemanticSearch] Обрабатываю ${allCodes.length} Code элементов`);
    
    let refinedCount = 0;
    
    for (const codeInfo of allCodes) {
        try {
            // Формируем intra-scenario query
            const query = `Scenario: ${codeInfo.scenarioText} Code: ${codeInfo.codeText}`.trim();
            
            // Шаг 1: Local retrieval - ищем только по main документу с высоким приоритетом
            const localResults = await pgvectorSearch(query, apiKey, { 
                topK: Math.ceil(topK * 0.6),  // 60% локальный поиск
                sourceType: 'main',
                docId: mainDocId,
                retrievalClass: 'behavioral',
                chunkGranularity: 'atomic',
                enforceScoped: true
            });
            
            // Шаг 2: Explicit link resolution - подтягиваем связанные чанки по явным ссылкам
            let linkedResults = [];
            if (localResults.length > 0) {
                const refs = localResults.flatMap(r => r.explicit_refs || []);
                if (refs.length > 0) {
                    linkedResults = await resolveLinksFromRefs(refs, localResults[0].doc_id);
                }
            }
            
            // Объединяем результаты с приоритетами
            const allResults = [
                ...localResults.map(r => ({ ...r, priority: 'local', score: r.score * 1.0 })),
                ...linkedResults.map(r => ({ ...r, priority: 'linked', score: r.score * 0.8 }))
            ];
            
            if (allResults.length > 0) {
                const relevantChunks = allResults
                    .filter(r => r.score > 0.4)
                    .map(r => {
                        const content = r.metadata?.cleaned_text || r.content || '';
                        const prefix = r.priority === 'local' ? '[Основной док]' : r.priority === 'linked' ? '[По ссылке]' : '[Дополнительно]';
                        return `${prefix} ${content}`;
                    })
                    .filter(Boolean)
                    .join('\n\n');
                
                if (relevantChunks && relevantChunks.length > 50) {
                    for (const feature of model) {
                        for (const story of (feature.stories || [])) {
                            for (const scenario of (story.scenarios || [])) {
                                for (const code of (scenario.codes || [])) {
                                    if (code.id === codeInfo.codeId) {
                                        code.semanticContext = relevantChunks.substring(0, 2000);
                                        code.semanticScore = allResults[0].score;
                                        code.semanticPriority = allResults[0].priority;
                                        refinedCount++;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`[refineCodesWithSemanticSearch] Ошибка для code ${codeInfo.codeId}:`, error.message);
        }
    }
    
    console.log(`[refineCodesWithSemanticSearch] ✅ Уточнено ${refinedCount} Code элементов`);
    return model;
}

async function resolveLinksFromRefs(refs, currentDocId) {
    const resolved = await findChunksByReferences(refs, currentDocId, { limit: 2 });
    return (resolved || []).filter(chunk => (chunk?.chunk_granularity || chunk?.metadata?.chunk_granularity || 'atomic') === 'atomic');
}

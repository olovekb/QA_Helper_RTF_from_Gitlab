// semanticSearchRefiner.mjs
// Уточнение Code элементов через семантический поиск (pgvector)

import { isPgVectorInitialized, semanticSearch as pgvectorSearch } from './pgvectorStore.mjs';

export async function refineCodesWithSemanticSearch(model, apiKey, options = {}) {
    const { usePinecone = false, usePgVector = false, topK = 5, namespace = 'test-model-chunks' } = options;
    
    if (usePgVector) {
        if (!isPgVectorInitialized()) {
            console.log('[refineCodesWithSemanticSearch] pgvector недоступен, пропускаем');
            return model;
        }
        return refineWithPgVector(model, apiKey, { topK });
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
    const { topK = 5 } = options;
    
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
                sourceType: 'main'
            });
            
            // Шаг 2: Explicit link resolution - подтягиваем связанные чанки по явным ссылкам
            let linkedResults = [];
            if (localResults.length > 0) {
                const refs = localResults.flatMap(r => r.explicit_refs || []);
                if (refs.length > 0) {
                    linkedResults = await resolveLinksFromRefs(refs, localResults[0].doc_id);
                }
            }
            
            // Шаг 3: Limited semantic fallback - только если мало результатов
            let fallbackResults = [];
            if (localResults.length + linkedResults.length < topK) {
                fallbackResults = await pgvectorSearch(query, apiKey, { 
                    topK: topK - localResults.length - linkedResults.length,
                    sourceType: 'linked'
                });
            }
            
            // Объединяем результаты с приоритетами
            const allResults = [
                ...localResults.map(r => ({ ...r, priority: 'local', score: r.score * 1.0 })),
                ...linkedResults.map(r => ({ ...r, priority: 'linked', score: r.score * 0.8 })),
                ...fallbackResults.map(r => ({ ...r, priority: 'fallback', score: r.score * 0.5 }))
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
    const resolved = [];
    const seen = new Set();
    
    for (const ref of refs) {
        if (ref.type === 'section_ref' && ref.target) {
            const results = await pgvectorSearch(ref.target, null, { topK: 2 });
            for (const r of results) {
                if (!seen.has(r.id)) {
                    seen.add(r.id);
                    resolved.push(r);
                }
            }
        }
    }
    
    return resolved;
}

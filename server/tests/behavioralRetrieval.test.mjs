import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildEnrichmentQuery,
    isBehavioralRetrievalCandidate,
    rerankRetrievedChunksByMetadata
} from '../behavioralRetrieval.mjs';
import {
    resolveCanonicalGenerationSource,
    isMainDocumentIndexCandidate,
    selectCanonicalMainChunks
} from '../canonicalChunkSelection.mjs';
import {
    CHUNK_TYPES,
    ELIGIBILITY_STATUSES,
    RETRIEVAL_CLASSES
} from '../semanticChunking.mjs';

function createBehavioralChunk(overrides = {}) {
    return {
        id: 'behavioral-4-4-1',
        chunk_type: CHUNK_TYPES.ATOMIC_RULE,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        exclude_from_retrieval: false,
        metadata: {
            section_number: '4.4',
            source_requirement_section: '4.4',
            source_row_id: '4.4.1'
        },
        ...overrides
    };
}

function createSupportApiChunk(overrides = {}) {
    return {
        id: 'support-api-6-4',
        chunk_type: CHUNK_TYPES.API_ENDPOINT_SUMMARY,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.API_CONTEXT,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        exclude_from_retrieval: false,
        metadata: {
            section_number: '6.4',
            source_section: '6',
            usage_policy: 'support_only',
            supporting_api: true,
            exclude_from_behavioral: true,
            survived_compaction: true
        },
        ...overrides
    };
}

function createBehavioralFallbackChunk(overrides = {}) {
    return {
        id: 'behavioral-error-3-1',
        chunk_type: CHUNK_TYPES.ERROR_HANDLING,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        exclude_from_retrieval: false,
        metadata: {
            section_number: '3.1'
        },
        ...overrides
    };
}

test('isBehavioralRetrievalCandidate accepts only atomic whitelist chunks', () => {
    const atomicBehavioral = {
        chunk_type: CHUNK_TYPES.ATOMIC_RULE,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        exclude_from_retrieval: false
    };

    const summaryChunk = {
        chunk_type: CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
        chunk_granularity: 'summary',
        retrieval_class: RETRIEVAL_CLASSES.REFERENCE_CONTEXT,
        eligibility_status: ELIGIBILITY_STATUSES.EXCLUDED,
        exclude_from_retrieval: true
    };

    const legacyRow = {
        chunk_type: CHUNK_TYPES.REQUIREMENT_ROW,
        chunk_granularity: 'summary',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        exclude_from_retrieval: false
    };

    const wrongGranularity = {
        chunk_type: CHUNK_TYPES.ATOMIC_RULE,
        chunk_granularity: 'summary',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        exclude_from_retrieval: false
    };

    assert.equal(isBehavioralRetrievalCandidate(atomicBehavioral), true);
    assert.equal(isBehavioralRetrievalCandidate(summaryChunk), false);
    assert.equal(isBehavioralRetrievalCandidate(legacyRow), false);
    assert.equal(isBehavioralRetrievalCandidate(wrongGranularity), false);
});

test('rerank applies soft length penalty but does not hard-exclude long chunks', () => {
    const segment = {
        heading: 'Login',
        text: 'Submit login form',
        retrievalProfile: {
            screen_scopes: ['Login screen'],
            entity_scopes: ['Submit button']
        }
    };

    const shortChunk = {
        id: 'short',
        chunk_type: CHUNK_TYPES.ATOMIC_RULE,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        score: 0.82,
        token_count: 220,
        aux_metadata: {
            screen_scope: 'Login screen',
            entity_scope: 'Submit button'
        }
    };

    const longChunk = {
        id: 'long',
        chunk_type: CHUNK_TYPES.ATOMIC_RULE,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
        score: 0.9,
        token_count: 1100,
        aux_metadata: {
            screen_scope: 'Login screen',
            entity_scope: 'Submit button'
        }
    };

    const reranked = rerankRetrievedChunksByMetadata([longChunk, shortChunk], segment, { limit: 2 });

    assert.equal(reranked.length, 2);
    assert.ok(reranked.some((chunk) => chunk.id === 'long'));
    assert.ok(reranked.some((chunk) => chunk.id === 'short'));

    const long = reranked.find((chunk) => chunk.id === 'long');
    const short = reranked.find((chunk) => chunk.id === 'short');

    assert.ok((long?.softPenalty || 0) > 0);
    assert.ok((short?.softPenalty || 0) === 0);
});

test('enrichment query carries metadata signals needed after behavioral selection', () => {
    const segment = {
        heading: 'Change password',
        text: 'User updates password on Settings screen',
        retrievalProfile: {
            screen_scopes: ['Settings screen'],
            entity_scopes: ['Password form'],
            section_numbers: ['12']
        }
    };

    const behavioralChunks = [
        {
            aux_metadata: {
                screen_scope: 'Settings screen',
                entity_scope: 'Password form',
                endpoint: 'POST /passwd/change',
                method: 'POST',
                references: ['figma/password-form']
            }
        }
    ];

    const query = buildEnrichmentQuery(segment, behavioralChunks);

    assert.match(query, /settings screen/i);
    assert.match(query, /password form/i);
    assert.match(query, /post \/passwd\/change/i);
    assert.match(query, /figma\/password-form/);
});

test('support-only api chunks from section 6 are excluded from behavioral main selection', () => {
    const behavioralChunk = createBehavioralChunk();
    const supportApiChunk = createSupportApiChunk();

    const behavioralCandidates = [behavioralChunk, supportApiChunk].filter((chunk) => isBehavioralRetrievalCandidate(chunk));

    assert.deepEqual(behavioralCandidates.map((chunk) => chunk.id), ['behavioral-4-4-1']);
});

test('canonical main chunk selection prefers behavioral chunks when available', () => {
    const selection = selectCanonicalMainChunks([
        createSupportApiChunk(),
        createBehavioralChunk()
    ]);

    assert.equal(selection.usedFallback, false);
    assert.equal(selection.indexableChunks.length, 2);
    assert.deepEqual(selection.canonicalChunks.map((chunk) => chunk.id), ['behavioral-4-4-1']);
});

test('canonical main chunk selection falls back to support-only api chunks for api-only documents', () => {
    const supportSummary = createSupportApiChunk();
    const supportErrors = createSupportApiChunk({
        id: 'support-api-6-4-errors',
        chunk_type: CHUNK_TYPES.ERROR_HANDLING
    });

    const selection = selectCanonicalMainChunks([supportSummary, supportErrors]);

    assert.equal(isMainDocumentIndexCandidate(supportSummary), true);
    assert.equal(isMainDocumentIndexCandidate(supportErrors), true);
    assert.equal(selection.usedFallback, true);
    assert.deepEqual(
        selection.canonicalChunks.map((chunk) => chunk.id),
        ['support-api-6-4', 'support-api-6-4-errors']
    );
});

test('section 6 api chunks remain main candidates even if explicit support metadata is missing', () => {
    const legacySupportChunk = createSupportApiChunk({
        metadata: {
            section_number: '6.4'
        },
        section_path: [
            '6. Взаимодействие с сервером',
            '6.4. Получение просмотровой формы',
            'GET /rest/stateful/corp/document/visual/byid'
        ],
        usage_policy: null,
        source_section: null,
        supporting_api: null,
        exclude_from_behavioral: null,
        survived_compaction: null
    });

    assert.equal(isMainDocumentIndexCandidate(legacySupportChunk), true);
});

test('canonical main chunk selection falls back to non-atomic behavioral chunks when atomic rules are absent', () => {
    const behavioralFallback = createBehavioralFallbackChunk();
    const selection = selectCanonicalMainChunks([behavioralFallback]);

    assert.equal(selection.usedFallback, true);
    assert.deepEqual(selection.canonicalChunks.map((chunk) => chunk.id), ['behavioral-error-3-1']);
});

test('canonical generation source does not use manual atom registry as requirements source', () => {
    const selection = selectCanonicalMainChunks([
        {
            id: 'meta-1',
            chunk_type: CHUNK_TYPES.DOCUMENT_META,
            chunk_granularity: 'atomic',
            retrieval_class: RETRIEVAL_CLASSES.REFERENCE_CONTEXT,
            eligibility_status: ELIGIBILITY_STATUSES.EXCLUDED,
            exclude_from_retrieval: true,
            cleaned_text: 'Wrapper page metadata'
        }
    ]);

    const resolved = resolveCanonicalGenerationSource({
        selection,
        manualAtomRegistry: {
            documentId: '244357919',
            coverageSource: 'manual_atom_registry',
            coverageUnits: [
                {
                    stableId: '244357919:REQ-001',
                    atom_id: 'REQ-001',
                    source_section: '3.1.1',
                    sectionPath: ['3.1.1'],
                    mode: 'INN input',
                    action: 'call IFNS method',
                    condition: 'user entered four INN symbols',
                    expected_result: 'request sends first four symbols in code query parameter',
                    method_ref: 'Method 1',
                    method_name: 'IFNS',
                    http_method: 'GET',
                    endpoint: '/public/json?service=ifns&code={code}',
                    request_params: 'service=ifns, code={first4InnChars}',
                    response_params: '',
                    type: 'API_CONTRACT',
                    target_level: 'C2_C3_FRONTEND',
                    text: 'call IFNS method\nuser entered four INN symbols\nrequest sends first four symbols in code query parameter',
                    contentHash: 'hash-1'
                }
            ]
        },
        documentId: '244357919',
        docTitle: 'Wrapper page'
    });

    assert.equal(resolved.usedManualAtomRegistryFallback, false);
    assert.equal(resolved.usedAuxiliaryGenerationFallback, false);
    assert.equal(resolved.generationSource, 'none');
    assert.equal(resolved.canonicalChunks.length, 0);
    assert.equal(resolved.indexableChunks.length, 0);
});

test('canonical generation source falls back to linked retrievable chunks when main page is wrapper-only', () => {
    const selection = selectCanonicalMainChunks([
        {
            id: 'meta-1',
            chunk_type: CHUNK_TYPES.DOCUMENT_META,
            chunk_granularity: 'atomic',
            retrieval_class: RETRIEVAL_CLASSES.REFERENCE_CONTEXT,
            eligibility_status: ELIGIBILITY_STATUSES.EXCLUDED,
            exclude_from_retrieval: true,
            cleaned_text: 'Wrapper page metadata'
        }
    ]);
    const linkedBehavioralChunk = createBehavioralChunk({
        id: 'linked-req-1',
        doc_id: 'linked-doc-1',
        doc_title: 'Linked requirements',
        source_type: 'linked',
        cleaned_text: 'User enters four INN symbols and IFNS request sends code query parameter.',
        core_text: 'User enters four INN symbols and IFNS request sends code query parameter.',
        segment_text: 'User enters four INN symbols and IFNS request sends code query parameter.'
    });

    const resolved = resolveCanonicalGenerationSource({
        selection,
        manualAtomRegistry: {
            documentId: '244357919',
            coverageSource: 'manual_atom_registry',
            coverageUnits: [
                {
                    stableId: '244357919:REQ-001',
                    atom_id: 'REQ-001',
                    text: 'manual atom text must not be used for generation'
                }
            ]
        },
        linkedDocs: [
            {
                docId: 'linked-doc-1',
                title: 'Linked requirements',
                canonicalChunks: [linkedBehavioralChunk]
            }
        ],
        documentId: '244357919',
        docTitle: 'Wrapper page'
    });

    assert.equal(resolved.usedManualAtomRegistryFallback, false);
    assert.equal(resolved.usedAuxiliaryGenerationFallback, true);
    assert.equal(resolved.generationSource, 'auxiliary_canonical_chunks');
    assert.equal(resolved.canonicalChunks.length, 1);
    assert.equal(resolved.indexableChunks.length, 0);
    assert.equal(isMainDocumentIndexCandidate(resolved.canonicalChunks[0]), true);
    assert.equal(resolved.canonicalChunks[0].id, 'linked-req-1');
    assert.doesNotMatch(resolved.canonicalChunks[0].segment_text, /manual atom text/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildEnrichmentQuery,
    isBehavioralRetrievalCandidate,
    rerankRetrievedChunksByMetadata
} from '../behavioralRetrieval.mjs';
import {
    CHUNK_TYPES,
    ELIGIBILITY_STATUSES,
    RETRIEVAL_CLASSES
} from '../semanticChunking.mjs';

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

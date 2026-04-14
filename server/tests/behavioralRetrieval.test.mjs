import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEnrichmentQuery, rerankRetrievedChunksByMetadata } from '../behavioralRetrieval.mjs';

test('rerank prioritizes screen scope over unstable row number tie-breaker', () => {
    const segment = {
        heading: 'Login',
        text: 'Submit login form',
        retrievalProfile: {
            screen_scopes: ['Login screen'],
            entity_scopes: ['Submit button'],
            section_numbers: ['4'],
            row_numbers: ['7']
        }
    };

    const wrongScreenSameRow = {
        id: 'chunk-a',
        score: 0.91,
        aux_metadata: {
            screen_scope: 'Profile screen',
            entity_scope: 'Submit button',
            section_number: '4',
            row_number: '7'
        }
    };

    const rightScreenDifferentRow = {
        id: 'chunk-b',
        score: 0.9,
        aux_metadata: {
            screen_scope: 'Login screen',
            entity_scope: 'Submit button',
            section_number: '4',
            row_number: '99'
        }
    };

    const reranked = rerankRetrievedChunksByMetadata(
        [wrongScreenSameRow, rightScreenDifferentRow],
        segment
    );

    assert.equal(reranked[0].id, 'chunk-b');
    assert.ok(reranked[0].metadataBoost > reranked[1].metadataBoost);
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

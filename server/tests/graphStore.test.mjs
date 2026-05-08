import test from 'node:test';
import assert from 'node:assert/strict';

import { upsertRelationships } from '../graphStore.mjs';

function createFakeSession({ matched = true } = {}) {
    const runs = [];
    return {
        runs,
        async run(query, params) {
            runs.push({ query, params });
            return { summary: { counters: { updates: () => ({ relationshipsCreated: matched ? 1 : 0 }) } } };
        },
        async close() {}
    };
}

test('upsertRelationships skips relationships with invalid endpoint node types', async () => {
    const session = createFakeSession();

    const report = await upsertRelationships([
        {
            fromName: 'Rule',
            fromType: 'NotANode',
            toName: 'Button',
            toType: 'UIElement',
            relType: 'CONTROLS_UI'
        }
    ], 'session-1', { session });

    assert.equal(report.created, 0);
    assert.equal(report.skippedInvalidType, 1);
    assert.equal(session.runs.length, 0);
});

test('upsertRelationships does not count missing endpoint matches as created', async () => {
    const session = createFakeSession({ matched: false });

    const report = await upsertRelationships([
        {
            fromName: 'Rule',
            fromType: 'BusinessRule',
            toName: 'Missing button',
            toType: 'UIElement',
            relType: 'CONTROLS_UI'
        }
    ], 'session-1', { session });

    assert.equal(report.created, 0);
    assert.equal(report.skippedMissingEndpoint, 1);
    assert.equal(session.runs.length, 1);
});

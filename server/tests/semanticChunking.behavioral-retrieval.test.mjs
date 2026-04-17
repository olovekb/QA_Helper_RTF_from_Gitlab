import test from 'node:test';
import assert from 'node:assert/strict';

import {
    chunkify,
    CHUNK_TYPES,
    RETRIEVAL_CLASSES,
    ELIGIBILITY_STATUSES
} from '../semanticChunking.mjs';
import { isBehavioralRetrievalCandidate } from '../behavioralRetrieval.mjs';

async function chunkifyRequirement(markdown) {
    return chunkify(markdown, {
        pageId: 'test-page',
        title: 'Behavioral retrieval fixture'
    });
}

function byType(chunks, type) {
    return chunks.filter((chunk) => chunk.chunk_type === type);
}

test('row dual-write keeps summary+legacy debug chunks excluded and atomic rules retrievable', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 1 | Login button | On Login screen the Login button is enabled when both fields are filled. |
`;

    const chunks = await chunkifyRequirement(markdown);

    const summaries = byType(chunks, CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY);
    const legacyRows = byType(chunks, CHUNK_TYPES.REQUIREMENT_ROW);
    const atomicRules = byType(chunks, CHUNK_TYPES.ATOMIC_RULE);

    assert.equal(summaries.length, 1);
    assert.equal(legacyRows.length, 1);
    assert.equal(atomicRules.length, 1);

    const summary = summaries[0];
    const legacy = legacyRows[0];
    const atomic = atomicRules[0];

    assert.equal(summary.chunk_granularity, 'summary');
    assert.equal(summary.retrieval_class, RETRIEVAL_CLASSES.REFERENCE_CONTEXT);
    assert.equal(summary.eligibility_status, ELIGIBILITY_STATUSES.EXCLUDED);
    assert.equal(summary.exclude_from_retrieval, true);
    assert.equal(summary.exclude_from_graph, true);

    assert.equal(legacy.chunk_granularity, 'summary');
    assert.equal(legacy.retrieval_class, RETRIEVAL_CLASSES.REFERENCE_CONTEXT);
    assert.equal(legacy.eligibility_status, ELIGIBILITY_STATUSES.EXCLUDED);
    assert.equal(legacy.exclude_from_retrieval, true);
    assert.equal(legacy.exclude_from_graph, true);

    assert.equal(atomic.chunk_granularity, 'atomic');
    assert.equal(atomic.retrieval_class, RETRIEVAL_CLASSES.BEHAVIORAL);
    assert.equal(atomic.exclude_from_retrieval, false);
    assert.equal(atomic.parent_row_number, '1');
    assert.ok(atomic.atomic_rule_kind);

    assert.equal(atomic.lineage_parent_summary_id, summary.id);
    assert.ok(Array.isArray(summary.lineage_child_rule_ids));
    assert.ok(summary.lineage_child_rule_ids.includes(atomic.id));
});

test('dual-write does not produce dual-index candidates', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 1 | Status badge | If status = decline show decline reason. If status = end show end state. |
`;

    const chunks = await chunkifyRequirement(markdown);

    const indexCandidates = chunks.filter((chunk) =>
        !chunk.exclude_from_retrieval &&
        !chunk.metadata?.exclude_from_retrieval
    );

    assert.ok(indexCandidates.length >= 2);
    assert.ok(indexCandidates.every((chunk) => chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE));
    assert.ok(indexCandidates.every((chunk) => chunk.chunk_granularity === 'atomic'));
    assert.ok(indexCandidates.every((chunk) => chunk.eligibility_status !== ELIGIBILITY_STATUSES.EXCLUDED));
});

test('atomic embedding_text is cleaned from service wrappers', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 2 | Login button | On Login screen the Login button is enabled when both fields are filled. API dependency: POST /login. Relevant params: username, password. Reference: figma/login. |
`;

    const chunks = await chunkifyRequirement(markdown);
    const atomicRules = byType(chunks, CHUNK_TYPES.ATOMIC_RULE);

    assert.equal(atomicRules.length, 1);

    const atomic = atomicRules[0];
    assert.match(atomic.embedding_text, /enabled when both fields are filled/i);
    assert.doesNotMatch(atomic.embedding_text, /Requirement row:|Behavior:|API dependency:|Relevant params:|Reference:/i);
    assert.equal(atomic.aux_metadata.endpoint, 'POST /login');
});

test('multi-rule row is split into multiple atomic rules with minimal v1 taxonomy', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 3 | Password field | If the password is invalid, an error message is shown. 1.1 If status = decline, show decline reason. 1.2 If status = end, show end badge. If null, show empty state. If absent, hide block. Sort by createdAt desc. |
`;

    const chunks = await chunkifyRequirement(markdown);
    const atomicRules = byType(chunks, CHUNK_TYPES.ATOMIC_RULE);

    assert.ok(atomicRules.length >= 5);

    const kinds = new Set(atomicRules.map((chunk) => chunk.atomic_rule_kind));
    assert.ok(kinds.has('error_rule'));
    assert.ok(kinds.has('status_rule'));
    assert.ok(kinds.has('absence_rule'));
    assert.ok(kinds.has('ordering_rule'));

    const declineRule = atomicRules.find((chunk) => /status\s*=\s*decline/i.test(chunk.embedding_text));
    const endRule = atomicRules.find((chunk) => /status\s*=\s*end/i.test(chunk.embedding_text));

    assert.ok(declineRule);
    assert.ok(endRule);
    assert.doesNotMatch(declineRule.embedding_text, /status\s*=\s*end/i);
    assert.doesNotMatch(endRule.embedding_text, /status\s*=\s*decline/i);
});

test('BUSINESS_CONTEXT and SCOPE_CONTEXT stay background-only and excluded', async () => {
    const markdown = `# Requirements

## Business context
В рамках данного раздела необходимо описать только общий обзор процесса.

## Scope
Область применения: только web-канал и мобильный канал.

## Functional behavior
Система отображает кнопку Continue для валидного клиента.
`;

    const chunks = await chunkifyRequirement(markdown);

    const backgroundChunks = chunks.filter((chunk) =>
        [CHUNK_TYPES.BUSINESS_CONTEXT, CHUNK_TYPES.SCOPE_CONTEXT].includes(chunk.chunk_type)
    );

    assert.ok(backgroundChunks.length >= 1);
    assert.ok(backgroundChunks.every((chunk) => chunk.exclude_from_retrieval === true));
    assert.ok(backgroundChunks.every((chunk) => chunk.eligibility_status === ELIGIBILITY_STATUSES.EXCLUDED));
});

test('legacy and summary row chunks are never behavioral candidates', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 4 | Limit field | If value is null, show empty state. If status = decline, show decline reason. |
`;

    const chunks = await chunkifyRequirement(markdown);
    const behavioralCandidates = chunks.filter((chunk) => isBehavioralRetrievalCandidate(chunk));

    assert.ok(behavioralCandidates.length >= 1);
    assert.ok(behavioralCandidates.every((chunk) => chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE));
    assert.ok(chunks.some((chunk) => chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW));
    assert.ok(chunks.some((chunk) => chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY));
    assert.ok(chunks.filter((chunk) => isBehavioralRetrievalCandidate(chunk)).every((chunk) => chunk.chunk_granularity === 'atomic'));
});

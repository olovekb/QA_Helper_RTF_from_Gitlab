import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkify, RETRIEVAL_CLASSES } from '../semanticChunking.mjs';

async function chunkifyRequirement(markdown) {
    return chunkify(markdown, {
        pageId: 'test-page',
        title: 'Behavioral retrieval fixture'
    });
}

test('requirement row keeps behavioral core text and moves service context into metadata', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 1 | Login button | On Login screen the Login button is enabled when both fields are filled. API dependency: POST /login. Relevant params: username, password. Reference: figma/login. |
`;

    const chunks = await chunkifyRequirement(markdown);

    assert.equal(chunks.length, 1);
    const [chunk] = chunks;

    assert.equal(chunk.chunk_type, 'requirement_row');
    assert.equal(chunk.retrieval_class, RETRIEVAL_CLASSES.BEHAVIORAL);
    assert.equal(chunk.eligibility_status, 'eligible');
    assert.match(chunk.core_text, /Login button/i);
    assert.match(chunk.core_text, /enabled when both fields are filled/i);
    assert.doesNotMatch(chunk.core_text, /API dependency|Relevant params|Reference/i);
    assert.equal(chunk.aux_metadata.endpoint, 'POST /login');
    assert.equal(chunk.aux_metadata.row_number, '1');
    assert.equal(chunk.aux_metadata.entity_scope, 'Login button');
});

test('mixed numbered requirement splits only scenario seed and keeps display detail in metadata', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 2 | Password field | If the password is invalid, an error message is shown. 1. The error text is red. 2. If the password is empty, the field shows "Password is required". |
`;

    const chunks = await chunkifyRequirement(markdown);

    assert.equal(chunks.length, 1);
    const [chunk] = chunks;

    assert.equal(chunk.chunk_type, 'scenario_branch');
    assert.match(chunk.core_text, /Password is required/i);
    assert.doesNotMatch(chunk.core_text, /error text is red/i);
    assert.deepEqual(chunk.aux_metadata.display_rules, ['The error text is red.']);
    assert.equal(chunk.aux_metadata.branch_label, '2');
});

test('scenario seed branches are split selectively into separate behavioral chunks', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 3 | Username field | If the username is invalid, an error is shown. 1. If the username is empty, the field shows "Required". 2. If the username contains spaces, the field shows "Invalid format". |
`;

    const chunks = await chunkifyRequirement(markdown);

    assert.equal(chunks.length, 2);
    assert.ok(chunks.every(chunk => chunk.chunk_type === 'scenario_branch'));
    assert.ok(chunks.every(chunk => chunk.retrieval_class === RETRIEVAL_CLASSES.BEHAVIORAL));
    assert.match(chunks[0].core_text, /Required/);
    assert.match(chunks[1].core_text, /Invalid format/);
});

test('negative and success branches with different outcomes stay as separate chunks', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 4 | Submit action | 1. If the service times out, an error message is shown. 2. If the request succeeds, a confirmation message is shown. |
`;

    const chunks = await chunkifyRequirement(markdown);

    assert.equal(chunks.length, 2);
    assert.match(chunks[0].core_text, /error message is shown/i);
    assert.match(chunks[1].core_text, /confirmation message is shown/i);
    assert.notEqual(chunks[0].core_text, chunks[1].core_text);
});

test('api-heavy section is classified into api_context instead of behavioral retrieval', async () => {
    const markdown = `# API section

## Change password API
POST /passwd/change

Request body:
- username
- oldPassword
- newPassword

Possible errors:
- 400 Bad request
- 403 Forbidden
`;

    const chunks = await chunkifyRequirement(markdown);

    assert.ok(chunks.length >= 1);
    assert.ok(chunks.every(chunk => chunk.retrieval_class === RETRIEVAL_CLASSES.API_CONTEXT));
    assert.ok(chunks.every(chunk => chunk.chunk_type !== 'requirement_row'));
});


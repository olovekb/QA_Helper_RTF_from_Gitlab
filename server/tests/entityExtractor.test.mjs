import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GRAPH_ENTITY_EXTRACTION_MODELS,
    extractEntitiesFromChunks
} from '../entityExtractor.mjs';

function createResponse(content, finishReason = 'stop') {
    return {
        choices: [{
            finish_reason: finishReason,
            message: { content }
        }]
    };
}

const requirementChunk = {
    text: 'Requirement row: Login button Behavior: Login button is enabled when both fields are filled.',
    content: 'Requirement row: Login button Behavior: Login button is enabled when both fields are filled.',
    chunkId: 'chunk-1',
    position: 0
};

test('extractEntitiesFromChunks falls back to the secondary graph extraction model after invalid JSON', async () => {
    const calls = [];
    const llmClient = async (_messages, options) => {
        calls.push(options.model);
        if (calls.length === 1) {
            return createResponse('not json');
        }

        return createResponse(JSON.stringify({
            entities: [{
                type: 'UIElement',
                name: 'Login button',
                properties: { description: 'Button enabled after valid input' }
            }],
            relationships: []
        }));
    };

    const result = await extractEntitiesFromChunks([requirementChunk], {
        sessionId: 'session-1',
        documentId: 'doc-1',
        llmClient
    });

    assert.deepEqual(calls, GRAPH_ENTITY_EXTRACTION_MODELS);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].sourceChunkId, 'chunk-1');
    assert.equal(result.diagnostics.chunksSucceeded, 1);
    assert.equal(result.diagnostics.chunksFailed, 0);
    assert.equal(result.diagnostics.chunkResults[0].modelUsed, GRAPH_ENTITY_EXTRACTION_MODELS[1]);
    assert.equal(result.diagnostics.parseErrors, 1);
});

test('extractEntitiesFromChunks falls back after empty primary model content', async () => {
    const calls = [];
    const llmClient = async (_messages, options) => {
        calls.push(options);
        if (calls.length === 1) {
            return createResponse('');
        }

        return createResponse(JSON.stringify({
            entities: [{
                type: 'ScenarioSeed',
                name: 'Login with filled credentials',
                properties: { description: 'User can log in after both fields are filled' }
            }],
            relationships: []
        }));
    };

    const result = await extractEntitiesFromChunks([requirementChunk], {
        sessionId: 'session-1',
        documentId: 'doc-1',
        llmClient
    });

    assert.deepEqual(calls.map(call => call.model), GRAPH_ENTITY_EXTRACTION_MODELS);
    assert.equal(calls[0].useResponseFormatForCloudRu, true);
    assert.equal(calls[1].useResponseFormatForCloudRu, true);
    assert.equal(result.entities.length, 1);
    assert.equal(result.diagnostics.emptyResponses, 1);
    assert.equal(result.diagnostics.chunkResults[0].modelUsed, GRAPH_ENTITY_EXTRACTION_MODELS[1]);
});

test('extractEntitiesFromChunks does not call fallback when primary model returns entities', async () => {
    const calls = [];
    const llmClient = async (_messages, options) => {
        calls.push(options.model);
        return createResponse(JSON.stringify({
            entities: [{
                type: 'BusinessRule',
                name: 'Both fields must be filled',
                properties: { description: 'Both fields are required' }
            }],
            relationships: []
        }));
    };

    const result = await extractEntitiesFromChunks([requirementChunk], {
        sessionId: 'session-1',
        documentId: 'doc-1',
        llmClient
    });

    assert.deepEqual(calls, [GRAPH_ENTITY_EXTRACTION_MODELS[0]]);
    assert.equal(result.entities.length, 1);
    assert.equal(result.diagnostics.chunksSucceeded, 1);
    assert.equal(result.diagnostics.chunkResults[0].modelUsed, GRAPH_ENTITY_EXTRACTION_MODELS[0]);
});

test('extractEntitiesFromChunks reports failed chunks when both graph extraction models fail', async () => {
    const calls = [];
    const llmClient = async (_messages, options) => {
        calls.push(options.model);
        return createResponse('');
    };

    const result = await extractEntitiesFromChunks([requirementChunk], {
        sessionId: 'session-1',
        documentId: 'doc-1',
        llmClient
    });

    assert.deepEqual(calls, GRAPH_ENTITY_EXTRACTION_MODELS);
    assert.equal(result.entities.length, 0);
    assert.equal(result.relationships.length, 0);
    assert.equal(result.diagnostics.chunksSucceeded, 0);
    assert.equal(result.diagnostics.chunksFailed, 1);
    assert.equal(result.diagnostics.emptyResponses, 2);
    assert.equal(result.diagnostics.chunkResults[0].status, 'failed');
});

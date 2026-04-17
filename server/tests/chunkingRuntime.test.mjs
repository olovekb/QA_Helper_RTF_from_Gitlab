import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_CHUNKING_MODEL,
    resolveModelsToTry,
    resolveChunkingModel,
    buildConfluenceChunkIndexCacheKey,
    computeAdaptiveLinkedDocLimit,
    selectAdaptiveLinkedDocs,
    getCanonicalDegradationProfile
} from '../chunkingRuntime.mjs';

test('resolveModelsToTry prioritizes selected model and appends configured fallback models', () => {
    const modelsToTry = resolveModelsToTry(
        ['qwen/qwen3-235b-a22b:free'],
        ['qwen/qwen3-30b-a3b:free', 'qwen/qwen3-235b-a22b:free', 'google/gemini-2.5-flash-preview']
    );

    assert.deepEqual(modelsToTry, [
        'qwen/qwen3-235b-a22b:free',
        'qwen/qwen3-30b-a3b:free',
        'google/gemini-2.5-flash-preview'
    ]);
});

test('resolveChunkingModel falls back to default model when modelsToTry is empty', () => {
    assert.equal(resolveChunkingModel([]), DEFAULT_CHUNKING_MODEL);
    assert.equal(resolveChunkingModel(['  ']), DEFAULT_CHUNKING_MODEL);
});

test('cache key includes chunking model to prevent cross-model cache hits', () => {
    const firstKey = buildConfluenceChunkIndexCacheKey({
        sourceType: 'main',
        docId: '12345',
        chunkingModel: 'model-a'
    });
    const secondKey = buildConfluenceChunkIndexCacheKey({
        sourceType: 'main',
        docId: '12345',
        chunkingModel: 'model-b'
    });

    assert.notEqual(firstKey, secondKey);
});

test('adaptive linked scope increases with main chunk count but respects maximum', () => {
    const limitSmall = computeAdaptiveLinkedDocLimit({
        mainChunkCount: 4,
        linkedDocCount: 10,
        baseLimit: 3,
        maxLimit: 8,
        chunksPerDocStep: 6
    });
    const limitLarge = computeAdaptiveLinkedDocLimit({
        mainChunkCount: 42,
        linkedDocCount: 10,
        baseLimit: 3,
        maxLimit: 8,
        chunksPerDocStep: 6
    });

    assert.equal(limitSmall, 4);
    assert.equal(limitLarge, 8);
});

test('selectAdaptiveLinkedDocs returns selected subset and omitted count', () => {
    const docs = new Array(9).fill(null).map((_, index) => ({ id: index + 1 }));
    const result = selectAdaptiveLinkedDocs(docs, {
        mainChunkCount: 12,
        baseLimit: 3,
        maxLimit: 6,
        chunksPerDocStep: 6
    });

    assert.equal(result.limit, 5);
    assert.equal(result.selectedDocs.length, 5);
    assert.equal(result.omittedCount, 4);
});

test('canonical degradation profile switches to critical mode with strict settings', () => {
    const profile = getCanonicalDegradationProfile({ mode: 'critical' });

    assert.equal(profile.mode, 'critical');
    assert.equal(profile.maxSegmentLlmAttempts, 1);
    assert.equal(profile.skipTargetedRefinement, true);
    assert.equal(profile.linkedDocLimitScale, 0.5);
    assert.ok(profile.contextCharBudget < 9000);
});

test('canonical degradation profile keeps full linked scope in normal mode', () => {
    const profile = getCanonicalDegradationProfile({ mode: 'normal' });

    assert.equal(profile.mode, 'normal');
    assert.equal(profile.linkedDocLimitScale, 1);
});

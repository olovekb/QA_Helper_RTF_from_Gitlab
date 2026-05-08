import test from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveCloudRuApiKey,
    resolveCloudRuRequestPolicy,
    resolveCloudRuHybridAttemptPolicy
} from '../cloudruClient.mjs';

test('resolveCloudRuApiKey ignores redacted legacy key and uses nested Cloud.ru key', () => {
    const apiKey = resolveCloudRuApiKey({
        cloudruApiKey: '__REDACTED__',
        cloudru: {
            apiKey: 'valid.cloudru-secret'
        }
    }, {});

    assert.equal(apiKey, 'valid.cloudru-secret');
});

test('resolveCloudRuApiKey prefers environment key over config values', () => {
    const apiKey = resolveCloudRuApiKey({
        cloudruApiKey: 'legacy.config-key',
        cloudru: {
            apiKey: 'nested.config-key'
        }
    }, {
        CLOUDRU_API_KEY: 'env.cloudru-key'
    });

    assert.equal(apiKey, 'env.cloudru-key');
});

test('resolveCloudRuRequestPolicy uses fail-fast defaults instead of 15 minute waits', () => {
    const policy = resolveCloudRuRequestPolicy({}, {});

    assert.equal(policy.requestTimeoutMs, 180000);
    assert.equal(policy.maxAttempts, 2);
    assert.equal(policy.hybridMaxAttempts, 1);
});

test('resolveCloudRuRequestPolicy allows config and env overrides', () => {
    const configPolicy = resolveCloudRuRequestPolicy({
        cloudru: {
            requestTimeoutMs: 240000,
            maxAttempts: 3,
            hybridMaxAttempts: 2
        }
    }, {});

    assert.deepEqual(configPolicy, {
        requestTimeoutMs: 240000,
        maxAttempts: 3,
        hybridMaxAttempts: 2
    });

    const envPolicy = resolveCloudRuRequestPolicy({
        cloudru: {
            requestTimeoutMs: 240000,
            maxAttempts: 3,
            hybridMaxAttempts: 2
        }
    }, {
        CLOUDRU_REQUEST_TIMEOUT_MS: '90000',
        CLOUDRU_MAX_ATTEMPTS: '1',
        CLOUDRU_HYBRID_MAX_ATTEMPTS: '1'
    });

    assert.deepEqual(envPolicy, {
        requestTimeoutMs: 90000,
        maxAttempts: 1,
        hybridMaxAttempts: 1
    });
});

test('resolveCloudRuHybridAttemptPolicy caps per-call timeout to remaining Cloud-first budget', () => {
    const attemptPolicy = resolveCloudRuHybridAttemptPolicy({
        basePolicy: {
            requestTimeoutMs: 180000,
            maxAttempts: 2,
            hybridMaxAttempts: 1
        },
        remainingMs: 45000
    });

    assert.equal(attemptPolicy.requestTimeoutMs, 45000);
    assert.equal(attemptPolicy.maxAttempts, 1);
});

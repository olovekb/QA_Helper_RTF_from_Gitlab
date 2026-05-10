import test from 'node:test';
import assert from 'node:assert/strict';

import * as comparison from '../metrics/test-case-comparison.mjs';

test('test case comparison exposes the configured BERTScore match thresholds', () => {
    assert.equal(comparison.MATCH_THRESHOLDS?.strong, 0.79);
    assert.equal(comparison.MATCH_THRESHOLDS?.weak, 0.70);
});

test('valid generated cases become strong at the strong BERTScore threshold', () => {
    assert.equal(comparison.classifyPair?.(0.79, { valid: true }), 'strong');
    assert.equal(comparison.classifyPair?.(0.7899, { valid: true }), 'weak');
});

test('semantically strong invalid generated cases are classified between strong and weak', () => {
    assert.equal(comparison.classifyPair?.(0.79, { valid: false }), 'semanticStrong');
    assert.equal(comparison.isCoveredMatchClass?.('semanticStrong'), true);
    assert.equal(comparison.isCoveredMatchClass?.('mismatch'), false);
});

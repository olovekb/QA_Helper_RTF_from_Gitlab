import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCanonicalQualityRetryInstruction,
    classifyCanonicalQualityOutcome,
    coerceQualityGateRetryModelFragment,
    runPostValidationQualityCheck
} from '../canonical-quality-gate.mjs';

function chunk(id, text, sectionPath) {
    return {
        id,
        doc_id: 'doc-flow',
        chunk_type: 'atomic_rule',
        cleaned_text: text,
        section_path: sectionPath,
        requirement_id: id,
        parent_row_number: id,
        metadata: {
            source_row_id: id,
            atomic_rule_index: 1
        }
    };
}

function modelForRequirement(requirementId, text, count = 1) {
    return [
        {
            id: 'f-1',
            text: 'Feature flow',
            stories: Array.from({ length: count }, (_, index) => ({
                id: `st-${index}`,
                text: `Story ${index}`,
                scenarios: [
                    {
                        id: `sc-${index}`,
                        text: `Scenario ${index}`,
                        codes: [
                            { id: `c-${index}-1`, text: `${requirementId} ${text} frontend`, type: 'frontend' },
                            { id: `c-${index}-2`, text: `${requirementId} ${text} backend`, type: 'backend' }
                        ]
                    }
                ]
            }))
        }
    ];
}

test('non-catastrophic scale miss cannot produce passed outcome', () => {
    const outcome = classifyCanonicalQualityOutcome({
        scaleGate: { passed: false, catastrophic: false },
        requirementCoverage: { status: 'passed' }
    });

    assert.equal(outcome, 'needs_review');
});

test('catastrophic scale miss degrades non-empty model quality instead of failing coverage outcome', () => {
    const outcome = classifyCanonicalQualityOutcome({
        scaleGate: { passed: false, catastrophic: true },
        requirementCoverage: { status: 'needs_review' }
    });

    assert.equal(outcome, 'degraded_quality');
});

test('model with enough branches can pass scale gate and degrade semantic coverage without failing task quality', async () => {
    const chunks = [
        chunk('REQ-A1', 'REQ-A1 approve payment with OTP.', ['A. Payments']),
        chunk('REQ-A2', 'REQ-A2 reject payment without OTP.', ['A. Payments']),
        chunk('REQ-B1', 'REQ-B1 export report as PDF.', ['B. Reports']),
        chunk('REQ-B2', 'REQ-B2 send report by email.', ['B. Reports'])
    ];
    const model = modelForRequirement('REQ-A1', 'approve payment with OTP', 8);

    const check = await runPostValidationQualityCheck({
        model,
        canonicalChunks: chunks,
        segmentResults: Array.from({ length: 4 }, () => model),
        generationSegmentCount: 4,
        canonicalChunkCount: 4,
        apiKey: 'fake-key',
        embeddingClient: async (text) => String(text).includes('REQ-A') ? [1, 0, 0] : [0, 1, 0],
        coverageConfig: {
            thresholds: { covered: 0.7, partial: 0.52 }
        }
    });

    assert.equal(check.scaleGate.passed, true);
    assert.equal(check.requirementCoverage.status, 'degraded_quality');
    assert.equal(check.outcome, 'degraded_quality');
});

test('postValidationQualityCheck catches coverage loss after dedupe or repair', async () => {
    const chunks = [
        chunk('REQ-1', 'REQ-1 create draft order.', ['1. Orders']),
        chunk('REQ-2', 'REQ-2 submit draft order.', ['1. Orders'])
    ];
    const finalModelAfterDedupe = modelForRequirement('REQ-1', 'create draft order', 4);

    const check = await runPostValidationQualityCheck({
        model: finalModelAfterDedupe,
        canonicalChunks: chunks,
        segmentResults: Array.from({ length: 2 }, () => finalModelAfterDedupe),
        generationSegmentCount: 2,
        canonicalChunkCount: 2,
        apiKey: 'fake-key',
        embeddingClient: async (text) => String(text).includes('REQ-1') ? [1, 0, 0] : [0, 1, 0]
    });

    assert.equal(check.requirementCoverage.uncoveredRequirementUnits.length, 1);
    assert.equal(check.requirementCoverage.uncoveredRequirementUnits[0].sourceRowId, 'REQ-2');
    assert.equal(check.outcome, 'degraded_quality');
});

test('retry prompt contains section summary and section-balanced uncovered examples', async () => {
    const chunks = [
        chunk('REQ-1', 'REQ-1 covered behavior.', ['1. Accounts']),
        chunk('REQ-2', 'REQ-2 missed accounts behavior.', ['1. Accounts']),
        chunk('REQ-3', 'REQ-3 missed reports behavior.', ['2. Reports'])
    ];
    const model = modelForRequirement('REQ-1', 'covered behavior', 3);

    const check = await runPostValidationQualityCheck({
        model,
        canonicalChunks: chunks,
        segmentResults: Array.from({ length: 3 }, () => model),
        generationSegmentCount: 3,
        canonicalChunkCount: 3,
        apiKey: 'fake-key',
        embeddingClient: async (text) => String(text).includes('REQ-1') ? [1, 0, 0] : [0, 1, 0]
    });

    const prompt = buildCanonicalQualityRetryInstruction({
        scaleGate: check.scaleGate,
        requirementCoverage: check.requirementCoverage,
        maxExamples: 2
    });

    assert.match(prompt, /Uncovered requirements by section/);
    assert.match(prompt, /1\. Accounts: 1/);
    assert.match(prompt, /2\. Reports: 1/);
    assert.match(prompt, /Already covered branch signatures/);
    assert.match(prompt, /REQ-2/);
    assert.match(prompt, /REQ-3/);
}
);

test('quality retry coercion wraps flat GigaChat-like scenario fragments into full hierarchy', () => {
    const coerced = coerceQualityGateRetryModelFragment([
        {
            id: 'flat-1',
            text: 'Нажать на кнопку "Подробнее" в таблице сотрудников',
            codes: [
                {
                    id: 'code-1',
                    text: 'Отображается алерт ошибки реестра',
                    type: 'frontend'
                }
            ]
        }
    ]);

    assert.equal(coerced.length, 1);
    assert.ok(Array.isArray(coerced[0].stories));
    assert.ok(Array.isArray(coerced[0].stories[0].scenarios));
    assert.equal(coerced[0].stories[0].scenarios[0].text, 'Нажать на кнопку "Подробнее" в таблице сотрудников');
    assert.equal(coerced[0].stories[0].scenarios[0].codes[0].text, 'Отображается алерт ошибки реестра');
});

test('quality retry coercion accepts GigaChat object-map scenarios', () => {
    const coerced = coerceQualityGateRetryModelFragment([
        {
            id: 'feature-id',
            text: 'Feature payroll registries',
            stories: [
                {
                    id: 'story-id',
                    text: 'Registry details',
                    scenarios: {
                        'scenario-id': {
                            id: 'scenario-id',
                            text: 'Open registry details',
                            codes: [
                                {
                                    id: 'code-id',
                                    text: 'Registry details are displayed',
                                    type: 'frontend'
                                }
                            ]
                        }
                    }
                }
            ]
        }
    ]);

    assert.ok(Array.isArray(coerced[0].stories));
    assert.ok(Array.isArray(coerced[0].stories[0].scenarios));
    assert.equal(coerced[0].stories[0].scenarios[0].text, 'Open registry details');
    assert.equal(coerced[0].stories[0].scenarios[0].codes[0].text, 'Registry details are displayed');
});

test('post-retry scale check can ignore stale per-segment results and evaluate merged model scale', async () => {
    const chunks = [
        chunk('REQ-1', 'REQ-1 create draft order.', ['1. Orders']),
        chunk('REQ-2', 'REQ-2 submit draft order.', ['1. Orders'])
    ];
    const mergedModel = modelForRequirement('REQ-1', 'create draft order', 4);

    const check = await runPostValidationQualityCheck({
        model: mergedModel,
        canonicalChunks: chunks,
        generationSegmentCount: 2,
        canonicalChunkCount: 2,
        apiKey: 'fake-key',
        embeddingClient: async (text) => String(text).includes('REQ-1') ? [1, 0, 0] : [0, 1, 0],
        coverageConfig: {
            thresholds: {
                covered: 0.4,
                partial: 0.2,
                hardCoverageRatio: 0.4
            }
        }
    });

    assert.equal(check.scaleGate.checks.find((item) => item.name === 'coveredSegmentCount').skipped, true);
    assert.equal(check.scaleGate.passed, true);
});

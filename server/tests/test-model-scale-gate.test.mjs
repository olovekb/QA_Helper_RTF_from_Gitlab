import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateTestModelScaleGate } from '../test-model-scale-gate.mjs';

function branch(featureText, storyText, scenarioText, codes) {
    return {
        id: `f-${featureText}`,
        text: featureText,
        stories: [
            {
                id: `s-${storyText}`,
                text: storyText,
                scenarios: [
                    {
                        id: `sc-${scenarioText}`,
                        text: scenarioText,
                        codes: codes.map((text, index) => ({
                            id: `c-${scenarioText}-${index}`,
                            text,
                            type: index % 2 === 0 ? 'frontend' : 'backend'
                        }))
                    }
                ]
            }
        ]
    };
}

test('small GigaChat-like model fails the scale gate', () => {
    const tinyModel = [
        branch('Authentication', 'Password reset', 'Request reset link', ['Show reset form']),
        branch('Authentication', 'Password reset', 'Submit reset token', ['POST /password/reset'])
    ];

    const gate = evaluateTestModelScaleGate({
        model: tinyModel,
        segmentResults: [tinyModel, [], null, [], [], [], [], [], [], [], []],
        generationSegmentCount: 11,
        canonicalChunkCount: 83
    });

    assert.equal(gate.passed, false);
    assert.equal(gate.status, 'failed');
    assert.equal(gate.catastrophic, true);
    assert.ok(gate.metrics.scenariosCount < gate.thresholds.minScenariosCount);
    assert.ok(gate.metrics.codesCount < gate.thresholds.minCodesCount);
    assert.ok(gate.failedChecks.some((check) => check.name === 'coveredSegmentCount'));
});

test('near-threshold model fails scale gate without catastrophic failure', () => {
    const model = [
        {
            id: 'f-payroll',
            text: 'Payroll',
            stories: [
                {
                    id: 's-payroll',
                    text: 'Payroll checks',
                    scenarios: Array.from({ length: 10 }, (_, scenarioIndex) => ({
                        id: `sc-${scenarioIndex}`,
                        text: `Scenario ${scenarioIndex}`,
                        codes: Array.from({ length: scenarioIndex < 4 ? 3 : 2 }, (_, codeIndex) => ({
                            id: `c-${scenarioIndex}-${codeIndex}`,
                            text: `Behavior ${scenarioIndex}-${codeIndex}`,
                            type: codeIndex % 2 === 0 ? 'frontend' : 'backend'
                        }))
                    }))
                }
            ]
        }
    ];

    const gate = evaluateTestModelScaleGate({
        model,
        generationSegmentCount: 11,
        canonicalChunkCount: 101
    });

    assert.equal(gate.passed, false);
    assert.equal(gate.status, 'failed');
    assert.equal(gate.catastrophic, false);
    assert.equal(gate.metrics.scenariosCount, 10);
    assert.equal(gate.metrics.codesCount, 24);
    assert.equal(gate.metrics.leafBranchCount, 10);
    assert.deepEqual(gate.failedChecks.map((check) => check.name), ['scenariosCount']);
});

test('Qwen-like model with enough scenarios and codes passes the scale gate', () => {
    const model = [
        {
            id: 'f-payments',
            text: 'Payments',
            stories: Array.from({ length: 7 }, (_, storyIndex) => ({
                id: `s-${storyIndex}`,
                text: `Story ${storyIndex}`,
                scenarios: Array.from({ length: 3 }, (_, scenarioIndex) => ({
                    id: `sc-${storyIndex}-${scenarioIndex}`,
                    text: `Scenario ${storyIndex}-${scenarioIndex}`,
                    codes: [
                        { id: `c-${storyIndex}-${scenarioIndex}-1`, text: 'Frontend behavior', type: 'frontend' },
                        { id: `c-${storyIndex}-${scenarioIndex}-2`, text: 'Backend response', type: 'backend' },
                        { id: `c-${storyIndex}-${scenarioIndex}-3`, text: 'Audit event', type: 'backend' }
                    ]
                }))
            }))
        }
    ];
    const segmentResults = Array.from({ length: 11 }, () => model);

    const gate = evaluateTestModelScaleGate({
        model,
        segmentResults,
        generationSegmentCount: 11,
        canonicalChunkCount: 83
    });

    assert.equal(gate.passed, true);
    assert.equal(gate.status, 'passed');
    assert.equal(gate.catastrophic, false);
    assert.equal(gate.failedChecks.length, 0);
    assert.ok(gate.metrics.leafBranchCount >= gate.thresholds.minLeafBranchCount);
});

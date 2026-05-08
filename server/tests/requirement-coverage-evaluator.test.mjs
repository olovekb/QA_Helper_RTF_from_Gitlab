import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRequirementCoverageRetryInstruction,
    buildRequirementCoverageUnits,
    clearRequirementCoverageEmbeddingCache,
    collectLeafBranches,
    computeHybridMatchScore,
    evaluateRequirementCoverage
} from '../requirement-coverage-evaluator.mjs';

const QWEN = 'Qwen/Qwen3-Embedding-0.6B';
const BGE = 'BAAAI/bge-m3';

function atomicChunk({
    id,
    text,
    sectionPath = ['1. Requirements'],
    sourceRowId = 'REQ-1',
    requirementId = sourceRowId,
    atomicRuleIndex = 1,
    explicitRefs = []
}) {
    return {
        id,
        doc_id: 'doc-1',
        chunk_type: 'atomic_rule',
        cleaned_text: text,
        content: text,
        section_path: sectionPath,
        requirement_id: requirementId,
        parent_row_number: sourceRowId,
        explicit_refs: explicitRefs,
        metadata: {
            source_row_id: sourceRowId,
            atomic_rule_index: atomicRuleIndex
        }
    };
}

function summaryChunk({ id, text, sourceRowId, sectionPath = ['1. Requirements'] }) {
    return {
        id,
        doc_id: 'doc-1',
        chunk_type: 'requirement_row_summary',
        cleaned_text: text,
        section_path: sectionPath,
        requirement_id: sourceRowId,
        parent_row_number: sourceRowId,
        metadata: { source_row_id: sourceRowId }
    };
}

function modelFromBranches(branches) {
    return [
        {
            id: 'f-1',
            text: 'Feature Payments',
            description: 'Feature description',
            stories: branches.map((branch, index) => ({
                id: `st-${index}`,
                text: branch.story || 'Story Payments',
                scenarios: [
                    {
                        id: `sc-${index}`,
                        text: branch.scenario,
                        expectedResult: branch.scenarioExpectedResult,
                        semanticContext: branch.semanticContext,
                        codes: [
                            {
                                id: `c-${index}`,
                                text: branch.code,
                                type: branch.type || 'backend',
                                description: branch.description,
                                expectedResult: branch.expectedResult,
                                semanticContext: branch.codeSemanticContext
                            }
                        ]
                    }
                ]
            }))
        }
    ];
}

function incompleteModelFromScenario({ scenario = 'Open section without code', story = 'Story incomplete' } = {}) {
    return [
        {
            id: 'f-incomplete',
            text: 'Feature incomplete leaves',
            stories: [
                {
                    id: 'st-incomplete',
                    text: story,
                    scenarios: [
                        {
                            id: 'sc-incomplete',
                            text: scenario,
                            codes: []
                        }
                    ]
                }
            ]
        }
    ];
}

function manualUnit({
    atomId,
    action,
    condition = '',
    expectedResult = '',
    type = 'UI_BEHAVIOR',
    targetLevel = 'C1_E2E',
    methodRef = '',
    methodName = '',
    httpMethod = '',
    endpoint = '',
    requestParams = '',
    responseParams = ''
}) {
    const text = [
        action,
        condition,
        expectedResult,
        methodName,
        endpoint,
        requestParams,
        responseParams
    ].filter(Boolean).join(' ');
    const stableId = `doc-manual:${atomId}`;
    return {
        coverageSource: 'manual_atom_registry',
        stableId,
        documentId: 'doc-manual',
        atom_id: atomId,
        sourceRowId: atomId,
        requirementId: atomId,
        source_section: 'Manual section',
        sectionPath: ['Manual section'],
        sectionPathDisplay: 'Manual section',
        sectionPathText: 'manual section',
        mode: 'manual mode',
        action,
        condition,
        expected_result: expectedResult,
        method_ref: methodRef,
        method_name: methodName,
        http_method: httpMethod,
        endpoint,
        request_params: requestParams,
        response_params: responseParams,
        type,
        target_level: targetLevel,
        testable: true,
        include_in_coverage: true,
        requiresCodeLevelBehavior: true,
        requiresApiEvidence: Boolean(methodRef || methodName || httpMethod || endpoint || requestParams || responseParams),
        text,
        normalizedText: text.toLowerCase(),
        textHash: stableId,
        contentHash: `${stableId}:hash`,
        endpoints: endpoint ? [`${httpMethod || 'GET'} ${endpoint}`.trim().toLowerCase()] : [],
        params: [requestParams, responseParams].filter(Boolean).flatMap((value) => String(value).split(/[,\s]+/)).filter(Boolean)
    };
}

function embeddingClientFromMap(map, calls) {
    return async (text, _apiKey, model) => {
        calls.push({ text, model });
        const normalized = String(text).toLowerCase();
        for (const [needle, vector] of map.entries()) {
            if (normalized.includes(needle.toLowerCase())) {
                return vector;
            }
        }
        return [0, 1, 0];
    };
}

test('stableId is reproducible for the same chunks', () => {
    const chunks = [
        atomicChunk({
            id: 'a-1',
            text: 'User must receive an email confirmation.',
            sectionPath: ['1. Auth', '1.1 Reset'],
            sourceRowId: 'REQ-42',
            requirementId: 'REQ-42',
            atomicRuleIndex: 3
        }),
        summaryChunk({
            id: 'row-99',
            text: 'Summary without atomic children.',
            sourceRowId: 'REQ-99'
        })
    ];

    const first = buildRequirementCoverageUnits(chunks);
    const second = buildRequirementCoverageUnits(chunks);

    assert.deepEqual(first.map((unit) => unit.stableId), second.map((unit) => unit.stableId));
    assert.equal(first.length, 2);
    assert.match(first[0].stableId, /^doc-1\|1\. auth > 1\.1 reset\|REQ-42\|3\|[a-f0-9]+$/);
});

test('one coverage run uses one embedding model for all units and branches', async () => {
    clearRequirementCoverageEmbeddingCache();
    const calls = [];
    const chunks = [atomicChunk({ id: 'a-1', text: 'REQ-1 payment is approved after OTP check.' })];
    const model = modelFromBranches([
        {
            scenario: 'Approve payment',
            code: 'REQ-1 approve payment after one-time password check.'
        }
    ]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: embeddingClientFromMap(new Map([['payment', [1, 0, 0]]]), calls)
    });

    assert.equal(coverage.embeddingModelUsed, QWEN);
    assert.equal(coverage.embeddingDisabled, false);
    assert.deepEqual([...new Set(calls.map((call) => call.model))], [QWEN]);
});

test('fallback from Qwen to bge-m3 does not mix embedding models in scoring', async () => {
    clearRequirementCoverageEmbeddingCache();
    const calls = [];
    const chunks = [atomicChunk({ id: 'a-1', text: 'REQ-1 user sees balance.' })];
    const model = modelFromBranches([{ scenario: 'Show balance', code: 'REQ-1 display account balance.' }]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: async (text, _apiKey, modelName) => {
            calls.push({ text, model: modelName });
            if (modelName === QWEN) {
                throw new Error('qwen down');
            }
            return [1, 0, 0];
        }
    });

    assert.equal(coverage.embeddingModelUsed, BGE);
    assert.equal(coverage.embeddingDisabled, false);
    assert.ok(calls.some((call) => call.model === QWEN));
    assert.ok(calls.some((call) => call.model === BGE));
    assert.equal(coverage.traceabilityMap[0].embeddingModelUsed, BGE);
});

test('embeddings are calculated for unique texts, not for every requirement branch pair', async () => {
    clearRequirementCoverageEmbeddingCache();
    const calls = [];
    const chunks = [
        atomicChunk({ id: 'a-1', text: 'REQ-1 duplicated rule text.', sourceRowId: 'REQ-1' }),
        atomicChunk({ id: 'a-2', text: 'REQ-1 duplicated rule text.', sourceRowId: 'REQ-2' })
    ];
    const model = modelFromBranches([
        { story: 'Story duplicate', scenario: 'Scenario duplicate', code: 'Duplicated branch text.' },
        { story: 'Story duplicate', scenario: 'Scenario duplicate', code: 'Duplicated branch text.' }
    ]);

    await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: embeddingClientFromMap(new Map([['duplicated', [1, 0, 0]]]), calls)
    });

    assert.equal(calls.filter((call) => call.model === QWEN).length, 2);
});

test('branch text includes full Feature Story Scenario Code path', () => {
    const [branch] = collectLeafBranches(modelFromBranches([
        {
            story: 'Story Refund',
            scenario: 'Scenario Submit refund',
            code: 'Code POST /refunds creates a refund',
            description: 'Code description',
            expectedResult: 'Refund is created'
        }
    ]));

    assert.match(branch.branchText, /Feature: Feature Payments/);
    assert.match(branch.branchText, /Story: Story Refund/);
    assert.match(branch.branchText, /Scenario: Scenario Submit refund/);
    assert.match(branch.branchText, /Code: Code POST \/refunds creates a refund/);
    assert.match(branch.branchText, /Expected result: Refund is created/);
});

test('hybrid matcher covers a paraphrased requirement when lexical overlap is low and embedding is high', async () => {
    clearRequirementCoverageEmbeddingCache();
    const calls = [];
    const chunks = [
        atomicChunk({
            id: 'a-1',
            text: 'REQ-42 customer must confirm identity before account recovery continues.',
            sourceRowId: 'REQ-42',
            requirementId: 'REQ-42'
        })
    ];
    const model = modelFromBranches([
        {
            scenario: 'Recover access',
            code: 'REQ-42 verified owner can continue access restoration after an identity check.'
        }
    ]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: embeddingClientFromMap(new Map([
            ['confirm identity', [1, 0, 0]],
            ['identity check', [1, 0, 0]]
        ]), calls)
    });

    const best = coverage.traceabilityMap[0].bestMatch;
    assert.equal(best.status, 'covered');
    assert.ok(best.embeddingScore > 0.99);
    assert.ok(best.lexicalOverlap < 0.35);
});

test('strong explicit matching uses branch identifiers as well as branch text', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [
        atomicChunk({
            id: 'a-1',
            text: 'Customer confirms identity before account recovery continues.',
            sourceRowId: 'REQ-42',
            requirementId: 'REQ-42'
        })
    ];
    const model = [
        {
            id: 'feature-auth',
            text: 'Feature account recovery',
            stories: [
                {
                    id: 'REQ-42-story',
                    text: 'Recover account access',
                    scenarios: [
                        {
                            id: 'scenario-recover',
                            text: 'Recover access',
                            codes: [
                                {
                                    id: 'code-recover',
                                    text: 'Verified owner can continue access restoration after an identity check.',
                                    type: 'backend'
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ];

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: async () => [1, 0, 0]
    });

    const best = coverage.traceabilityMap[0].bestMatch;
    assert.equal(best.status, 'covered');
    assert.equal(best.explicitBoost, 1);
    assert.deepEqual(best.explicitSignals.strongMatches, ['req42']);
});

test('finalScore uses configurable weights', () => {
    const result = computeHybridMatchScore({
        embeddingScore: 0.8,
        lexicalOverlap: 0.4,
        phraseOverlap: 0.2,
        explicitBoost: 0.5,
        embeddingEnabled: true,
        config: {
            weights: {
                embeddingEnabled: { embeddingScore: 0.5, lexicalOverlap: 0.3, phraseOverlap: 0.1, explicitBoost: 0.1 },
                lexicalOnly: { lexicalOverlap: 0.6, phraseOverlap: 0.2, explicitBoost: 0.2 }
            }
        }
    });

    assert.equal(result.finalScore, 0.59);
});

test('endpoint-only match cannot produce covered status', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [
        atomicChunk({
            id: 'a-1',
            text: 'REQ-7 blocked user must receive 403 for POST /payments.',
            sourceRowId: 'REQ-7',
            explicitRefs: [{ type: 'endpoint', value: 'POST /payments' }]
        })
    ];
    const model = modelFromBranches([
        {
            scenario: 'Active user pays',
            code: 'POST /payments returns 200 success for an active customer.',
            expectedResult: 'Payment is successful'
        }
    ]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: async () => [1, 0, 0]
    });

    const best = coverage.traceabilityMap[0].bestMatch;
    assert.notEqual(best.status, 'covered');
    assert.ok(best.finalScore < coverage.thresholds.covered);
    assert.equal(best.endpointOnlyCapped, true);
});

test('needs_review is selected by configurable borderline thresholds', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [
        atomicChunk({ id: 'a-1', text: 'REQ-1 exact alpha behavior.', sourceRowId: 'REQ-1' }),
        atomicChunk({ id: 'a-2', text: 'REQ-2 exact beta behavior.', sourceRowId: 'REQ-2' }),
        atomicChunk({ id: 'a-3', text: 'REQ-3 partial gamma behavior.', sourceRowId: 'REQ-3' })
    ];
    const model = modelFromBranches([
        { scenario: 'Alpha', code: 'REQ-1 exact alpha behavior.' },
        { scenario: 'Beta', code: 'REQ-2 exact beta behavior.' },
        { scenario: 'Gamma', code: 'REQ-3 gamma action is mentioned without full behavior.' }
    ]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        scaleGateResult: { catastrophic: false },
        embeddingClient: async (text) => {
            if (String(text).includes('partial gamma') || String(text).includes('gamma action')) {
                return [0.68, 0.32, 0];
            }
            return [1, 0, 0];
        },
        config: {
            thresholds: {
                covered: 0.85,
                partial: 0.45,
                needsReviewHardCoverageSlack: 0.2,
                needsReviewSoftCoverageMin: 0.68,
                needsReviewPartialCoverageMin: 0.2
            }
        }
    });

    assert.equal(coverage.status, 'needs_review');
    assert.equal(coverage.hardCoverageRatio, 2 / 3);
    assert.equal(coverage.partialCoverageRatio, 1 / 3);
});

test('needs_review is selected for high-confidence partial coverage calibration cases', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [
        atomicChunk({ id: 'a-1', text: 'REQ-1 payroll registry title must be rendered from the response.', sourceRowId: 'REQ-1' }),
        atomicChunk({ id: 'a-2', text: 'REQ-2 payroll registry amount must be rendered from the response.', sourceRowId: 'REQ-2' }),
        atomicChunk({ id: 'a-3', text: 'REQ-3 payroll registry error alert must be rendered from the response.', sourceRowId: 'REQ-3' })
    ];
    const model = [
        {
            id: 'feature-payroll',
            text: 'Payroll registry screen',
            stories: chunks.map((chunk, index) => ({
                id: `${chunk.parent_row_number}-story`,
                text: `Story ${index}`,
                scenarios: [
                    {
                        id: `sc-${index}`,
                        text: 'Open payroll registry screen',
                        codes: [
                            {
                                id: `code-${index}`,
                                text: `Show summarized payroll behavior ${index}`,
                                type: 'frontend'
                            }
                        ]
                    }
                ]
            }))
        }
    ];

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        scaleGateResult: { catastrophic: false },
        embeddingClient: async (text) => String(text).includes('Show summarized')
            ? [0.83, 0.557763, 0]
            : [1, 0, 0]
    });

    assert.equal(coverage.status, 'needs_review');
    assert.equal(coverage.hardCoverageRatio, 0);
    assert.equal(coverage.partialCoverageRatio, 1);
    assert.equal(coverage.strongPartialCoverageRatio, 1);
    assert.ok(coverage.softCoverageScore >= coverage.thresholds.needsReviewHighPartialSoftCoverageMin);
});

test('needs_review is selected for post-validation high-partial coverage near 0.57 soft score', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [
        atomicChunk({ id: 'a-1', text: 'REQ-1 payroll registry title is rendered from response data.', sourceRowId: 'REQ-1' }),
        atomicChunk({ id: 'a-2', text: 'REQ-2 payroll registry amount is rendered from response data.', sourceRowId: 'REQ-2' }),
        atomicChunk({ id: 'a-3', text: 'REQ-3 payroll registry error alert is rendered from response data.', sourceRowId: 'REQ-3' })
    ];
    const model = [
        {
            id: 'feature-payroll',
            text: 'Payroll registry screen',
            stories: chunks.map((chunk, index) => ({
                id: `${chunk.parent_row_number}-story`,
                text: `Registry behavior ${index}`,
                scenarios: [
                    {
                        id: `sc-${index}`,
                        text: 'Open payroll registry screen',
                        codes: [
                            {
                                id: `code-${index}`,
                                text: `Show generic payroll registry behavior ${index}`,
                                type: 'frontend'
                            }
                        ]
                    }
                ]
            }))
        }
    ];

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        scaleGateResult: { catastrophic: false },
        embeddingClient: async (text) => String(text).includes('Show generic')
            ? [0.69, 0.723809, 0]
            : [1, 0, 0]
    });

    assert.equal(coverage.hardCoverageRatio, 0);
    assert.equal(coverage.partialCoverageRatio, 1);
    assert.equal(coverage.strongPartialCoverageRatio, 1);
    assert.ok(coverage.softCoverageScore >= 0.56, `softCoverageScore=${coverage.softCoverageScore}`);
    assert.ok(coverage.softCoverageScore < 0.58);
    assert.equal(coverage.status, 'needs_review');
});

test('matchedBranchSignature is stored in traceabilityMap and used in retry prompt', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [
        atomicChunk({ id: 'a-1', text: 'REQ-1 covered behavior.', sourceRowId: 'REQ-1' }),
        atomicChunk({ id: 'a-2', text: 'REQ-2 uncovered behavior.', sourceRowId: 'REQ-2', sectionPath: ['2. Reports'] })
    ];
    const model = modelFromBranches([{ scenario: 'Covered', code: 'REQ-1 covered behavior.' }]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: async (text) => String(text).includes('REQ-1 covered behavior') ? [1, 0, 0] : [0, 1, 0]
    });

    const signature = coverage.traceabilityMap[0].matches[0].matchedBranchSignature;
    assert.ok(signature);

    const prompt = buildRequirementCoverageRetryInstruction({
        requirementCoverage: coverage,
        maxExamples: 5
    });

    assert.match(prompt, /Uncovered requirements by section/);
    assert.match(prompt, /2\. Reports: 1/);
    assert.ok(prompt.includes(signature));
});

test('retry prompt treats partial requirement units as coverage gaps', () => {
    const prompt = buildRequirementCoverageRetryInstruction({
        requirementCoverage: {
            traceabilityMap: [
                {
                    stableId: 'REQ-P|hash',
                    status: 'partial',
                    sourceChunkId: 'chunk-p',
                    sourceRowId: 'REQ-P',
                    requirementId: 'REQ-P',
                    atomicRuleIndex: 1,
                    sectionPath: ['1. Partial'],
                    sectionPathDisplay: '1. Partial',
                    text: 'REQ-P needs a more specific expected result.',
                    bestMatch: {
                        finalScore: 0.61,
                        matchedBranchSignature: 'partial-branch-signature'
                    },
                    matches: [
                        {
                            status: 'partial',
                            matchedBranchSignature: 'partial-branch-signature'
                        }
                    ]
                },
                {
                    stableId: 'REQ-C|hash',
                    status: 'covered',
                    sourceChunkId: 'chunk-c',
                    sourceRowId: 'REQ-C',
                    requirementId: 'REQ-C',
                    atomicRuleIndex: 1,
                    sectionPath: ['2. Covered'],
                    sectionPathDisplay: '2. Covered',
                    text: 'REQ-C is already covered.',
                    bestMatch: {
                        finalScore: 0.91,
                        matchedBranchSignature: 'covered-branch-signature'
                    },
                    matches: [
                        {
                            status: 'covered',
                            matchedBranchSignature: 'covered-branch-signature'
                        }
                    ]
                }
            ],
            uncoveredRequirementUnits: []
        },
        maxExamples: 5
    });

    assert.match(prompt, /Uncovered requirements by section/);
    assert.match(prompt, /1\. Partial: 1/);
    assert.match(prompt, /coverageStatus=partial/);
    assert.match(prompt, /bestScore=0\.61/);
    assert.match(prompt, /currentBestBranchSignature=partial-branch-signature/);
    assert.match(prompt, /covered-branch-signature/);
});

test('lexical-only fallback returns degraded diagnostics and full metrics', async () => {
    clearRequirementCoverageEmbeddingCache();
    const chunks = [atomicChunk({ id: 'a-1', text: 'REQ-1 user can download report.', sourceRowId: 'REQ-1' })];
    const model = modelFromBranches([{ scenario: 'Download report', code: 'REQ-1 user downloads report file.' }]);

    const coverage = await evaluateRequirementCoverage({
        chunks,
        model,
        apiKey: 'fake-key',
        embeddingClient: async () => {
            throw new Error('all embeddings down');
        }
    });

    assert.equal(coverage.embeddingDisabled, true);
    assert.equal(coverage.embeddingModelUsed, null);
    assert.equal(coverage.confidence, 'degraded');
    assert.equal(typeof coverage.hardCoverageRatio, 'number');
    assert.equal(typeof coverage.partialCoverageRatio, 'number');
    assert.equal(typeof coverage.softCoverageScore, 'number');
    assert.ok(Array.isArray(coverage.traceabilityMap));
    assert.equal(coverage.thresholdProfile, 'hybrid-v1');
    assert.ok(coverage.thresholds.covered);
    assert.ok(Array.isArray(coverage.lowConfidenceMatches));
});

test('manual many-to-many traceability keeps multiple candidates and allows one branch to cover multiple atoms', async () => {
    clearRequirementCoverageEmbeddingCache();
    const units = [
        manualUnit({
            atomId: 'ATOM-1',
            action: 'open registry details',
            condition: 'authorized operator selects a row',
            expectedResult: 'details card is shown'
        }),
        manualUnit({
            atomId: 'ATOM-2',
            action: 'open registry details',
            condition: 'authorized operator selects a row',
            expectedResult: 'audit metadata is shown'
        })
    ];
    const model = modelFromBranches([
        {
            story: 'Registry details',
            scenario: 'Open registry details from list',
            code: 'Authorized operator opens registry details and sees details card plus audit metadata.'
        },
        {
            story: 'Registry details',
            scenario: 'Open registry details fallback',
            code: 'Operator opens the details screen, but audit metadata is not checked.'
        },
        {
            story: 'Unrelated',
            scenario: 'Open settings',
            code: 'Settings page is displayed.'
        }
    ]);

    const coverage = await evaluateRequirementCoverage({
        coverageUnits: units,
        coverageSource: 'manual_atom_registry',
        model,
        apiKey: 'fake-key',
        embeddingClient: async () => [1, 0, 0],
        verifierClient: async ({ unit, candidateBranches }) => candidateBranches.map((candidate, index) => {
            if (unit.atom_id === 'ATOM-1' && index === 0) {
                return { ...candidate, coverage_status: 'strong', confidence: 0.92, reason: 'verified details card', evidence: ['details card'] };
            }
            if (unit.atom_id === 'ATOM-1' && index === 1) {
                return { ...candidate, coverage_status: 'partial', confidence: 0.61, reason: 'same flow without full assertion', evidence: ['details screen'] };
            }
            if (unit.atom_id === 'ATOM-2' && index === 0) {
                return { ...candidate, coverage_status: 'strong', confidence: 0.9, reason: 'verified audit metadata', evidence: ['audit metadata'] };
            }
            return { ...candidate, coverage_status: 'not_covered', confidence: 0.2, reason: 'not related', evidence: [] };
        })
    });

    assert.equal(coverage.coverageSource, 'manual_atom_registry');
    assert.equal(coverage.traceabilityMap[0].coverageStatus, 'strong');
    assert.equal(coverage.traceabilityMap[0].candidateBranches.length >= 2, true);
    assert.equal(coverage.traceabilityMap[0].candidateBranches[0].coverage_status, 'strong');
    assert.equal(coverage.traceabilityMap[0].candidateBranches[1].coverage_status, 'partial');
    assert.equal(coverage.traceabilityMap[0].bestBranchId, coverage.traceabilityMap[1].bestBranchId);
    assert.ok(coverage.orphanBranchRate > 0);
    assert.ok(coverage.orphanBranchRate < 1);
});

test('Scenario without Code is evaluated as incomplete leaf and capped at partial for Code-level atoms', async () => {
    clearRequirementCoverageEmbeddingCache();
    const [branch] = collectLeafBranches(incompleteModelFromScenario({
        scenario: 'POST /registries repeat returns an error code for blocked registry'
    }));

    assert.equal(branch.incompleteLeaf, true);
    assert.equal(branch.codeId, null);
    assert.match(branch.branchText, /Scenario: POST \/registries repeat returns an error code/);

    const coverage = await evaluateRequirementCoverage({
        coverageUnits: [
            manualUnit({
                atomId: 'ATOM-API-1',
                action: 'repeat registry',
                condition: 'registry is blocked',
                expectedResult: 'errorCode is returned',
                type: 'API_CONTRACT',
                targetLevel: 'C2_C3_BACKEND',
                methodRef: 'Method 2',
                methodName: 'Repeat registry',
                httpMethod: 'POST',
                endpoint: '/registries/{id}/repeat',
                requestParams: 'id',
                responseParams: 'errorCode'
            })
        ],
        coverageSource: 'manual_atom_registry',
        model: incompleteModelFromScenario({
            scenario: 'POST /registries repeat returns an error code for blocked registry'
        }),
        apiKey: 'fake-key',
        embeddingClient: async () => [1, 0, 0]
    });

    assert.equal(coverage.diagnostics.incompleteLeafCount, 1);
    assert.equal(coverage.diagnostics.incompleteLeaves.length, 1);
    assert.equal(coverage.traceabilityMap[0].coverageStatus, 'partial');
    assert.equal(coverage.traceabilityMap[0].candidateBranches[0].incompleteLeaf, true);
    assert.equal(coverage.traceabilityMap[0].candidateBranches[0].incompleteLeafCapped, true);
});

test('UI-only branch cannot be strong for atom that requires method and params', async () => {
    clearRequirementCoverageEmbeddingCache();
    const coverage = await evaluateRequirementCoverage({
        coverageUnits: [
            manualUnit({
                atomId: 'ATOM-API-2',
                action: 'repeat registry',
                condition: 'service returns business error',
                expectedResult: 'errorCode is displayed',
                type: 'API_CONTRACT',
                targetLevel: 'C2_C3_BACKEND',
                methodRef: 'Method 2',
                methodName: 'Repeat registry',
                httpMethod: 'POST',
                endpoint: '/registries/{id}/repeat',
                requestParams: 'id',
                responseParams: 'errorCode'
            })
        ],
        coverageSource: 'manual_atom_registry',
        model: modelFromBranches([
            {
                scenario: 'Open repeat dialog',
                code: 'User opens repeat dialog and sees an error notification.'
            }
        ]),
        apiKey: 'fake-key',
        embeddingClient: async () => [1, 0, 0]
    });

    assert.notEqual(coverage.traceabilityMap[0].coverageStatus, 'strong');
    assert.equal(coverage.traceabilityMap[0].candidateBranches[0].apiEvidenceCapped, true);
});

test('quality status is derived from coverage metrics, not branch count', async () => {
    clearRequirementCoverageEmbeddingCache();
    const coverage = await evaluateRequirementCoverage({
        coverageUnits: [
            manualUnit({ atomId: 'ATOM-1', action: 'alpha action', expectedResult: 'alpha result' }),
            manualUnit({ atomId: 'ATOM-2', action: 'beta action', expectedResult: 'beta result' })
        ],
        coverageSource: 'manual_atom_registry',
        model: modelFromBranches([
            { scenario: 'Alpha', code: 'alpha action alpha result' },
            { scenario: 'Noise 1', code: 'unrelated branch one' },
            { scenario: 'Noise 2', code: 'unrelated branch two' },
            { scenario: 'Noise 3', code: 'unrelated branch three' }
        ]),
        apiKey: 'fake-key',
        embeddingClient: async (text) => {
            const value = String(text);
            if (value.includes('alpha')) {
                return [1, 0, 0];
            }
            if (value.includes('beta')) {
                return [0, 1, 0];
            }
            return [0, 0, 1];
        },
        config: {
            qualityThresholds: {
                passedStrictCoverage: 0.8,
                passedPotentialCoverage: 0.95,
                passedMaxNotCoveredRatio: 0.05,
                passedMaxIncompleteLeafRate: 0.05,
                needsReviewStrictCoverage: 0.55,
                needsReviewPotentialCoverage: 0.75
            }
        }
    });

    assert.equal(coverage.branchCount, 4);
    assert.equal(coverage.qualityStatus, 'degraded_quality');
    assert.equal(coverage.status, 'degraded_quality');
    assert.equal(coverage.strictCoverage, 0.5);
});

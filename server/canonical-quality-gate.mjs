import { evaluateRequirementCoverage, buildRequirementCoverageRetryInstruction } from './requirement-coverage-evaluator.mjs';
import { evaluateTestModelScaleGate } from './test-model-scale-gate.mjs';
import { randomUUID } from 'crypto';

export function classifyCanonicalQualityOutcome({ scaleGate, requirementCoverage }) {
    if (requirementCoverage?.status === 'failed') {
        return 'failed';
    }

    if (requirementCoverage?.status === 'passed' && scaleGate?.passed !== false) {
        return 'passed';
    }

    if (requirementCoverage?.status === 'passed' || requirementCoverage?.status === 'needs_review') {
        return scaleGate?.catastrophic ? 'degraded_quality' : 'needs_review';
    }

    return 'degraded_quality';
}

export async function runCanonicalQualityGate({
    model,
    canonicalChunks,
    segmentResults = null,
    generationSegmentCount = 0,
    canonicalChunkCount = 0,
    coverageUnits = null,
    coverageSource = null,
    apiKey = null,
    embeddingClient = undefined,
    codeAugmentationDiagnostics = null,
    manualRegistryDiagnostics = null,
    scaleGateConfig = {},
    coverageConfig = {}
} = {}) {
    const scaleGate = evaluateTestModelScaleGate({
        model,
        segmentResults,
        generationSegmentCount,
        canonicalChunkCount,
        config: scaleGateConfig
    });
    const requirementCoverage = await evaluateRequirementCoverage({
        chunks: canonicalChunks,
        coverageUnits,
        coverageSource,
        model,
        apiKey,
        embeddingClient,
        config: coverageConfig,
        scaleGateResult: scaleGate,
        codeAugmentationDiagnostics,
        manualRegistryDiagnostics
    });
    const outcome = classifyCanonicalQualityOutcome({ scaleGate, requirementCoverage });

    return {
        scaleGate,
        requirementCoverage,
        traceabilityMap: requirementCoverage.traceabilityMap,
        outcome,
        passed: outcome === 'passed',
        needsReview: outcome === 'needs_review',
        degradedQuality: outcome === 'degraded_quality'
    };
}

export async function runPostValidationQualityCheck(options = {}) {
    const check = await runCanonicalQualityGate(options);
    return {
        stage: 'postValidationQualityCheck',
        retryAllowed: false,
        checkedAt: new Date().toISOString(),
        ...check
    };
}

function ensureId(value, prefix) {
    return value || `${prefix}-${randomUUID()}`;
}

function collectionToArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value && typeof value === 'object') {
        return Object.values(value);
    }

    return [];
}

function normalizeCodes(codes = []) {
    return collectionToArray(codes)
        .map((code) => ({
            id: ensureId(code?.id, 'code'),
            text: String(code?.text || code?.name || code?.title || '').trim(),
            type: code?.type || code?.layer || undefined,
            ...(code?.description ? { description: code.description } : {}),
            ...(code?.expectedResult ? { expectedResult: code.expectedResult } : {})
        }))
        .filter((code) => code.text);
}

function normalizeScenarioFragment(scenario = {}) {
    const codes = normalizeCodes(scenario.codes || scenario.code);
    const text = String(scenario.text || scenario.name || scenario.title || 'Cover requirement gap').trim();
    if (codes.length === 0 && !text) {
        return null;
    }

    return {
        ...scenario,
        id: ensureId(scenario.id, 'scenario'),
        text,
        codes
    };
}

function normalizeStoryFragment(story = {}) {
    const scenarios = collectionToArray(story.scenarios)
        .map(normalizeScenarioFragment)
        .filter(Boolean);
    if (scenarios.length === 0) {
        return null;
    }

    return {
        ...story,
        id: ensureId(story.id, 'story'),
        text: String(story.text || story.name || story.title || 'Quality gate coverage gaps').trim(),
        scenarios
    };
}

function normalizeFeatureFragment(feature = {}) {
    const stories = collectionToArray(feature.stories)
        .map(normalizeStoryFragment)
        .filter(Boolean);
    if (stories.length === 0) {
        return null;
    }

    return {
        ...feature,
        id: ensureId(feature.id, 'feature'),
        text: String(feature.text || feature.name || feature.title || 'Quality gate augmentation').trim(),
        stories
    };
}

function wrapFlatScenarioFragment(item = {}) {
    const codes = normalizeCodes(item.codes || item.code);
    if (codes.length === 0) {
        return null;
    }

    const scenarioText = String(item.scenarioText || item.scenario || item.text || item.title || 'Cover requirement gap').trim();
    const storyText = String(item.storyText || item.story || item.section || 'Quality gate coverage gaps').trim();
    const featureText = String(item.featureText || item.feature || 'Quality gate augmentation').trim();

    return {
        id: ensureId(item.featureId, 'feature'),
        text: featureText,
        stories: [
            {
                id: ensureId(item.storyId, 'story'),
                text: storyText,
                scenarios: [
                    {
                        id: ensureId(item.scenarioId || item.id, 'scenario'),
                        text: scenarioText,
                        codes
                    }
                ]
            }
        ]
    };
}

function wrapStoryLikeFragment(item = {}) {
    if (!Array.isArray(item.scenarios) && !(item.scenarios && typeof item.scenarios === 'object')) {
        return null;
    }

    return {
        id: ensureId(item.featureId, 'feature'),
        text: String(item.featureText || item.feature || 'Quality gate augmentation').trim(),
        stories: [
            {
                id: ensureId(item.storyId || item.id, 'story'),
                text: String(item.storyText || item.story || item.text || 'Quality gate coverage gaps').trim(),
                scenarios: collectionToArray(item.scenarios)
                    .map(normalizeScenarioFragment)
                    .filter(Boolean)
            }
        ]
    };
}

export function coerceQualityGateRetryModelFragment(modelFragment = []) {
    const items = Array.isArray(modelFragment) ? modelFragment : [modelFragment];
    const features = [];

    for (const item of items) {
        if (!item || typeof item !== 'object') {
            continue;
        }

        if (Array.isArray(item.stories) || (item.stories && typeof item.stories === 'object')) {
            const normalizedFeature = normalizeFeatureFragment(item);
            if (normalizedFeature) {
                features.push(normalizedFeature);
            }
            continue;
        }

        const storyWrapped = wrapStoryLikeFragment(item);
        if (storyWrapped) {
            features.push(storyWrapped);
            continue;
        }

        const flatWrapped = wrapFlatScenarioFragment(item);
        if (flatWrapped) {
            features.push(flatWrapped);
        }
    }

    return features;
}

function renderScaleGateRetryInstruction(scaleGate) {
    if (!scaleGate || scaleGate.passed) {
        return 'Scale gate passed.';
    }

    const failed = (scaleGate.failedChecks || [])
        .map((check) => `- ${check.name}: actual=${check.actual}, expected>=${check.expected}`)
        .join('\n');

    return [
        'Scale gate failed. The model is too small for the canonical workload.',
        'Add missing, non-duplicate Feature -> Story -> Scenario -> Code branches until these minimums are met:',
        failed || '- no failed scale checks reported'
    ].join('\n');
}

export function buildCanonicalQualityRetryInstruction({
    scaleGate,
    requirementCoverage,
    maxExamples
} = {}) {
    return [
        'CANONICAL QUALITY GATE RETRY',
        '',
        renderScaleGateRetryInstruction(scaleGate),
        '',
        'Return JSON schema:',
        '[{"id":"feature-id","text":"Feature name","stories":[{"id":"story-id","text":"Story name","scenarios":[{"id":"scenario-id","text":"Scenario action","codes":[{"id":"code-id","text":"System behavior","type":"frontend|backend"}]}]}]}]',
        'Do not return Scenario or Code objects at the root level.',
        '',
        buildRequirementCoverageRetryInstruction({
            requirementCoverage,
            maxExamples
        })
    ].join('\n');
}

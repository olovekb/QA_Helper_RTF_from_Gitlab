export const DEFAULT_SCALE_GATE_CONFIG = Object.freeze({
    coveredSegmentRatio: 0.6,
    minScenarioFloor: 3,
    minCodesFloor: 6,
    codesPerSegmentRatio: 1.5,
    codesPerCanonicalChunkRatio: 0.15,
    minLeafBranchFloor: 3,
    leafBranchesPerSegmentRatio: 0.8,
    catastrophicCoveredSegmentRatio: 0.5,
    catastrophicScenarioRatio: 0.75,
    catastrophicCodesRatio: 0.75,
    catastrophicLeafBranchRatio: 0.75
});

function mergeConfig(config = {}) {
    return {
        ...DEFAULT_SCALE_GATE_CONFIG,
        ...(config || {})
    };
}

function hasText(value) {
    return String(value || '').trim().length > 0;
}

export function summarizeTestModelScale(model = []) {
    const featuresCount = Array.isArray(model) ? model.length : 0;
    let storiesCount = 0;
    let scenariosCount = 0;
    let codesCount = 0;
    let leafBranchCount = 0;

    for (const feature of Array.isArray(model) ? model : []) {
        const stories = Array.isArray(feature?.stories) ? feature.stories : [];
        storiesCount += stories.length;

        for (const story of stories) {
            const scenarios = Array.isArray(story?.scenarios) ? story.scenarios : [];
            scenariosCount += scenarios.length;

            for (const scenario of scenarios) {
                const codes = Array.isArray(scenario?.codes) ? scenario.codes : [];
                const nonEmptyCodes = codes.filter((code) => hasText(code?.text));
                codesCount += nonEmptyCodes.length;

                if (hasText(scenario?.text) && nonEmptyCodes.length > 0) {
                    leafBranchCount += 1;
                }
            }
        }
    }

    return {
        featuresCount,
        storiesCount,
        scenariosCount,
        codesCount,
        leafBranchCount
    };
}

function countCoveredSegments(segmentResults = []) {
    if (!Array.isArray(segmentResults)) {
        return null;
    }

    return segmentResults.reduce((count, segmentModel) => {
        const metrics = summarizeTestModelScale(segmentModel);
        return count + (metrics.leafBranchCount > 0 ? 1 : 0);
    }, 0);
}

export function buildScaleGateThresholds({
    generationSegmentCount = 0,
    canonicalChunkCount = 0,
    segmentResults = null,
    config = {}
} = {}) {
    const mergedConfig = mergeConfig(config);
    const segmentCount = Math.max(0, Number(generationSegmentCount) || 0);
    const chunkCount = Math.max(0, Number(canonicalChunkCount) || 0);
    const canEvaluateSegments = Array.isArray(segmentResults);

    return {
        minCoveredSegmentCount: canEvaluateSegments && segmentCount > 0
            ? Math.ceil(segmentCount * mergedConfig.coveredSegmentRatio)
            : null,
        minScenariosCount: Math.max(mergedConfig.minScenarioFloor, segmentCount),
        minCodesCount: Math.max(
            mergedConfig.minCodesFloor,
            Math.ceil(segmentCount * mergedConfig.codesPerSegmentRatio),
            Math.ceil(chunkCount * mergedConfig.codesPerCanonicalChunkRatio)
        ),
        minLeafBranchCount: Math.max(
            mergedConfig.minLeafBranchFloor,
            Math.ceil(segmentCount * mergedConfig.leafBranchesPerSegmentRatio)
        )
    };
}

function makeCheck(name, actual, expected, skipped = false) {
    const passed = skipped || actual >= expected;
    return {
        name,
        actual,
        expected,
        passed,
        skipped
    };
}

function isSeverelyBelowThreshold(actual, expected, ratio) {
    if (expected == null || expected <= 0) {
        return false;
    }

    return actual < Math.ceil(expected * ratio);
}

function isCatastrophicScaleFailure(failedChecks, config) {
    if (!Array.isArray(failedChecks) || failedChecks.length === 0) {
        return false;
    }

    const ratioByCheckName = {
        coveredSegmentCount: config.catastrophicCoveredSegmentRatio,
        scenariosCount: config.catastrophicScenarioRatio,
        codesCount: config.catastrophicCodesRatio,
        leafBranchCount: config.catastrophicLeafBranchRatio
    };

    return failedChecks.some((check) => (
        !check.skipped &&
        isSeverelyBelowThreshold(
            Number(check.actual) || 0,
            check.expected,
            ratioByCheckName[check.name] ?? 1
        )
    ));
}

export function evaluateTestModelScaleGate({
    model = [],
    segmentResults = null,
    generationSegmentCount = 0,
    canonicalChunkCount = 0,
    config = {}
} = {}) {
    const mergedConfig = mergeConfig(config);
    const metrics = {
        ...summarizeTestModelScale(model),
        coveredSegmentCount: countCoveredSegments(segmentResults)
    };
    const thresholds = buildScaleGateThresholds({
        generationSegmentCount,
        canonicalChunkCount,
        segmentResults,
        config: mergedConfig
    });

    const checks = [
        makeCheck(
            'coveredSegmentCount',
            metrics.coveredSegmentCount,
            thresholds.minCoveredSegmentCount,
            thresholds.minCoveredSegmentCount == null
        ),
        makeCheck('scenariosCount', metrics.scenariosCount, thresholds.minScenariosCount),
        makeCheck('codesCount', metrics.codesCount, thresholds.minCodesCount),
        makeCheck('leafBranchCount', metrics.leafBranchCount, thresholds.minLeafBranchCount)
    ];
    const failedChecks = checks.filter((check) => !check.passed);
    const passed = failedChecks.length === 0;
    const catastrophic = !passed && isCatastrophicScaleFailure(failedChecks, mergedConfig);

    return {
        gate: 'scaleGate',
        status: passed ? 'passed' : 'failed',
        passed,
        catastrophic,
        metrics,
        thresholds,
        checks,
        failedChecks,
        config: mergedConfig,
        message: passed
            ? 'Scale gate passed.'
            : catastrophic
                ? 'Generated test model is catastrophically too small for the canonical generation workload.'
                : 'Generated test model is slightly below the canonical scale threshold.'
    };
}

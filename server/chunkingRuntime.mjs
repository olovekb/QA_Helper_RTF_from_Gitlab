export const DEFAULT_CHUNKING_MODEL = 'zai-org/GLM-4.7-Flash';
export const DEFAULT_HARD_SLA_MS = 10 * 60 * 1000;

export function normalizeChunkingModel(model, fallback = DEFAULT_CHUNKING_MODEL) {
    const normalized = String(model || '').trim();
    return normalized || fallback;
}

export function resolveModelsToTry(inputModels = [], configuredModels = []) {
    const normalizedInput = Array.isArray(inputModels)
        ? inputModels.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const normalizedConfigured = Array.isArray(configuredModels)
        ? configuredModels.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    if (normalizedInput.length === 0) {
        return normalizedConfigured;
    }

    const selected = normalizedInput[0];
    const fallbackModels = normalizedConfigured.filter((model) => model !== selected);
    return [selected, ...fallbackModels];
}

export function resolveChunkingModel(modelsToTry = [], fallback = DEFAULT_CHUNKING_MODEL) {
    const firstModel = Array.isArray(modelsToTry) && modelsToTry.length > 0
        ? modelsToTry[0]
        : null;
    return normalizeChunkingModel(firstModel, fallback);
}

export function buildConfluenceChunkIndexCacheKey({
    sourceType,
    docId,
    chunkingModel
}) {
    return [
        String(sourceType || 'linked'),
        String(docId || 'unknown'),
        normalizeChunkingModel(chunkingModel)
    ].join(':');
}

export function computeAdaptiveLinkedDocLimit({
    mainChunkCount = 0,
    linkedDocCount = 0,
    baseLimit = 3,
    maxLimit = 12,
    chunksPerDocStep = 6
} = {}) {
    const safeLinkedCount = Math.max(0, Number(linkedDocCount) || 0);
    if (safeLinkedCount === 0) return 0;

    const safeBaseLimit = Math.max(1, Number(baseLimit) || 1);
    const safeMaxLimit = Math.max(safeBaseLimit, Number(maxLimit) || safeBaseLimit);
    const safeStep = Math.max(1, Number(chunksPerDocStep) || 1);
    const safeMainChunkCount = Math.max(0, Number(mainChunkCount) || 0);
    const adaptiveBoost = Math.ceil(safeMainChunkCount / safeStep);

    return Math.min(
        safeLinkedCount,
        safeMaxLimit,
        Math.max(safeBaseLimit, safeBaseLimit + adaptiveBoost)
    );
}

export function selectAdaptiveLinkedDocs(linkedDocs = [], options = {}) {
    const docs = Array.isArray(linkedDocs) ? linkedDocs : [];
    const limit = computeAdaptiveLinkedDocLimit({
        linkedDocCount: docs.length,
        ...options
    });

    return {
        selectedDocs: docs.slice(0, limit),
        omittedCount: Math.max(0, docs.length - limit),
        limit
    };
}

export function getSlaBudgetState(startTime, hardSlaMs = DEFAULT_HARD_SLA_MS) {
    const safeStartTime = Number(startTime) || Date.now();
    const safeHardSlaMs = Math.max(1, Number(hardSlaMs) || DEFAULT_HARD_SLA_MS);
    const elapsedMs = Math.max(0, Date.now() - safeStartTime);
    const remainingMs = Math.max(0, safeHardSlaMs - elapsedMs);
    const ratio = elapsedMs / safeHardSlaMs;

    let mode = 'normal';
    if (ratio >= 0.9) {
        mode = 'critical';
    } else if (ratio >= 0.7) {
        mode = 'degraded';
    }

    return {
        mode,
        elapsedMs,
        remainingMs,
        ratio,
        hardSlaMs: safeHardSlaMs
    };
}

export function getCanonicalDegradationProfile(state) {
    const mode = state?.mode || 'normal';

    if (mode === 'critical') {
        return {
            mode,
            topKScale: 0.5,
            contextCharBudget: 5000,
            maxSegmentLlmAttempts: 1,
            skipTargetedRefinement: true,
            linkedDocLimitScale: 0.5
        };
    }

    if (mode === 'degraded') {
        return {
            mode,
            topKScale: 0.75,
            contextCharBudget: 9000,
            maxSegmentLlmAttempts: 1,
            skipTargetedRefinement: false,
            linkedDocLimitScale: 0.75
        };
    }

    return {
        mode: 'normal',
        topKScale: 1,
        contextCharBudget: 14000,
        maxSegmentLlmAttempts: 2,
        skipTargetedRefinement: false,
        linkedDocLimitScale: 1
    };
}

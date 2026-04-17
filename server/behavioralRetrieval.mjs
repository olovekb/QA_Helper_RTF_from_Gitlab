import { CHUNK_TYPES, ELIGIBILITY_STATUSES, RETRIEVAL_CLASSES } from './semanticChunking.mjs';

const DEFAULT_METADATA_WEIGHTS = {
    screen_scope: 0.35,
    entity_scope: 0.25,
    section_number: 0.15,
    endpoint: 0.12,
    method: 0.08,
    page_entities: 0.05,
    row_number: 0.02
};

const DEFAULT_ELIGIBLE_STATUSES = [
    ELIGIBILITY_STATUSES.ELIGIBLE,
    ELIGIBILITY_STATUSES.PENALIZED
];

const BEHAVIORAL_CHUNK_TYPE_WHITELIST = new Set([
    CHUNK_TYPES.ATOMIC_RULE,
    CHUNK_TYPES.SCENARIO_BRANCH,
    CHUNK_TYPES.BUSINESS_RULE,
    CHUNK_TYPES.UI_RULE,
    CHUNK_TYPES.UI_CURRENT_BEHAVIOR,
    CHUNK_TYPES.SCENARIO_STEP,
    CHUNK_TYPES.ERROR_HANDLING,
    CHUNK_TYPES.VALIDATION_RULE
]);

const SUMMARY_CHUNK_TYPES = new Set([
    CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
    CHUNK_TYPES.REQUIREMENT_ROW,
    CHUNK_TYPES.BUSINESS_CONTEXT,
    CHUNK_TYPES.SCOPE_CONTEXT,
    CHUNK_TYPES.REFERENCE_CONTEXT,
    CHUNK_TYPES.REFERENCE_LINK,
    CHUNK_TYPES.DOCUMENT_META,
    CHUNK_TYPES.CHANGE_LOG,
    CHUNK_TYPES.NOISE_METADATA,
    CHUNK_TYPES.NOISE_SKIPPED
]);

const STOP_WORDS = new Set([
    'если', 'когда', 'при', 'или', 'для', 'как', 'это', 'что', 'будет', 'должен', 'должна',
    'должны', 'пользователь', 'система', 'после', 'before', 'after', 'when', 'with', 'from',
    'that', 'this', 'then', 'than', 'must', 'should', 'will', 'если', 'иначе', 'where',
    'page', 'screen', 'field', 'button', 'table', 'list', 'view', 'state', 'status'
]);

function normalizeValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value == null || value === '') {
        return [];
    }
    return [value];
}

function normalizeArray(values = []) {
    return Array.from(new Set(
        asArray(values)
            .map(normalizeValue)
            .filter(Boolean)
    ));
}

function valuesOverlap(leftValues = [], rightValues = []) {
    const left = normalizeArray(leftValues);
    const right = normalizeArray(rightValues);
    if (!left.length || !right.length) {
        return 0;
    }

    for (const leftItem of left) {
        for (const rightItem of right) {
            if (leftItem === rightItem) {
                return 1;
            }
            if (
                leftItem.length >= 4 &&
                rightItem.length >= 4 &&
                (leftItem.includes(rightItem) || rightItem.includes(leftItem))
            ) {
                return 0.7;
            }
        }
    }

    return 0;
}

export function getChunkAuxMetadata(chunk = {}) {
    return {
        ...(chunk?.metadata?.aux_metadata || {}),
        ...(chunk?.aux_metadata || {})
    };
}

function getChunkFieldValues(chunk = {}, fieldName) {
    const aux = getChunkAuxMetadata(chunk);
    const candidates = [
        aux?.[fieldName],
        chunk?.metadata?.[fieldName],
        chunk?.[fieldName]
    ];

    return normalizeArray(candidates.flatMap(asArray));
}

function extractPageEntitiesFromText(text, limit = 8) {
    const matches = String(text || '')
        .toLowerCase()
        .match(/[a-zа-яё0-9_/-]{4,}/gi);
    if (!matches) {
        return [];
    }

    const frequencies = new Map();
    for (const token of matches) {
        const normalized = normalizeValue(token).replace(/^[/_-]+|[/_-]+$/g, '');
        if (!normalized || STOP_WORDS.has(normalized) || /^\d+$/.test(normalized)) {
            continue;
        }
        frequencies.set(normalized, (frequencies.get(normalized) || 0) + 1);
    }

    return Array.from(frequencies.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([token]) => token);
}

export function collectRetrievalSignals(segment = {}, selectedBehavioralChunks = []) {
    const profile = segment?.retrievalProfile || {};
    const selectedAux = (selectedBehavioralChunks || []).map(getChunkAuxMetadata);

    const aggregateField = (fieldName, profileKey = `${fieldName}s`) => {
        const segmentValues = asArray(profile?.[profileKey] || profile?.[fieldName]);
        const chunkValues = selectedAux.flatMap(aux => asArray(aux?.[fieldName]));
        return normalizeArray([...segmentValues, ...chunkValues]);
    };

    const entityHints = normalizeArray([
        ...aggregateField('entity_scope', 'entity_scopes'),
        ...extractPageEntitiesFromText(segment?.heading || ''),
        ...extractPageEntitiesFromText(segment?.text || '')
    ]);

    return {
        screen_scope: aggregateField('screen_scope', 'screen_scopes'),
        entity_scope: aggregateField('entity_scope', 'entity_scopes'),
        section_number: aggregateField('section_number', 'section_numbers'),
        endpoint: aggregateField('endpoint', 'endpoints'),
        method: aggregateField('method', 'methods'),
        row_number: aggregateField('row_number', 'row_numbers'),
        page_entities: entityHints
    };
}

export function isBehavioralRetrievalCandidate(chunk = {}, eligibleStatuses = DEFAULT_ELIGIBLE_STATUSES) {
    const retrievalClass = chunk?.retrieval_class || chunk?.metadata?.retrieval_class || null;
    const eligibilityStatus = chunk?.eligibility_status || chunk?.metadata?.eligibility_status || null;
    const excluded = Boolean(chunk?.exclude_from_retrieval || chunk?.metadata?.exclude_from_retrieval);
    const chunkType = String(chunk?.chunk_type || chunk?.metadata?.chunk_type || '').trim();
    const granularity = String(chunk?.chunk_granularity || chunk?.metadata?.chunk_granularity || 'atomic').trim().toLowerCase();

    return !excluded &&
        retrievalClass === RETRIEVAL_CLASSES.BEHAVIORAL &&
        granularity === 'atomic' &&
        BEHAVIORAL_CHUNK_TYPE_WHITELIST.has(chunkType) &&
        !SUMMARY_CHUNK_TYPES.has(chunkType) &&
        eligibleStatuses.includes(eligibilityStatus || ELIGIBILITY_STATUSES.ELIGIBLE);
}

export function scoreChunkByMetadata(chunk = {}, signals = {}, weights = DEFAULT_METADATA_WEIGHTS) {
    const aux = getChunkAuxMetadata(chunk);
    const baseScore = Number.isFinite(chunk?.finalScore)
        ? Number(chunk.finalScore)
        : (Number.isFinite(chunk?.score) ? Number(chunk.score) : 0);
    const retrievalPenalty = Number.isFinite(chunk?.retrieval_penalty)
        ? Number(chunk.retrieval_penalty)
        : (Number(chunk?.metadata?.retrieval_penalty) || 0);
    const chunkGranularity = String(chunk?.chunk_granularity || chunk?.metadata?.chunk_granularity || 'atomic').toLowerCase();
    const chunkType = String(chunk?.chunk_type || chunk?.metadata?.chunk_type || '').trim();
    const tokenCount = Number(chunk?.token_count || chunk?.metadata?.token_count || Math.ceil(String(chunk?.content || chunk?.cleaned_text || '').length / 4) || 0);

    let metadataBoost = 0;
    metadataBoost += weights.screen_scope * valuesOverlap(getChunkFieldValues(chunk, 'screen_scope'), signals.screen_scope);
    metadataBoost += weights.entity_scope * valuesOverlap(getChunkFieldValues(chunk, 'entity_scope'), signals.entity_scope);
    metadataBoost += weights.section_number * valuesOverlap(getChunkFieldValues(chunk, 'section_number'), signals.section_number);
    metadataBoost += weights.endpoint * valuesOverlap(getChunkFieldValues(chunk, 'endpoint'), signals.endpoint);
    metadataBoost += weights.method * valuesOverlap(getChunkFieldValues(chunk, 'method'), signals.method);
    metadataBoost += weights.row_number * valuesOverlap(getChunkFieldValues(chunk, 'row_number'), signals.row_number);
    metadataBoost += weights.page_entities * valuesOverlap(
        [
            aux?.entity_scope,
            chunk?.heading,
            chunk?.core_text,
            chunk?.content,
            chunk?.cleaned_text
        ],
        signals.page_entities
    );

    const summaryPenalty = chunkGranularity === 'summary' || SUMMARY_CHUNK_TYPES.has(chunkType)
        ? 0.45
        : 0;
    const lengthPenalty = tokenCount > 900
        ? 0.32
        : (tokenCount > 700 ? 0.22 : (tokenCount > 500 ? 0.12 : 0));
    const softPenalty = summaryPenalty + lengthPenalty;

    return {
        baseScore,
        metadataBoost,
        retrievalPenalty,
        softPenalty,
        combinedScore: baseScore + metadataBoost - retrievalPenalty - softPenalty
    };
}

export function rerankRetrievedChunksByMetadata(chunks = [], segment = {}, options = {}) {
    const {
        selectedBehavioralChunks = [],
        limit = chunks.length,
        weights = DEFAULT_METADATA_WEIGHTS
    } = options;
    const signals = collectRetrievalSignals(segment, selectedBehavioralChunks);

    return (chunks || [])
        .map(chunk => ({
            ...chunk,
            ...scoreChunkByMetadata(chunk, signals, weights),
            retrieval_signals: signals
        }))
        .sort((left, right) => {
            if (right.combinedScore !== left.combinedScore) {
                return right.combinedScore - left.combinedScore;
            }
            if (right.metadataBoost !== left.metadataBoost) {
                return right.metadataBoost - left.metadataBoost;
            }
            return (right.baseScore || 0) - (left.baseScore || 0);
        })
        .slice(0, limit);
}

export function buildEnrichmentQuery(segment = {}, behavioralChunks = []) {
    const signals = collectRetrievalSignals(segment, behavioralChunks);
    const parts = [
        ...signals.screen_scope,
        ...signals.entity_scope,
        ...signals.section_number,
        ...signals.endpoint,
        ...signals.method,
        ...signals.page_entities
    ].filter(Boolean);

    const references = behavioralChunks
        .flatMap(chunk => asArray(getChunkAuxMetadata(chunk)?.references))
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 6);

    return Array.from(new Set([...parts, ...references]))
        .join('\n')
        .trim();
}


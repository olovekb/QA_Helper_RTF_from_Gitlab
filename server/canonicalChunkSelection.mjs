import { CHUNK_TYPES, RETRIEVAL_CLASSES } from './semanticChunking.mjs';
import { isBehavioralRetrievalCandidate } from './behavioralRetrieval.mjs';

const SUMMARY_OR_BACKGROUND_CHUNK_TYPES = new Set([
    CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
    CHUNK_TYPES.REQUIREMENT_ROW,
    CHUNK_TYPES.BUSINESS_CONTEXT,
    CHUNK_TYPES.SCOPE_CONTEXT,
    CHUNK_TYPES.DOCUMENT_META,
    CHUNK_TYPES.CHANGE_LOG,
    CHUNK_TYPES.NOISE_METADATA,
    CHUNK_TYPES.NOISE_SKIPPED,
    CHUNK_TYPES.REFERENCE_LINK
]);

export function getChunkGranularity(chunk = {}) {
    return String(chunk?.chunk_granularity || chunk?.metadata?.chunk_granularity || 'atomic').trim().toLowerCase();
}

export function getChunkType(chunk = {}) {
    return String(chunk?.chunk_type || chunk?.metadata?.chunk_type || '').trim();
}

function extractSectionNumberPrefix(value) {
    const normalized = String(value || '')
        .replace(/\\/g, '')
        .trim();
    const match = normalized.match(/^(\d+(?:\.\d+)*)/);
    return match?.[1] || '';
}

function getChunkPolicyValue(chunk = {}, key) {
    return chunk?.[key] ??
        chunk?.metadata?.[key] ??
        chunk?.aux_metadata?.[key] ??
        chunk?.metadata?.aux_metadata?.[key] ??
        null;
}

function getChunkSectionNumber(chunk = {}) {
    const directCandidates = [
        chunk?.section_number,
        chunk?.metadata?.section_number,
        chunk?.aux_metadata?.section_number,
        chunk?.metadata?.aux_metadata?.section_number
    ];

    for (const candidate of directCandidates) {
        const match = extractSectionNumberPrefix(candidate);
        if (match) {
            return match;
        }
    }

    const sectionPath = Array.isArray(chunk?.section_path)
        ? chunk.section_path
        : (Array.isArray(chunk?.metadata?.section_path) ? chunk.metadata.section_path : []);

    for (let index = sectionPath.length - 1; index >= 0; index -= 1) {
        const match = extractSectionNumberPrefix(sectionPath[index]);
        if (match) {
            return match;
        }
    }

    return extractSectionNumberPrefix(chunk?.heading || chunk?.metadata?.heading || '');
}

function getChunkTopLevelSection(chunk = {}) {
    const explicitSourceSection = extractSectionNumberPrefix(getChunkPolicyValue(chunk, 'source_section'));
    if (explicitSourceSection) {
        return explicitSourceSection.split('.')[0];
    }

    const sectionNumber = getChunkSectionNumber(chunk);
    return sectionNumber ? sectionNumber.split('.')[0] : '';
}

export function isSummaryOrBackgroundChunk(chunk = {}) {
    return SUMMARY_OR_BACKGROUND_CHUNK_TYPES.has(getChunkType(chunk));
}

function isAtomicRetrievableChunk(chunk = {}) {
    if (!chunk || chunk.exclude_from_retrieval || chunk?.metadata?.exclude_from_retrieval) {
        return false;
    }
    if (getChunkGranularity(chunk) !== 'atomic') {
        return false;
    }
    if (isSummaryOrBackgroundChunk(chunk)) {
        return false;
    }
    return true;
}

export function isBehavioralAtomicRuleChunk(chunk = {}) {
    return getChunkType(chunk) === CHUNK_TYPES.ATOMIC_RULE &&
        isBehavioralRetrievalCandidate(chunk);
}

export function isCompactSupportApiChunk(chunk = {}) {
    if (!isAtomicRetrievableChunk(chunk)) {
        return false;
    }

    const retrievalClass = chunk?.retrieval_class || chunk?.metadata?.retrieval_class || null;
    const usagePolicy = String(getChunkPolicyValue(chunk, 'usage_policy') || '').trim().toLowerCase();
    const topLevelSection = getChunkTopLevelSection(chunk);
    const supportingApi = Boolean(getChunkPolicyValue(chunk, 'supporting_api'));
    const excludeFromBehavioral = Boolean(getChunkPolicyValue(chunk, 'exclude_from_behavioral'));
    const survivedCompaction = Boolean(getChunkPolicyValue(chunk, 'survived_compaction'));
    const hasExplicitSupportPolicy = usagePolicy === 'support_only' &&
        supportingApi &&
        excludeFromBehavioral &&
        survivedCompaction;
    const inferredSupportApiSection = topLevelSection === '6';

    return retrievalClass === RETRIEVAL_CLASSES.API_CONTEXT &&
        (hasExplicitSupportPolicy || inferredSupportApiSection);
}

export function isMainDocumentIndexCandidate(chunk = {}) {
    return isBehavioralRetrievalCandidate(chunk) || isCompactSupportApiChunk(chunk);
}

export function isContextAuxiliaryAtomicChunk(chunk = {}) {
    if (!isAtomicRetrievableChunk(chunk)) {
        return false;
    }
    const retrievalClass = chunk?.retrieval_class || chunk?.metadata?.retrieval_class || null;
    return [
        RETRIEVAL_CLASSES.BEHAVIORAL,
        RETRIEVAL_CLASSES.API_CONTEXT,
        RETRIEVAL_CLASSES.REFERENCE_CONTEXT
    ].includes(retrievalClass);
}

export function isLinkedAtomicChunk(chunk = {}) {
    return isAtomicRetrievableChunk(chunk);
}

export function selectCanonicalMainChunks(chunks = []) {
    const indexableChunks = (chunks || []).filter((chunk) => isMainDocumentIndexCandidate(chunk));
    const behavioralMainChunks = indexableChunks.filter((chunk) => isBehavioralAtomicRuleChunk(chunk));
    const supportApiMainChunks = indexableChunks.filter((chunk) => isCompactSupportApiChunk(chunk));
    const behavioralFallbackChunks = (chunks || []).filter((chunk) =>
        !isBehavioralAtomicRuleChunk(chunk) && isBehavioralRetrievalCandidate(chunk)
    );
    const usedFallback = behavioralMainChunks.length === 0 &&
        (supportApiMainChunks.length > 0 || behavioralFallbackChunks.length > 0);

    return {
        indexableChunks,
        behavioralMainChunks,
        supportApiMainChunks,
        behavioralFallbackChunks,
        canonicalChunks: behavioralMainChunks.length > 0
            ? behavioralMainChunks
            : (supportApiMainChunks.length > 0 ? supportApiMainChunks : behavioralFallbackChunks),
        usedFallback
    };
}

function flattenDocumentChunks(docs = []) {
    return (Array.isArray(docs) ? docs : [])
        .flatMap((doc) => Array.isArray(doc?.canonicalChunks) ? doc.canonicalChunks : [])
        .filter(Boolean);
}

function countDistinctDocs(chunks = []) {
    return new Set(
        (chunks || [])
            .map((chunk) => String(chunk?.doc_id || chunk?.docId || chunk?.metadata?.doc_id || '').trim())
            .filter(Boolean)
    ).size;
}

export function selectCanonicalAuxiliaryGenerationChunks({
    contextDocs = [],
    linkedDocs = []
} = {}) {
    const contextChunks = flattenDocumentChunks(contextDocs);
    const linkedChunks = flattenDocumentChunks(linkedDocs);
    const allAuxiliaryChunks = [...contextChunks, ...linkedChunks];
    const behavioralChunks = allAuxiliaryChunks.filter((chunk) => isBehavioralAtomicRuleChunk(chunk));

    if (behavioralChunks.length > 0) {
        return {
            canonicalChunks: behavioralChunks,
            reason: 'behavioral_atomic_auxiliary_chunks',
            contextChunkCount: contextChunks.filter((chunk) => behavioralChunks.includes(chunk)).length,
            linkedChunkCount: linkedChunks.filter((chunk) => behavioralChunks.includes(chunk)).length,
            docCount: countDistinctDocs(behavioralChunks)
        };
    }

    const contextAtomicChunks = contextChunks.filter((chunk) => isContextAuxiliaryAtomicChunk(chunk));
    const linkedAtomicChunks = linkedChunks.filter((chunk) => isLinkedAtomicChunk(chunk));
    const atomicChunks = [...contextAtomicChunks, ...linkedAtomicChunks];

    return {
        canonicalChunks: atomicChunks,
        reason: atomicChunks.length > 0 ? 'retrievable_atomic_auxiliary_chunks' : 'no_auxiliary_retrievable_chunks',
        contextChunkCount: contextAtomicChunks.length,
        linkedChunkCount: linkedAtomicChunks.length,
        docCount: countDistinctDocs(atomicChunks)
    };
}

export function resolveCanonicalGenerationSource({
    selection = {},
    contextDocs = [],
    linkedDocs = []
} = {}) {
    const canonicalChunks = Array.isArray(selection?.canonicalChunks) ? selection.canonicalChunks : [];
    const indexableChunks = Array.isArray(selection?.indexableChunks) ? selection.indexableChunks : [];

    if (canonicalChunks.length > 0) {
        return {
            ...selection,
            indexableChunks,
            canonicalChunks,
            generationSource: 'canonical_main_chunks',
            usedManualAtomRegistryFallback: false,
            usedAuxiliaryGenerationFallback: false,
            noRetrievableMainChunks: false
        };
    }

    const auxiliarySelection = selectCanonicalAuxiliaryGenerationChunks({ contextDocs, linkedDocs });
    if (auxiliarySelection.canonicalChunks.length > 0) {
        return {
            ...selection,
            indexableChunks,
            behavioralMainChunks: [],
            supportApiMainChunks: [],
            behavioralFallbackChunks: [],
            canonicalChunks: auxiliarySelection.canonicalChunks,
            auxiliaryGenerationChunks: auxiliarySelection.canonicalChunks,
            auxiliaryGenerationDetails: {
                reason: auxiliarySelection.reason,
                contextChunkCount: auxiliarySelection.contextChunkCount,
                linkedChunkCount: auxiliarySelection.linkedChunkCount,
                docCount: auxiliarySelection.docCount
            },
            usedFallback: true,
            usedManualAtomRegistryFallback: false,
            usedAuxiliaryGenerationFallback: true,
            noRetrievableMainChunks: true,
            generationSource: 'auxiliary_canonical_chunks'
        };
    }

    return {
        ...selection,
        indexableChunks,
        canonicalChunks,
        generationSource: 'none',
        usedManualAtomRegistryFallback: false,
        usedAuxiliaryGenerationFallback: false,
        noRetrievableMainChunks: true
    };
}

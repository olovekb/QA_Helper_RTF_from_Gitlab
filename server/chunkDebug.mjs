import { getChunkAuxMetadata } from './behavioralRetrieval.mjs';
import { CHUNK_TYPES } from './semanticChunking.mjs';

export const SECTION4_RETRIEVABLE_WARN_LENGTH = 1500;
export const SECTION4_RETRIEVABLE_MAX_LENGTH = 1800;

function extractSectionNumberPrefix(value) {
    const normalized = String(value || '')
        .replace(/\\/g, '')
        .trim();
    const match = normalized.match(/^(\d+(?:\.\d+)*)/);
    return match?.[1] || '';
}

function getDebugChunkSectionNumber(chunk = {}) {
    const directCandidates = [
        chunk?.sectionNumber,
        chunk?.section_number,
        chunk?.auxMetadata?.sectionNumber,
        chunk?.auxMetadata?.section_number,
        chunk?.metadata?.sectionNumber,
        chunk?.metadata?.section_number
    ];

    for (const candidate of directCandidates) {
        const match = extractSectionNumberPrefix(candidate);
        if (match) {
            return match;
        }
    }

    const sectionPath = Array.isArray(chunk?.sectionPath) ? chunk.sectionPath : [];
    for (let index = sectionPath.length - 1; index >= 0; index -= 1) {
        const match = extractSectionNumberPrefix(sectionPath[index]);
        if (match) {
            return match;
        }
    }

    return '';
}

function getTopLevelSection(chunk = {}) {
    return getDebugChunkSectionNumber(chunk).split('.')[0] || '';
}

function collectSection4RequirementNumbers(chunk = {}) {
    const values = [
        chunk?.text,
        chunk?.coreText,
        chunk?.embeddingText,
        chunk?.rowNumber,
        chunk?.sourceRowId
    ]
        .filter(Boolean)
        .join('\n');

    return Array.from(new Set(
        Array.from(String(values || '').matchAll(/\b4\.\d+\.\d+\b/g)).map((match) => match[0])
    ));
}

function containsExplicitReferenceCue(text) {
    return /(?:см\.?\s*(?:п\.?|пункт|подраздел)|see\s+(?:section|subsection))/iu.test(String(text || ''));
}

export function formatExplicitRefForDebug(ref) {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;

    const type = ref.type ? String(ref.type).trim() : 'ref';
    const target = ref.target ? String(ref.target).trim() : '';
    const original = ref.original ? String(ref.original).trim() : '';

    if (target && original && original !== target) {
        return `${type}:${target} <- ${original}`;
    }
    if (target) {
        return `${type}:${target}`;
    }
    if (original) {
        return `${type}:${original}`;
    }

    return JSON.stringify(ref);
}

export function serializeDebugChunk(chunk, index, { includeFullText = true, maxPreviewLength = 1500 } = {}) {
    const text = String(chunk?.cleaned_text || chunk?.content || '').trim();
    const coreText = String(chunk?.core_text || chunk?.metadata?.core_text || '').trim();
    const embeddingText = String(chunk?.embedding_text || chunk?.metadata?.embedding_text || '').trim();
    const auxMetadata = getChunkAuxMetadata(chunk);
    const chunkGranularity = String(chunk?.chunk_granularity || chunk?.metadata?.chunk_granularity || 'atomic').trim().toLowerCase();
    const parentRowNumber = chunk?.parent_row_number ?? chunk?.metadata?.parent_row_number ?? auxMetadata?.parent_row_number ?? auxMetadata?.row_number ?? null;
    const parentRowId = chunk?.parent_row_id ?? chunk?.metadata?.parent_row_id ?? auxMetadata?.parentRowId ?? auxMetadata?.parent_row_id ?? null;
    const rowNumber = chunk?.row_number ?? chunk?.metadata?.row_number ?? auxMetadata?.rowNumber ?? auxMetadata?.row_number ?? null;
    const sourceRowId = chunk?.source_row_id ?? chunk?.metadata?.source_row_id ?? auxMetadata?.sourceRowId ?? auxMetadata?.source_row_id ?? rowNumber ?? null;
    const atomicRuleKind = chunk?.atomic_rule_kind || chunk?.metadata?.atomic_rule_kind || auxMetadata?.atomic_rule_kind || auxMetadata?.ruleKind || null;
    const sourceType = chunk?.source_type || chunk?.metadata?.source_type || auxMetadata?.sourceType || null;
    const retrievable = chunk?.retrievable != null
        ? Boolean(chunk.retrievable)
        : !(chunk?.exclude_from_retrieval || chunk?.metadata?.exclude_from_retrieval);
    const preview = text.length > maxPreviewLength
        ? `${text.slice(0, maxPreviewLength)}...`
        : text;
    const traceText = chunk?.trace_text || chunk?.metadata?.trace_text || auxMetadata?.traceText || auxMetadata?.trace_text || null;
    const graphEligible = chunk?.metadata?.graph_eligible != null
        ? Boolean(chunk.metadata.graph_eligible)
        : !Boolean(chunk?.exclude_from_graph || chunk?.metadata?.exclude_from_graph);

    return {
        index,
        id: chunk?.id || `chunk-${index}`,
        chunkType: chunk?.chunk_type || null,
        heading: chunk?.heading || null,
        sectionPath: Array.isArray(chunk?.section_path) ? chunk.section_path : [],
        sectionNumber: chunk?.section_number || chunk?.metadata?.section_number || auxMetadata?.sectionNumber || auxMetadata?.section_number || null,
        explicitRefs: Array.isArray(chunk?.explicit_refs) ? chunk.explicit_refs.map(formatExplicitRefForDebug).filter(Boolean) : [],
        excludeFromRetrieval: Boolean(chunk?.exclude_from_retrieval || chunk?.metadata?.exclude_from_retrieval),
        excludeFromGraph: Boolean(chunk?.exclude_from_graph || chunk?.metadata?.exclude_from_graph),
        excludeFromEntityExtraction: Boolean(chunk?.exclude_from_entity_extraction || chunk?.metadata?.exclude_from_entity_extraction),
        isAtomic: Boolean(chunk?.is_atomic),
        isComposite: Boolean(chunk?.is_composite),
        linkedChunkIds: Array.isArray(chunk?.linked_chunk_ids) ? chunk.linked_chunk_ids : [],
        lineageParentSummaryId: chunk?.lineage_parent_summary_id || chunk?.metadata?.lineage_parent_summary_id || null,
        lineageChildRuleIds: Array.isArray(chunk?.lineage_child_rule_ids || chunk?.metadata?.lineage_child_rule_ids)
            ? (chunk?.lineage_child_rule_ids || chunk?.metadata?.lineage_child_rule_ids)
            : [],
        traceOnly: Boolean(chunk?.metadata?.trace_only),
        sourceScope: chunk?.metadata?.source_scope || chunk?.source_scope || auxMetadata?.sourceScope || 'main',
        sourceType,
        graphEligible,
        relevanceScore: Number.isFinite(chunk?.metadata?.relevance_score) ? Number(chunk.metadata.relevance_score) : null,
        canonicalKey: chunk?.canonical_key || chunk?.metadata?.canonical_key || auxMetadata?.canonicalKey || null,
        retrievalClass: chunk?.retrieval_class || chunk?.metadata?.retrieval_class || null,
        eligibilityStatus: chunk?.eligibility_status || chunk?.metadata?.eligibility_status || null,
        contentRatio: chunk?.content_ratio || chunk?.metadata?.content_ratio || null,
        chunkGranularity,
        parentRowNumber,
        parentRowId,
        rowNumber,
        sourceRowId,
        atomicRuleKind,
        retrievable,
        retrievalPenalty: Number.isFinite(chunk?.retrieval_penalty)
            ? Number(chunk.retrieval_penalty)
            : (Number(chunk?.metadata?.retrieval_penalty) || 0),
        dropReason: chunk?.drop_reason || chunk?.metadata?.drop_reason || null,
        auxMetadata,
        length: text.length,
        preview,
        ...(includeFullText ? {
            text,
            coreText,
            embeddingText,
            traceText
        } : {})
    };
}

export function buildRequirementChunkDiagnostics(chunks = []) {
    const list = Array.isArray(chunks) ? chunks : [];
    const section4RetrievableChunks = list.filter((chunk) =>
        chunk?.retrievable &&
        getTopLevelSection(chunk) === '4'
    );
    const section4AtomicRules = list.filter((chunk) =>
        chunk?.chunkType === CHUNK_TYPES.ATOMIC_RULE &&
        chunk?.retrievable &&
        getTopLevelSection(chunk) === '4'
    );
    const section4Summaries = list.filter((chunk) =>
        chunk?.chunkType === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY &&
        getTopLevelSection(chunk) === '4'
    );
    const excludedBackgroundChunks = list.filter((chunk) =>
        chunk?.excludeFromRetrieval &&
        ['1', '2', '3', '5', '7'].includes(getTopLevelSection(chunk))
    );
    const excludedChunks = list
        .filter((chunk) => chunk?.excludeFromRetrieval)
        .map((chunk) => ({
            id: chunk.id,
            type: chunk.chunkType,
            heading: chunk.heading,
            rowNumber: chunk.rowNumber || chunk.sourceRowId || null,
            reason: chunk.dropReason || 'excluded'
        }));

    const qualityGates = [];
    for (const chunk of section4RetrievableChunks) {
        const sectionPathText = Array.isArray(chunk.sectionPath) ? chunk.sectionPath.join(' > ') : '';
        const requirementNumbers = collectSection4RequirementNumbers(chunk);
        const fullText = [chunk.text, chunk.coreText, chunk.embeddingText].filter(Boolean).join('\n');

        if (chunk.length > SECTION4_RETRIEVABLE_MAX_LENGTH) {
            qualityGates.push({
                severity: 'error',
                code: 'section4_chunk_too_long',
                chunkId: chunk.id,
                message: `Retrievable section 4 chunk exceeds ${SECTION4_RETRIEVABLE_MAX_LENGTH} chars`
            });
        }
        if (chunk.chunkType === CHUNK_TYPES.ATOMIC_RULE && requirementNumbers.length > 1) {
            qualityGates.push({
                severity: 'error',
                code: 'section4_multi_requirement_chunk',
                chunkId: chunk.id,
                message: `Retrievable section 4 chunk contains multiple requirement numbers: ${requirementNumbers.join(', ')}`
            });
        }
        if ((sectionPathText.startsWith('4') || getTopLevelSection(chunk) === '4') && chunk.chunkType === CHUNK_TYPES.API_ENDPOINT_SUMMARY) {
            qualityGates.push({
                severity: 'error',
                code: 'section4_api_summary',
                chunkId: chunk.id,
                message: 'Section 4 retrievable chunk was classified as api_endpoint_summary'
            });
        }
        if (
            chunk.chunkType === CHUNK_TYPES.ATOMIC_RULE &&
            containsExplicitReferenceCue(fullText) &&
            (!Array.isArray(chunk.explicitRefs) || chunk.explicitRefs.length === 0)
        ) {
            qualityGates.push({
                severity: 'error',
                code: 'missing_explicit_refs',
                chunkId: chunk.id,
                message: 'Explicit textual references were found without explicitRefs metadata'
            });
        }
    }

    if (section4AtomicRules.length === 0) {
        qualityGates.push({
            severity: 'error',
            code: 'missing_section4_atomic_rules',
            chunkId: null,
            message: 'Section 4 produced no atomic_rule chunks'
        });
    }

    return {
        stats: {
            requirementRowCount: section4Summaries.length,
            atomicRuleCount: section4AtomicRules.length,
            averageAtomicRuleLength: section4AtomicRules.length > 0
                ? Number((section4AtomicRules.reduce((sum, chunk) => sum + (chunk.length || 0), 0) / section4AtomicRules.length).toFixed(2))
                : 0,
            excludedBackgroundChunkCount: excludedBackgroundChunks.length,
            explicitRefCount: list.reduce((sum, chunk) => sum + (Array.isArray(chunk?.explicitRefs) ? chunk.explicitRefs.length : 0), 0),
            apiDependencyCount: section4AtomicRules.reduce((sum, chunk) => {
                const aux = chunk?.auxMetadata || {};
                const refs = Array.isArray(aux.apiDependencyRefs) ? aux.apiDependencyRefs : [];
                const methodRefs = Array.isArray(aux.methodRefs) ? aux.methodRefs : [];
                return sum + (refs.length > 0 || methodRefs.length > 0 ? 1 : 0);
            }, 0),
            graphEligibleChunkCount: list.filter((chunk) => chunk?.graphEligible).length,
            excludedChunks
        },
        qualityGates
    };
}

export function renderChunkMarkdownSection(title, chunkGroup, { includeSourceText = true } = {}) {
    if (!chunkGroup) return `## ${title}\n\nНет данных.\n`;

    const diagnostics = buildRequirementChunkDiagnostics(chunkGroup.chunks || []);
    const lines = [
        `## ${title}`,
        '',
        `- title: ${chunkGroup.title || '—'}`,
        `- length: ${chunkGroup.length || 0}`,
        `- chunkCount: ${chunkGroup.chunkCount || 0}`,
        ''
    ];

    if (diagnostics.stats.requirementRowCount > 0 || diagnostics.stats.atomicRuleCount > 0 || diagnostics.qualityGates.length > 0) {
        lines.push('### Chunking Summary');
        lines.push('');
        lines.push(`- requirementRowCount: ${diagnostics.stats.requirementRowCount}`);
        lines.push(`- atomicRuleCount: ${diagnostics.stats.atomicRuleCount}`);
        lines.push(`- averageAtomicRuleLength: ${diagnostics.stats.averageAtomicRuleLength}`);
        lines.push(`- excludedBackgroundChunkCount: ${diagnostics.stats.excludedBackgroundChunkCount}`);
        lines.push(`- explicitRefCount: ${diagnostics.stats.explicitRefCount}`);
        lines.push(`- apiDependencyCount: ${diagnostics.stats.apiDependencyCount}`);
        lines.push(`- graphEligibleChunkCount: ${diagnostics.stats.graphEligibleChunkCount}`);
        lines.push(`- excludedChunks: ${diagnostics.stats.excludedChunks.length}`);
        if (diagnostics.qualityGates.length > 0) {
            lines.push(`- qualityGates: ${diagnostics.qualityGates.length}`);
        }
        lines.push('');
    }

    if (includeSourceText && chunkGroup.text) {
        lines.push('### Source Text');
        lines.push('');
        lines.push('```text');
        lines.push(chunkGroup.text);
        lines.push('```');
        lines.push('');
    }

    for (const chunk of chunkGroup.chunks || []) {
        const contentRatioText = chunk.contentRatio == null
            ? 'n/a'
            : (typeof chunk.contentRatio === 'object' ? JSON.stringify(chunk.contentRatio) : String(chunk.contentRatio));
        lines.push(`### Chunk ${chunk.index + 1}`);
        lines.push('');
        lines.push(`- id: ${chunk.id}`);
        lines.push(`- type: ${chunk.chunkType || 'n/a'}`);
        lines.push(`- granularity: ${chunk.chunkGranularity || 'n/a'}`);
        lines.push(`- retrievable: ${chunk.retrievable ? 'yes' : 'no'}`);
        lines.push(`- heading: ${chunk.heading || 'n/a'}`);
        lines.push(`- length: ${chunk.length}`);
        lines.push(`- sectionPath: ${(chunk.sectionPath || []).join(' > ') || 'n/a'}`);
        lines.push(`- sectionNumber: ${chunk.sectionNumber || 'n/a'}`);
        lines.push(`- rowNumber: ${chunk.rowNumber || 'n/a'}`);
        lines.push(`- sourceRowId: ${chunk.sourceRowId || 'n/a'}`);
        lines.push(`- parentRowId: ${chunk.parentRowId || 'n/a'}`);
        lines.push(`- explicitRefs: ${(chunk.explicitRefs || []).join(', ') || 'n/a'}`);
        lines.push(`- sourceType: ${chunk.sourceType || 'n/a'}`);
        lines.push(`- sourceScope: ${chunk.sourceScope || 'n/a'}`);
        lines.push(`- parentRow: ${chunk.parentRowNumber == null ? 'n/a' : chunk.parentRowNumber}`);
        lines.push(`- atomicRuleKind: ${chunk.atomicRuleKind || 'n/a'}`);
        lines.push(`- lineageParentSummaryId: ${chunk.lineageParentSummaryId || 'n/a'}`);
        lines.push(`- lineageChildRuleIds: ${(chunk.lineageChildRuleIds || []).join(', ') || 'n/a'}`);
        lines.push(`- traceOnly: ${chunk.traceOnly ? 'yes' : 'no'}`);
        lines.push(`- excludeFromRetrieval: ${chunk.excludeFromRetrieval ? 'yes' : 'no'}`);
        lines.push(`- excludeFromGraph: ${chunk.excludeFromGraph ? 'yes' : 'no'}`);
        lines.push(`- excludeFromEntityExtraction: ${chunk.excludeFromEntityExtraction ? 'yes' : 'no'}`);
        lines.push(`- graphEligible: ${chunk.graphEligible == null ? 'n/a' : (chunk.graphEligible ? 'yes' : 'no')}`);
        lines.push(`- relevanceScore: ${chunk.relevanceScore == null ? 'n/a' : chunk.relevanceScore}`);
        lines.push(`- canonicalKey: ${chunk.canonicalKey || 'n/a'}`);
        lines.push(`- retrievalClass: ${chunk.retrievalClass || 'n/a'}`);
        lines.push(`- eligibilityStatus: ${chunk.eligibilityStatus || 'n/a'}`);
        lines.push(`- contentRatio: ${contentRatioText}`);
        lines.push(`- retrievalPenalty: ${chunk.retrievalPenalty == null ? 'n/a' : chunk.retrievalPenalty}`);
        lines.push(`- dropReason: ${chunk.dropReason || 'n/a'}`);
        lines.push(`- auxMetadata: ${Object.keys(chunk.auxMetadata || {}).length ? JSON.stringify(chunk.auxMetadata) : 'n/a'}`);
        lines.push('');
        lines.push('```text');
        lines.push(chunk.text || chunk.preview || '');
        lines.push('```');
        lines.push('');
        if (chunk.coreText) {
            lines.push('```text');
            lines.push(`CORE_TEXT:\n${chunk.coreText}`);
            lines.push('```');
            lines.push('');
        }
        if (chunk.embeddingText) {
            lines.push('```text');
            lines.push(`EMBEDDING_TEXT:\n${chunk.embeddingText}`);
            lines.push('```');
            lines.push('');
        }
        if (chunk.traceText) {
            lines.push('```text');
            lines.push(`TRACE_TEXT:\n${chunk.traceText}`);
            lines.push('```');
            lines.push('');
        }
    }

    if (diagnostics.qualityGates.length > 0) {
        lines.push('### Quality Gates');
        lines.push('');
        for (const gate of diagnostics.qualityGates) {
            lines.push(`- ${gate.severity}: ${gate.code}${gate.chunkId ? ` (${gate.chunkId})` : ''} - ${gate.message}`);
        }
        lines.push('');
    }

    if (diagnostics.stats.excludedChunks.length > 0) {
        lines.push('### Excluded Chunks');
        lines.push('');
        for (const excludedChunk of diagnostics.stats.excludedChunks) {
            lines.push(`- ${excludedChunk.id}: ${excludedChunk.type || 'n/a'} / ${excludedChunk.rowNumber || 'n/a'} / ${excludedChunk.reason}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

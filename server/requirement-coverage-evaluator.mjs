import { createHash } from 'crypto';

import { getEmbeddingWithModel } from './pgvectorStore.mjs';

export const REQUIREMENT_COVERAGE_THRESHOLD_PROFILE = 'hybrid-v1';
export const REQUIREMENT_COVERAGE_MODELS = Object.freeze({
    preferred: 'Qwen/Qwen3-Embedding-0.6B',
    fallback: 'BAAAI/bge-m3'
});
export const MANUAL_ATOM_COVERAGE_SOURCE = 'manual_atom_registry';
export const CANONICAL_CHUNKS_COVERAGE_SOURCE = 'canonical_chunks_approximation';

export const DEFAULT_REQUIREMENT_COVERAGE_CONFIG = Object.freeze({
    thresholdProfile: REQUIREMENT_COVERAGE_THRESHOLD_PROFILE,
    embeddingModels: REQUIREMENT_COVERAGE_MODELS,
    maxSemanticContextChars: 700,
    lowConfidenceWindow: 0.05,
    thresholds: {
        covered: 0.70,
        partial: 0.52,
        needsReviewHardCoverageSlack: 0.10,
        needsReviewSoftCoverageMin: 0.68,
        needsReviewPartialCoverageMin: 0.20,
        needsReviewHighPartialCoverageMin: 0.90,
        needsReviewHighPartialSoftCoverageMin: 0.56,
        needsReviewStrongPartialCoverageMin: 0.50
    },
    weights: {
        embeddingEnabled: {
            embeddingScore: 0.55,
            lexicalOverlap: 0.25,
            phraseOverlap: 0.10,
            explicitBoost: 0.10
        },
        lexicalOnly: {
            lexicalOverlap: 0.55,
            phraseOverlap: 0.25,
            explicitBoost: 0.20
        }
    },
    explicitBoost: {
        strong: 1.0,
        medium: 0.55
    },
    retry: {
        maxExamples: 20,
        maxCoveredSignatures: 80
    },
    verifier: {
        topK: 8
    },
    qualityThresholds: {
        passedStrictCoverage: 0.80,
        passedPotentialCoverage: 0.95,
        passedMaxNotCoveredRatio: 0.05,
        passedMaxIncompleteLeafRate: 0.05,
        needsReviewStrictCoverage: 0.55,
        needsReviewPotentialCoverage: 0.75
    }
});

const embeddingCache = new Map();

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'by', 'can', 'for', 'from', 'has', 'have',
    'in', 'into', 'is', 'it', 'must', 'of', 'on', 'or', 'should', 'the', 'to', 'when', 'with',
    'user', 'system', 'customer', 'client', 'feature', 'story', 'scenario', 'code',
    'i', 'ii', 'iii', 'iv', 'v',
    'и', 'в', 'во', 'на', 'по', 'для', 'при', 'если', 'то', 'как', 'что', 'или', 'а', 'с', 'со',
    'из', 'к', 'ко', 'от', 'до', 'после', 'перед', 'должен', 'должна', 'должно', 'может',
    'пользователь', 'система', 'клиент'
]);

const ROLE_TOKENS = new Set([
    'admin', 'administrator', 'manager', 'operator', 'guest', 'customer', 'client', 'user',
    'blocked', 'active', 'anonymous', 'authorized', 'unauthorized',
    'администратор', 'менеджер', 'оператор', 'гость', 'клиент', 'пользователь',
    'заблокирован', 'активный', 'анонимный', 'авторизован'
]);

const STATUS_TOKENS = new Set([
    'success', 'successful', 'error', 'failed', 'failure', 'rejected', 'reject', 'approved', 'approve',
    'blocked', 'denied', 'forbidden', 'valid', 'invalid', 'created', 'updated', 'deleted',
    'успех', 'успешно', 'ошибка', 'отклонен', 'отклонено', 'одобрен', 'запрещено',
    'создан', 'обновлен', 'удален', 'валидный', 'невалидный'
]);

function deepMerge(base, override = {}) {
    if (!override || typeof override !== 'object') {
        return { ...base };
    }

    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            base[key] &&
            typeof base[key] === 'object' &&
            !Array.isArray(base[key])
        ) {
            result[key] = deepMerge(base[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function mergeConfig(config = {}) {
    return deepMerge(DEFAULT_REQUIREMENT_COVERAGE_CONFIG, config);
}

function roundScore(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}

function textHash(text) {
    return createHash('sha256').update(normalizeText(text)).digest('hex').slice(0, 16);
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N}/._:-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeIdentifier(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/giu, '');
}

function normalizeSectionPath(sectionPath) {
    const parts = Array.isArray(sectionPath)
        ? sectionPath
        : String(sectionPath || '').split(/[>/|]+/);

    return parts
        .map((part) => normalizeText(part))
        .filter(Boolean)
        .join(' > ');
}

function displaySectionPath(sectionPath) {
    const parts = Array.isArray(sectionPath)
        ? sectionPath
        : String(sectionPath || '').split(/[>/|]+/);

    return parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' > ');
}

function getChunkText(chunk) {
    return String(
        chunk?.cleaned_text ||
        chunk?.core_text ||
        chunk?.content ||
        chunk?.embedding_text ||
        chunk?.text ||
        ''
    ).trim();
}

function getDocumentId(chunk) {
    return String(chunk?.documentId || chunk?.doc_id || chunk?.docId || chunk?.metadata?.doc_id || 'unknown-document');
}

function getRequirementId(chunk) {
    return String(
        chunk?.requirement_id ||
        chunk?.requirementId ||
        chunk?.metadata?.requirement_id ||
        chunk?.metadata?.requirementId ||
        ''
    ).trim();
}

function getSourceRowId(chunk) {
    return String(
        chunk?.sourceRowId ||
        chunk?.source_row_id ||
        chunk?.metadata?.source_row_id ||
        chunk?.metadata?.sourceRowId ||
        chunk?.parent_row_number ||
        chunk?.metadata?.parent_row_number ||
        getRequirementId(chunk) ||
        chunk?.id ||
        ''
    ).trim();
}

function getAtomicRuleIndex(chunk, fallbackIndex = 0) {
    const value =
        chunk?.atomicRuleIndex ??
        chunk?.atomic_rule_index ??
        chunk?.metadata?.atomicRuleIndex ??
        chunk?.metadata?.atomic_rule_index;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallbackIndex;
}

function flattenExplicitRefs(refs) {
    if (!Array.isArray(refs)) {
        return [];
    }

    return refs
        .map((ref) => {
            if (typeof ref === 'string') {
                return { type: 'unknown', value: ref };
            }
            return {
                type: String(ref?.type || ref?.kind || ref?.ref_type || 'unknown'),
                value: String(ref?.value || ref?.text || ref?.name || ref?.endpoint || ref?.path || '')
            };
        })
        .filter((ref) => ref.value.trim());
}

function extractEndpoints(text) {
    const normalized = String(text || '');
    const endpoints = new Set();
    const withMethod = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;={}-]+)/gi;
    let match;
    while ((match = withMethod.exec(normalized)) !== null) {
        endpoints.add(`${match[1].toUpperCase()} ${match[2].toLowerCase()}`);
    }

    const pathOnly = /(^|\s)(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;={}-]{2,})/g;
    while ((match = pathOnly.exec(normalized)) !== null) {
        endpoints.add(match[2].toLowerCase());
    }

    return [...endpoints];
}

function extractParams(text) {
    const params = new Set();
    const patterns = [
        /\bparam(?:eter)?[:=]\s*([A-Za-zА-Яа-я0-9_.-]+)/gi,
        /\b(query|body|header)\.([A-Za-zА-Яа-я0-9_.-]+)/gi,
        /\{([A-Za-zА-Яа-я0-9_.-]+)\}/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(String(text || ''))) !== null) {
            params.add(String(match[2] || match[1] || '').toLowerCase());
        }
    }

    return [...params].filter(Boolean);
}

function buildStableId({ documentId, sectionPath, sourceRowId, requirementId, atomicRuleIndex, normalizedRequirementText }) {
    const sourceKey = String(sourceRowId || requirementId || 'no-source-row').trim();
    return [
        documentId,
        normalizeSectionPath(sectionPath),
        sourceKey,
        atomicRuleIndex,
        textHash(normalizedRequirementText)
    ].join('|');
}

function buildRequirementCoverageUnit(chunk, index) {
    const text = getChunkText(chunk);
    const normalizedRequirementText = normalizeText(text);
    if (!normalizedRequirementText) {
        return null;
    }

    const documentId = getDocumentId(chunk);
    const sectionPath = Array.isArray(chunk?.section_path)
        ? chunk.section_path
        : Array.isArray(chunk?.metadata?.section_path)
            ? chunk.metadata.section_path
            : [];
    const sourceRowId = getSourceRowId(chunk);
    const requirementId = getRequirementId(chunk);
    const atomicRuleIndex = getAtomicRuleIndex(chunk, chunk?.chunk_type === 'atomic_rule' ? index + 1 : 0);
    const explicitRefs = [
        ...flattenExplicitRefs(chunk?.explicit_refs),
        ...flattenExplicitRefs(chunk?.metadata?.explicit_refs)
    ];
    const endpoints = [
        ...extractEndpoints(text),
        ...explicitRefs
            .filter((ref) => /endpoint|api|path/i.test(ref.type))
            .map((ref) => ref.value)
    ];
    const params = [
        ...extractParams(text),
        ...explicitRefs
            .filter((ref) => /param|field/i.test(ref.type))
            .map((ref) => ref.value)
    ];

    return {
        stableId: buildStableId({
            documentId,
            sectionPath,
            sourceRowId,
            requirementId,
            atomicRuleIndex,
            normalizedRequirementText
        }),
        documentId,
        coverageSource: CANONICAL_CHUNKS_COVERAGE_SOURCE,
        sourceChunkId: chunk?.id || null,
        sourceRowId,
        requirementId,
        atomicRuleIndex,
        sectionPath,
        sectionPathDisplay: displaySectionPath(sectionPath),
        sectionPathText: normalizeSectionPath(sectionPath),
        chunkType: chunk?.chunk_type || chunk?.metadata?.chunk_type || null,
        text,
        normalizedText: normalizedRequirementText,
        textHash: textHash(normalizedRequirementText),
        contentHash: textHash(normalizedRequirementText),
        explicitRefs,
        endpoints: [...new Set(endpoints.map(normalizeEndpoint).filter(Boolean))],
        params: [...new Set(params.map((param) => normalizeText(param)).filter(Boolean))],
        requiresApiEvidence: endpoints.length > 0 || params.length > 0,
        requiresCodeLevelBehavior: true
    };
}

export function buildRequirementCoverageUnits(chunks = []) {
    const sourceRowsWithAtomicRules = new Set();
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
        const chunkType = chunk?.chunk_type || chunk?.metadata?.chunk_type;
        if (chunkType === 'atomic_rule') {
            sourceRowsWithAtomicRules.add(getSourceRowId(chunk));
        }
    }

    const units = [];
    for (const [index, chunk] of (Array.isArray(chunks) ? chunks : []).entries()) {
        const chunkType = chunk?.chunk_type || chunk?.metadata?.chunk_type;
        if (chunkType !== 'atomic_rule' && chunkType !== 'requirement_row_summary') {
            continue;
        }

        if (chunkType === 'requirement_row_summary' && sourceRowsWithAtomicRules.has(getSourceRowId(chunk))) {
            continue;
        }

        const unit = buildRequirementCoverageUnit(chunk, index);
        if (unit) {
            units.push(unit);
        }
    }

    return units;
}

function optionalText(label, value) {
    const text = String(value || '').trim();
    return text ? `${label}: ${text}` : null;
}

function collectSemanticContext(items, maxChars) {
    const context = items
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('\n');
    return context.slice(0, maxChars);
}

export function buildBranchText({ feature, story, scenario, code, config = {} }) {
    const mergedConfig = mergeConfig(config);
    const semanticContext = collectSemanticContext([
        feature?.semanticContext,
        story?.semanticContext,
        scenario?.semanticContext,
        code?.semanticContext
    ], mergedConfig.maxSemanticContextChars);

    return [
        optionalText('Feature', feature?.text),
        optionalText('Story', story?.text),
        optionalText('Scenario', scenario?.text),
        optionalText('Code', code?.text),
        optionalText('Description', code?.description || scenario?.description || story?.description || feature?.description),
        optionalText('Expected result', code?.expectedResult || code?.expected || scenario?.expectedResult || scenario?.expected),
        optionalText('Semantic context', semanticContext)
    ].filter(Boolean).join('\n');
}

export function buildMatchedBranchSignature({ feature, story, scenario, code }) {
    return [
        normalizeText(feature?.text),
        normalizeText(story?.text),
        normalizeText(scenario?.text),
        normalizeText(code?.text)
    ].filter(Boolean).join(' > ');
}

export function collectLeafBranches(model = [], options = {}) {
    const config = mergeConfig(options.config || {});
    const branches = [];

    const pushBranch = ({ feature, story, scenario, code = null, indexes, incompleteLeaf = false }) => {
        const { featureIndex, storyIndex, scenarioIndex, codeIndex } = indexes;
        const branchText = buildBranchText({ feature, story, scenario, code, config });
        if (!normalizeText(branchText)) {
            return;
        }
        const matchedBranchSignature = buildMatchedBranchSignature({ feature, story, scenario, code });
        const branchTextHash = textHash(branchText);
        const branchId = incompleteLeaf
            ? `${feature?.id || featureIndex}/${story?.id || storyIndex}/${scenario?.id || scenarioIndex}/__scenario_leaf__`
            : `${feature?.id || featureIndex}/${story?.id || storyIndex}/${scenario?.id || scenarioIndex}/${code?.id || codeIndex}`;
        branches.push({
            stableId: `${matchedBranchSignature}|${branchTextHash}`,
            branchId,
            featureId: feature?.id || null,
            storyId: story?.id || null,
            scenarioId: scenario?.id || null,
            codeId: incompleteLeaf ? null : code?.id || null,
            featureText: String(feature?.text || ''),
            storyText: String(story?.text || ''),
            scenarioText: String(scenario?.text || ''),
            codeText: incompleteLeaf ? '' : String(code?.text || ''),
            branchText,
            normalizedText: normalizeText(branchText),
            textHash: branchTextHash,
            matchedBranchSignature,
            incompleteLeaf,
            endpoints: extractEndpoints(branchText).map(normalizeEndpoint).filter(Boolean),
            params: extractParams(branchText).map((param) => normalizeText(param)).filter(Boolean),
            identifierText: [
                feature?.id,
                story?.id,
                scenario?.id,
                incompleteLeaf ? null : code?.id,
                branchId
            ].map(normalizeIdentifier).filter(Boolean).join(' ')
        });
    };

    for (const [featureIndex, feature] of (Array.isArray(model) ? model : []).entries()) {
        const stories = Array.isArray(feature?.stories) ? feature.stories : [];
        for (const [storyIndex, story] of stories.entries()) {
            const scenarios = Array.isArray(story?.scenarios) ? story.scenarios : [];
            for (const [scenarioIndex, scenario] of scenarios.entries()) {
                const codes = Array.isArray(scenario?.codes) ? scenario.codes : [];
                const nonEmptyCodes = codes.filter((code) => normalizeText(code?.text));
                if (nonEmptyCodes.length === 0) {
                    pushBranch({
                        feature,
                        story,
                        scenario,
                        code: null,
                        indexes: { featureIndex, storyIndex, scenarioIndex, codeIndex: null },
                        incompleteLeaf: true
                    });
                    continue;
                }
                for (const [codeIndex, code] of codes.entries()) {
                    if (!normalizeText(code?.text)) {
                        continue;
                    }
                    pushBranch({
                        feature,
                        story,
                        scenario,
                        code,
                        indexes: { featureIndex, storyIndex, scenarioIndex, codeIndex },
                        incompleteLeaf: false
                    });
                }
            }
        }
    }

    return branches;
}

function stemToken(token) {
    return token
        .replace(/(ing|ed|es|s)$/i, '')
        .replace(/(ами|ями|ого|ему|ыми|ими|ая|ое|ые|ий|ый|ой|ам|ям|ах|ях|ов|ев|ом|ем|а|я|ы|и|е|у|ю)$/iu, '');
}

function tokenize(text) {
    const normalized = normalizeText(text)
        .replace(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gi, ' ')
        .replace(/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;={}-]+/g, ' ')
        .replace(/\bREQ[-_]?\d+\b/gi, ' ');
    const matches = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];

    return matches
        .map((token) => token.replace(/^req[-_]?/i, ''))
        .map(stemToken)
        .filter((token) => token.length > 1 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function tokenSet(text) {
    return new Set(tokenize(text));
}

function intersection(left, right) {
    const values = [];
    for (const value of left) {
        if (right.has(value)) {
            values.push(value);
        }
    }
    return values;
}

function lexicalOverlap(unit, branch) {
    const requirementTokens = tokenSet(unit.text);
    const branchTokens = tokenSet(branch.branchText);
    if (requirementTokens.size === 0 || branchTokens.size === 0) {
        return 0;
    }
    return roundScore(intersection(requirementTokens, branchTokens).length / requirementTokens.size);
}

function buildNgrams(tokens, size) {
    const ngrams = [];
    for (let index = 0; index <= tokens.length - size; index += 1) {
        ngrams.push(tokens.slice(index, index + size).join(' '));
    }
    return ngrams;
}

function phraseOverlap(unit, branch) {
    const requirementTokens = tokenize(unit.text);
    if (requirementTokens.length < 2) {
        return 0;
    }

    const branchText = ` ${normalizeText(branch.branchText)} `;
    const phrases = [
        ...buildNgrams(requirementTokens, 2),
        ...buildNgrams(requirementTokens, 3),
        ...buildNgrams(requirementTokens, 4)
    ];
    if (phrases.length === 0) {
        return 0;
    }

    const matched = phrases.filter((phrase) => branchText.includes(` ${phrase} `)).length;
    return roundScore(matched / phrases.length);
}

function normalizeEndpoint(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    const withMethod = text.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
    if (withMethod) {
        return `${withMethod[1].toUpperCase()} ${withMethod[2].toLowerCase()}`;
    }
    return text.toLowerCase();
}

function refsIntersect(left = [], right = []) {
    const rightSet = new Set(right.filter(Boolean));
    return left.filter((value) => rightSet.has(value));
}

function statusRefs(text) {
    const tokens = tokenSet(text);
    const statuses = new Set();
    for (const token of tokens) {
        if (STATUS_TOKENS.has(token)) {
            statuses.add(token);
        }
    }

    const codes = String(text || '').match(/\b[1-5]\d\d\b/g) || [];
    for (const code of codes) {
        statuses.add(code);
    }

    return statuses;
}

function roleRefs(text) {
    const tokens = tokenSet(text);
    const roles = new Set();
    for (const token of tokens) {
        if (ROLE_TOKENS.has(token)) {
            roles.add(token);
        }
    }
    return roles;
}

function expectedBehaviorSignal(unit, branch) {
    const unitStatuses = statusRefs(unit.text);
    const branchStatuses = statusRefs(branch.branchText);
    const statusSignalMatch = unitStatuses.size > 0 && intersection(unitStatuses, branchStatuses).length > 0;

    const unitRoles = roleRefs(unit.text);
    const branchRoles = roleRefs(branch.branchText);
    const roleSignalMatch = unitRoles.size > 0 && intersection(unitRoles, branchRoles).length > 0;

    const requirementTokens = tokenSet(unit.text);
    const branchTokens = tokenSet(branch.branchText);
    const sharedBehaviorTokens = intersection(requirementTokens, branchTokens)
        .filter((token) => !STATUS_TOKENS.has(token) && !ROLE_TOKENS.has(token));
    const behaviorSignalMatch = sharedBehaviorTokens.length >= 2;

    return {
        statusSignalMatch,
        roleSignalMatch,
        expectedSignalMatch: statusSignalMatch,
        behaviorSignalMatch,
        sharedBehaviorTokens
    };
}

function explicitSignals(unit, branch, config) {
    const normalizedBranchIdentifierText = [
        normalizeIdentifier(branch.branchText),
        branch.identifierText
    ].filter(Boolean).join(' ');
    const strongRefs = [...new Set([
        normalizeIdentifier(unit.requirementId),
        normalizeIdentifier(unit.sourceRowId)
    ].filter(Boolean))];
    const strongMatches = strongRefs.filter((ref) => normalizedBranchIdentifierText.includes(ref));

    const endpointMatches = refsIntersect(unit.endpoints || [], branch.endpoints || []);
    const paramMatches = refsIntersect(unit.params || [], branch.params || []);
    const methodRefs = [
        unit.method_ref,
        unit.method_name,
        unit.http_method
    ].map(normalizeIdentifier).filter(Boolean);
    const methodMatches = methodRefs.filter((ref) => normalizedBranchIdentifierText.includes(ref));
    const hasStrong = strongMatches.length > 0;
    const hasMedium = endpointMatches.length > 0 || paramMatches.length > 0 || methodMatches.length > 0;

    const explicitBoost = hasStrong
        ? config.explicitBoost.strong
        : hasMedium
            ? config.explicitBoost.medium
            : 0;
    const behaviorSignals = expectedBehaviorSignal(unit, branch);
    const endpointOnly =
        !hasStrong &&
        endpointMatches.length > 0 &&
        paramMatches.length === 0 &&
        methodMatches.length === 0 &&
        !behaviorSignals.expectedSignalMatch &&
        !behaviorSignals.roleSignalMatch &&
        !behaviorSignals.statusSignalMatch &&
        !behaviorSignals.behaviorSignalMatch;

    return {
        explicitBoost,
        strongMatches,
        endpointMatches,
        paramMatches,
        methodMatches,
        hasApiEvidence: endpointMatches.length > 0 || paramMatches.length > 0 || methodMatches.length > 0,
        endpointOnly,
        ...behaviorSignals
    };
}

export function computeHybridMatchScore({
    embeddingScore = 0,
    lexicalOverlap = 0,
    phraseOverlap = 0,
    explicitBoost = 0,
    embeddingEnabled = true,
    config = {}
} = {}) {
    const mergedConfig = mergeConfig(config);
    const weights = embeddingEnabled
        ? mergedConfig.weights.embeddingEnabled
        : mergedConfig.weights.lexicalOnly;
    const rawScore = embeddingEnabled
        ? (
            (weights.embeddingScore || 0) * embeddingScore +
            (weights.lexicalOverlap || 0) * lexicalOverlap +
            (weights.phraseOverlap || 0) * phraseOverlap +
            (weights.explicitBoost || 0) * explicitBoost
        )
        : (
            (weights.lexicalOverlap || 0) * lexicalOverlap +
            (weights.phraseOverlap || 0) * phraseOverlap +
            (weights.explicitBoost || 0) * explicitBoost
        );

    return {
        finalScore: roundScore(rawScore),
        weightsUsed: weights
    };
}

export function cosineSimilarity(left = [], right = []) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
        return 0;
    }

    const size = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < size; index += 1) {
        const a = Number(left[index]) || 0;
        const b = Number(right[index]) || 0;
        dot += a * b;
        leftNorm += a * a;
        rightNorm += b * b;
    }

    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }

    return roundScore(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

export function clearRequirementCoverageEmbeddingCache() {
    embeddingCache.clear();
}

function embeddingCacheKey(item, model) {
    return `${item.stableId}|${item.textHash}|${model}`;
}

async function resolveEmbeddingsForModel({ items, model, apiKey, embeddingClient }) {
    const embeddings = new Map();
    const byTextHash = new Map();
    const tempCache = new Map();

    for (const item of items) {
        const key = embeddingCacheKey(item, model);
        if (embeddingCache.has(key)) {
            embeddings.set(item.stableId, embeddingCache.get(key));
            continue;
        }

        if (!byTextHash.has(item.textHash)) {
            byTextHash.set(item.textHash, []);
        }
        byTextHash.get(item.textHash).push(item);
    }

    for (const group of byTextHash.values()) {
        const cached = group
            .map((item) => embeddingCache.get(embeddingCacheKey(item, model)))
            .find((value) => Array.isArray(value));

        if (cached) {
            for (const item of group) {
                embeddings.set(item.stableId, cached);
            }
            continue;
        }

        const vector = await embeddingClient(group[0].text, apiKey, model);
        if (!Array.isArray(vector) || vector.length === 0) {
            throw new Error(`Embedding model ${model} returned an empty vector.`);
        }

        for (const item of group) {
            embeddings.set(item.stableId, vector);
            tempCache.set(embeddingCacheKey(item, model), vector);
        }
    }

    for (const [key, vector] of tempCache.entries()) {
        embeddingCache.set(key, vector);
    }

    return embeddings;
}

async function resolveEmbeddingMatrix({ units, branches, apiKey, embeddingClient, config }) {
    const items = [
        ...units.map((unit) => ({
            stableId: unit.stableId,
            textHash: unit.textHash,
            text: unit.text
        })),
        ...branches.map((branch) => ({
            stableId: branch.stableId,
            textHash: branch.textHash,
            text: branch.branchText
        }))
    ];

    if (items.length === 0) {
        return {
            embeddingDisabled: false,
            embeddingModelUsed: config.embeddingModels.preferred,
            embeddings: new Map(),
            modelsTried: []
        };
    }

    const models = [config.embeddingModels.preferred, config.embeddingModels.fallback].filter(Boolean);
    const modelsTried = [];
    for (const model of models) {
        try {
            modelsTried.push(model);
            const embeddings = await resolveEmbeddingsForModel({ items, model, apiKey, embeddingClient });
            return {
                embeddingDisabled: false,
                embeddingModelUsed: model,
                embeddings,
                modelsTried
            };
        } catch (error) {
            console.warn(`[requirementCoverage] Embedding model ${model} failed; discarding this embedding run: ${error.message}`);
        }
    }

    return {
        embeddingDisabled: true,
        embeddingModelUsed: null,
        embeddings: new Map(),
        modelsTried
    };
}

function scoreStatus(finalScore, thresholds) {
    if (finalScore >= thresholds.covered) {
        return 'covered';
    }
    if (finalScore >= thresholds.partial) {
        return 'partial';
    }
    return 'uncovered';
}

function legacyToCoverageStatus(status) {
    if (status === 'covered') {
        return 'strong';
    }
    if (status === 'partial') {
        return 'partial';
    }
    return 'not_covered';
}

function coverageToLegacyStatus(status) {
    if (status === 'strong') {
        return 'covered';
    }
    if (status === 'partial') {
        return 'partial';
    }
    return 'uncovered';
}

function capFinalScoreToPartial(finalScore, config) {
    if (finalScore >= config.thresholds.covered) {
        return roundScore(config.thresholds.covered - 0.01);
    }
    return finalScore;
}

function isLowConfidence(finalScore, thresholds, window) {
    return (
        Math.abs(finalScore - thresholds.covered) <= window ||
        Math.abs(finalScore - thresholds.partial) <= window
    );
}

function buildMatch({ unit, branch, embeddingScore, embeddingEnabled, config }) {
    const lexical = lexicalOverlap(unit, branch);
    const phrase = phraseOverlap(unit, branch);
    const explicit = explicitSignals(unit, branch, config);
    let { finalScore, weightsUsed } = computeHybridMatchScore({
        embeddingScore,
        lexicalOverlap: lexical,
        phraseOverlap: phrase,
        explicitBoost: explicit.explicitBoost,
        embeddingEnabled,
        config
    });

    let endpointOnlyCapped = explicit.endpointOnly;
    let incompleteLeafCapped = false;
    let apiEvidenceCapped = false;
    if (explicit.endpointOnly) {
        finalScore = capFinalScoreToPartial(finalScore, config);
    }

    if (branch.incompleteLeaf && unit.requiresCodeLevelBehavior && finalScore >= config.thresholds.covered) {
        finalScore = capFinalScoreToPartial(finalScore, config);
        incompleteLeafCapped = true;
    }

    if (unit.requiresApiEvidence && !explicit.hasApiEvidence && finalScore >= config.thresholds.covered) {
        finalScore = capFinalScoreToPartial(finalScore, config);
        apiEvidenceCapped = true;
    }

    const lowConfidence = isLowConfidence(finalScore, config.thresholds, config.lowConfidenceWindow);
    const status = scoreStatus(finalScore, config.thresholds);
    const coverageStatus = legacyToCoverageStatus(status);
    const reason = coverageStatus === 'strong'
        ? 'Hybrid matcher found strong semantic and deterministic evidence.'
        : coverageStatus === 'partial'
            ? 'Hybrid matcher found related behavior but not enough evidence for strong coverage.'
            : 'Hybrid matcher did not find enough evidence for coverage.';
    const evidence = [
        ...(explicit.strongMatches || []).map((value) => `strong-ref:${value}`),
        ...(explicit.methodMatches || []).map((value) => `method-ref:${value}`),
        ...(explicit.endpointMatches || []).map((value) => `endpoint:${value}`),
        ...(explicit.paramMatches || []).map((value) => `param:${value}`)
    ];

    return {
        branchId: branch.branchId,
        branch_id: branch.branchId,
        featureId: branch.featureId,
        storyId: branch.storyId,
        scenarioId: branch.scenarioId,
        codeId: branch.codeId,
        featureText: branch.featureText,
        storyText: branch.storyText,
        scenarioText: branch.scenarioText,
        codeText: branch.codeText,
        matchedBranchSignature: branch.matchedBranchSignature,
        matched_branch_signature: branch.matchedBranchSignature,
        finalScore,
        confidence: finalScore,
        status,
        coverageStatus,
        coverage_status: coverageStatus,
        embeddingScore: roundScore(embeddingScore),
        lexicalOverlap: lexical,
        phraseOverlap: phrase,
        explicitBoost: explicit.explicitBoost,
        explicitSignals: {
            strongMatches: explicit.strongMatches,
            endpointMatches: explicit.endpointMatches,
            paramMatches: explicit.paramMatches,
            methodMatches: explicit.methodMatches,
            statusSignalMatch: explicit.statusSignalMatch,
            roleSignalMatch: explicit.roleSignalMatch,
            behaviorSignalMatch: explicit.behaviorSignalMatch
        },
        reason,
        evidence,
        incompleteLeaf: Boolean(branch.incompleteLeaf),
        endpointOnlyCapped,
        incompleteLeafCapped,
        apiEvidenceCapped,
        lowConfidence,
        weightsUsed
    };
}

function serializeRequirementUnit(unit) {
    return {
        coverageSource: unit.coverageSource || CANONICAL_CHUNKS_COVERAGE_SOURCE,
        stableId: unit.stableId,
        documentId: unit.documentId,
        atom_id: unit.atom_id || unit.requirementId || unit.sourceRowId,
        contentHash: unit.contentHash || unit.textHash,
        sourceChunkId: unit.sourceChunkId,
        sourceRowId: unit.sourceRowId,
        requirementId: unit.requirementId,
        atomicRuleIndex: unit.atomicRuleIndex,
        source_section: unit.source_section || unit.sectionPathDisplay,
        sectionPath: unit.sectionPath,
        sectionPathDisplay: unit.sectionPathDisplay,
        sectionPathText: unit.sectionPathText,
        text: unit.text,
        textHash: unit.textHash,
        chunkType: unit.chunkType,
        mode: unit.mode,
        action: unit.action,
        condition: unit.condition,
        expected_result: unit.expected_result,
        method_ref: unit.method_ref,
        method_name: unit.method_name,
        http_method: unit.http_method,
        endpoint: unit.endpoint,
        request_params: unit.request_params,
        response_params: unit.response_params,
        type: unit.type,
        target_level: unit.target_level,
        comment: unit.comment
    };
}

function sortMatches(left, right) {
    return right.finalScore - left.finalScore ||
        String(left.matchedBranchSignature).localeCompare(String(right.matchedBranchSignature));
}

function coverageStatusRank(status) {
    if (status === 'strong') {
        return 3;
    }
    if (status === 'partial') {
        return 2;
    }
    return 1;
}

function sortCandidateBranches(left, right) {
    return coverageStatusRank(right.coverage_status) - coverageStatusRank(left.coverage_status) ||
        (right.confidence || right.finalScore || 0) - (left.confidence || left.finalScore || 0) ||
        String(left.matched_branch_signature).localeCompare(String(right.matched_branch_signature));
}

function normalizeCoverageStatus(value, fallback = 'not_covered') {
    const text = String(value || fallback).trim().toLowerCase();
    if (text === 'strong' || text === 'covered') {
        return 'strong';
    }
    if (text === 'partial') {
        return 'partial';
    }
    return 'not_covered';
}

function normalizeEvidence(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const text = String(value || '').trim();
    return text ? [text] : [];
}

function normalizeCandidateBranch(candidate, unit, config) {
    const coverageStatus = normalizeCoverageStatus(candidate.coverage_status || candidate.coverageStatus, candidate.coverageStatus);
    let finalScore = roundScore(Number.isFinite(Number(candidate.finalScore)) ? Number(candidate.finalScore) : Number(candidate.confidence || 0));
    let normalizedStatus = coverageStatus;
    let endpointOnlyCapped = Boolean(candidate.endpointOnlyCapped);
    let incompleteLeafCapped = Boolean(candidate.incompleteLeafCapped);
    let apiEvidenceCapped = Boolean(candidate.apiEvidenceCapped);

    if (candidate.endpointOnlyCapped && normalizedStatus === 'strong') {
        normalizedStatus = 'partial';
        finalScore = capFinalScoreToPartial(finalScore || config.thresholds.covered, config);
        endpointOnlyCapped = true;
    }

    if (candidate.incompleteLeaf && unit.requiresCodeLevelBehavior && normalizedStatus === 'strong') {
        normalizedStatus = 'partial';
        finalScore = capFinalScoreToPartial(finalScore || config.thresholds.covered, config);
        incompleteLeafCapped = true;
    }

    const hasApiEvidence = Boolean(
        candidate.explicitSignals?.hasApiEvidence ||
        candidate.explicitSignals?.endpointMatches?.length ||
        candidate.explicitSignals?.paramMatches?.length ||
        candidate.explicitSignals?.methodMatches?.length
    );
    if (unit.requiresApiEvidence && !hasApiEvidence) {
        apiEvidenceCapped = true;
        if (normalizedStatus === 'strong') {
            normalizedStatus = 'partial';
            finalScore = capFinalScoreToPartial(finalScore || config.thresholds.covered, config);
        }
    }

    const legacyStatus = coverageToLegacyStatus(normalizedStatus);
    return {
        ...candidate,
        branchId: candidate.branchId || candidate.branch_id,
        branch_id: candidate.branch_id || candidate.branchId,
        matchedBranchSignature: candidate.matchedBranchSignature || candidate.matched_branch_signature,
        matched_branch_signature: candidate.matched_branch_signature || candidate.matchedBranchSignature,
        coverageStatus: normalizedStatus,
        coverage_status: normalizedStatus,
        status: legacyStatus,
        confidence: roundScore(Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : finalScore),
        finalScore,
        reason: String(candidate.reason || ''),
        evidence: normalizeEvidence(candidate.evidence),
        endpointOnlyCapped,
        incompleteLeafCapped,
        apiEvidenceCapped
    };
}

async function verifyCandidateBranches({ verifierClient, unit, candidateBranches, config }) {
    if (!verifierClient || candidateBranches.length === 0) {
        return candidateBranches.map((candidate) => normalizeCandidateBranch(candidate, unit, config));
    }

    const response = await verifierClient({
        unit,
        candidateBranches,
        config
    });
    const verifiedCandidates = Array.isArray(response)
        ? response
        : Array.isArray(response?.candidateBranches)
            ? response.candidateBranches
            : [];
    const byBranchId = new Map(verifiedCandidates.map((candidate) => [
        candidate.branch_id || candidate.branchId,
        candidate
    ]));

    return candidateBranches.map((candidate) => {
        const verified = byBranchId.get(candidate.branch_id || candidate.branchId);
        if (!verified) {
            return normalizeCandidateBranch(candidate, unit, config);
        }
        return normalizeCandidateBranch({
            ...candidate,
            ...verified,
            branchId: candidate.branchId,
            branch_id: candidate.branch_id,
            matchedBranchSignature: candidate.matchedBranchSignature,
            matched_branch_signature: candidate.matched_branch_signature,
            explicitSignals: candidate.explicitSignals,
            incompleteLeaf: candidate.incompleteLeaf
        }, unit, config);
    });
}

function aggregateBy(traceabilityMap, key) {
    const result = {};
    for (const entry of traceabilityMap) {
        const value = String(entry[key] || 'unknown');
        if (!result[value]) {
            result[value] = {
                allTestableAtoms: 0,
                strongCount: 0,
                partialCount: 0,
                notCoveredCount: 0,
                strictCoverage: 0,
                potentialCoverage: 0
            };
        }
        const bucket = result[value];
        bucket.allTestableAtoms += 1;
        if (entry.coverageStatus === 'strong') {
            bucket.strongCount += 1;
        } else if (entry.coverageStatus === 'partial') {
            bucket.partialCount += 1;
        } else {
            bucket.notCoveredCount += 1;
        }
    }

    for (const bucket of Object.values(result)) {
        bucket.strictCoverage = bucket.allTestableAtoms > 0 ? bucket.strongCount / bucket.allTestableAtoms : 1;
        bucket.potentialCoverage = bucket.allTestableAtoms > 0
            ? (bucket.strongCount + bucket.partialCount) / bucket.allTestableAtoms
            : 1;
    }

    return result;
}

function determineCoverageStatus({
    hardCoverageRatio,
    partialCoverageRatio,
    softCoverageScore,
    strongPartialCoverageRatio = 0,
    total,
    potentialCoverage = null,
    notCoveredRatio = null,
    incompleteLeafRate = 0,
    hasModelBranches = true,
    scaleGateResult,
    config
}) {
    if (total === 0) {
        return 'passed';
    }

    if (!hasModelBranches) {
        return 'failed';
    }

    const qualityThresholds = config.qualityThresholds || {};
    const strictCoverage = hardCoverageRatio;
    const effectivePotentialCoverage = potentialCoverage ?? (hardCoverageRatio + partialCoverageRatio);
    const effectiveNotCoveredRatio = notCoveredRatio ?? Math.max(0, 1 - effectivePotentialCoverage);

    if (
        strictCoverage >= qualityThresholds.passedStrictCoverage &&
        effectivePotentialCoverage >= qualityThresholds.passedPotentialCoverage &&
        effectiveNotCoveredRatio <= qualityThresholds.passedMaxNotCoveredRatio &&
        incompleteLeafRate <= qualityThresholds.passedMaxIncompleteLeafRate
    ) {
        return 'passed';
    }

    if (
        strictCoverage >= qualityThresholds.needsReviewStrictCoverage ||
        effectivePotentialCoverage >= qualityThresholds.needsReviewPotentialCoverage
    ) {
        return incompleteLeafRate > qualityThresholds.passedMaxIncompleteLeafRate
            ? 'degraded_quality'
            : 'needs_review';
    }

    const hardCoverageThreshold = config.thresholds.hardCoverageRatio ?? config.thresholds.covered;
    if (hardCoverageRatio >= hardCoverageThreshold) {
        return 'passed';
    }

    const canNeedsReview = !scaleGateResult?.catastrophic &&
        hardCoverageRatio >= hardCoverageThreshold - config.thresholds.needsReviewHardCoverageSlack &&
        softCoverageScore >= config.thresholds.needsReviewSoftCoverageMin &&
        partialCoverageRatio >= config.thresholds.needsReviewPartialCoverageMin;

    const canNeedsReviewForHighPartialCalibration = !scaleGateResult?.catastrophic &&
        partialCoverageRatio >= config.thresholds.needsReviewHighPartialCoverageMin &&
        softCoverageScore >= config.thresholds.needsReviewHighPartialSoftCoverageMin &&
        strongPartialCoverageRatio >= config.thresholds.needsReviewStrongPartialCoverageMin;

    return canNeedsReview || canNeedsReviewForHighPartialCalibration ? 'needs_review' : 'degraded_quality';
}

export async function evaluateRequirementCoverage({
    chunks = [],
    coverageUnits = null,
    coverageSource = null,
    model = [],
    apiKey = null,
    embeddingClient = getEmbeddingWithModel,
    verifierClient = null,
    config = {},
    scaleGateResult = null,
    codeAugmentationDiagnostics = null,
    manualRegistryDiagnostics = null
} = {}) {
    const mergedConfig = mergeConfig(config);
    const sourceUnits = Array.isArray(coverageUnits) && coverageUnits.length > 0
        ? coverageUnits
        : buildRequirementCoverageUnits(chunks);
    const units = sourceUnits.filter((unit) => unit?.testable !== false && unit?.include_in_coverage !== false);
    const effectiveCoverageSource = coverageSource ||
        units[0]?.coverageSource ||
        (Array.isArray(coverageUnits) && coverageUnits.length > 0
            ? MANUAL_ATOM_COVERAGE_SOURCE
            : CANONICAL_CHUNKS_COVERAGE_SOURCE);
    const branches = collectLeafBranches(model, { config: mergedConfig });
    let embeddingInfo = {
        embeddingDisabled: true,
        embeddingModelUsed: null,
        embeddings: new Map(),
        modelsTried: []
    };

    if (embeddingClient && (apiKey || embeddingClient !== getEmbeddingWithModel)) {
        embeddingInfo = await resolveEmbeddingMatrix({
            units,
            branches,
            apiKey,
            embeddingClient,
            config: mergedConfig
        });
    }

    const embeddingEnabled = !embeddingInfo.embeddingDisabled;
    const traceabilityMap = [];
    const lowConfidenceMatches = [];
    const verifierTopK = Math.max(1, Number(mergedConfig.verifier?.topK) || 8);

    for (const unit of units) {
        const unitEmbedding = embeddingInfo.embeddings.get(unit.stableId);
        const matches = branches.map((branch) => {
            const branchEmbedding = embeddingInfo.embeddings.get(branch.stableId);
            const embeddingScore = embeddingEnabled
                ? cosineSimilarity(unitEmbedding, branchEmbedding)
                : 0;
            return buildMatch({
                unit,
                branch,
                embeddingScore,
                embeddingEnabled,
                config: mergedConfig
            });
        }).sort(sortMatches);

        const shortlistedMatches = matches.slice(0, verifierTopK);
        const candidateBranches = (await verifyCandidateBranches({
            verifierClient,
            unit,
            candidateBranches: shortlistedMatches,
            config: mergedConfig
        })).sort(sortCandidateBranches);

        const bestMatch = candidateBranches[0] || {
            finalScore: 0,
            status: 'uncovered',
            coverageStatus: 'not_covered',
            coverage_status: 'not_covered',
            confidence: 0,
            embeddingScore: 0,
            lexicalOverlap: 0,
            phraseOverlap: 0,
            explicitBoost: 0,
            matchedBranchSignature: null,
            matched_branch_signature: null,
            branchId: null,
            branch_id: null,
            reason: 'No candidate branches were available.',
            evidence: []
        };
        const retainedMatches = candidateBranches
            .filter((match, index) => index < 5 || match.coverage_status !== 'not_covered' || match.lowConfidence)
            .slice(0, 10);

        for (const match of retainedMatches) {
            if (match.lowConfidence) {
                lowConfidenceMatches.push({
                    requirementUnitStableId: unit.stableId,
                    sourceChunkId: unit.sourceChunkId,
                    sourceRowId: unit.sourceRowId,
                    requirementText: unit.text,
                    matchedBranchSignature: match.matchedBranchSignature,
                    branchId: match.branchId,
                    finalScore: match.finalScore,
                    status: match.status,
                    coverageStatus: match.coverageStatus,
                    thresholdProfile: mergedConfig.thresholdProfile,
                    thresholds: mergedConfig.thresholds
                });
            }
        }

        const serializedUnit = serializeRequirementUnit(unit);
        traceabilityMap.push({
            ...serializedUnit,
            coverageStatus: bestMatch.coverageStatus || bestMatch.coverage_status || 'not_covered',
            coverage_status: bestMatch.coverage_status || bestMatch.coverageStatus || 'not_covered',
            status: bestMatch.status,
            bestBranchId: bestMatch.branchId || bestMatch.branch_id || null,
            bestMatchedBranchSignature: bestMatch.matchedBranchSignature || bestMatch.matched_branch_signature || null,
            best_matched_branch_signature: bestMatch.matched_branch_signature || bestMatch.matchedBranchSignature || null,
            confidence: bestMatch.confidence || bestMatch.finalScore || 0,
            reason: bestMatch.reason || '',
            evidence: bestMatch.evidence || [],
            bestMatch,
            matches: retainedMatches,
            candidateBranches: retainedMatches,
            embeddingModelUsed: embeddingInfo.embeddingModelUsed
        });
    }

    const total = units.length;
    const coveredCount = traceabilityMap.filter((entry) => entry.coverageStatus === 'strong').length;
    const partialCount = traceabilityMap.filter((entry) => entry.coverageStatus === 'partial').length;
    const notCoveredCount = traceabilityMap.filter((entry) => entry.coverageStatus === 'not_covered').length;
    const strongPartialCount = traceabilityMap.filter((entry) => (
        entry.coverageStatus === 'partial' &&
        (entry.bestMatch?.explicitBoost || 0) > 0 &&
        entry.bestMatch?.explicitSignals?.behaviorSignalMatch === true
    )).length;
    const strictCoverage = total > 0 ? coveredCount / total : 1;
    const potentialCoverage = total > 0 ? (coveredCount + partialCount) / total : 1;
    const hardCoverageRatio = strictCoverage;
    const partialCoverageRatio = total > 0 ? partialCount / total : 0;
    const strongPartialCoverageRatio = total > 0 ? strongPartialCount / total : 0;
    const softCoverageScore = total > 0
        ? traceabilityMap.reduce((sum, entry) => sum + (entry.bestMatch?.finalScore || 0), 0) / total
        : 1;
    const linkedBranchIds = new Set();
    for (const entry of traceabilityMap) {
        for (const candidate of entry.candidateBranches || []) {
            if ((candidate.coverage_status === 'strong' || candidate.coverage_status === 'partial') && candidate.branch_id) {
                linkedBranchIds.add(candidate.branch_id);
            }
        }
    }
    const orphanBranchCount = branches.filter((branch) => !linkedBranchIds.has(branch.branchId)).length;
    const orphanBranchRate = branches.length > 0 ? orphanBranchCount / branches.length : 0;
    const incompleteLeaves = branches
        .filter((branch) => branch.incompleteLeaf)
        .map((branch) => ({
            branchId: branch.branchId,
            matchedBranchSignature: branch.matchedBranchSignature,
            featureId: branch.featureId,
            storyId: branch.storyId,
            scenarioId: branch.scenarioId,
            scenarioText: branch.scenarioText,
            reason: 'Scenario has no Code nodes.'
        }));
    const incompleteLeafCount = incompleteLeaves.length;
    const incompleteLeafRate = branches.length > 0 ? incompleteLeafCount / branches.length : 0;
    const uncoveredRequirementUnits = traceabilityMap
        .filter((entry) => entry.coverageStatus === 'not_covered')
        .map((entry) => ({
            stableId: entry.stableId,
            atom_id: entry.atom_id,
            contentHash: entry.contentHash,
            sourceChunkId: entry.sourceChunkId,
            sourceRowId: entry.sourceRowId,
            requirementId: entry.requirementId,
            atomicRuleIndex: entry.atomicRuleIndex,
            sectionPath: entry.sectionPath,
            sectionPathDisplay: entry.sectionPathDisplay,
            sectionPathText: entry.sectionPathText,
            text: entry.text,
            bestScore: entry.bestMatch?.finalScore || 0
        }));
    const status = determineCoverageStatus({
        hardCoverageRatio,
        partialCoverageRatio,
        softCoverageScore,
        strongPartialCoverageRatio,
        total,
        potentialCoverage,
        notCoveredRatio: total > 0 ? notCoveredCount / total : 0,
        incompleteLeafRate,
        hasModelBranches: branches.length > 0,
        scaleGateResult,
        config: mergedConfig
    });
    const coverageByType = aggregateBy(traceabilityMap, 'type');
    const coverageByTargetLevel = aggregateBy(traceabilityMap, 'target_level');
    const coverageBySection = aggregateBy(traceabilityMap, 'sectionPathDisplay');

    return {
        gate: 'requirementCoverage',
        coverageSource: effectiveCoverageSource,
        qualityStatus: status,
        status,
        passed: status === 'passed',
        needsReview: status === 'needs_review',
        confidence: embeddingInfo.embeddingDisabled ? 'degraded' : 'normal',
        embeddingDisabled: embeddingInfo.embeddingDisabled,
        embeddingModelUsed: embeddingInfo.embeddingModelUsed,
        embeddingModelsTried: embeddingInfo.modelsTried,
        thresholdProfile: mergedConfig.thresholdProfile,
        thresholds: {
            ...mergedConfig.thresholds,
            hardCoverageRatio: mergedConfig.thresholds.hardCoverageRatio ?? mergedConfig.thresholds.covered
        },
        weights: mergedConfig.weights,
        totalTestableRequirementUnits: total,
        coveredRequirementUnits: coveredCount,
        partialRequirementUnits: partialCount,
        notCoveredRequirementUnits: notCoveredCount,
        strongPartialRequirementUnits: strongPartialCount,
        allTestableAtoms: total,
        strongCount: coveredCount,
        partialCount,
        notCoveredCount,
        strictCoverage,
        potentialCoverage,
        hardCoverageRatio,
        partialCoverageRatio,
        strongPartialCoverageRatio,
        softCoverageScore,
        weightedCoverageRatio: null,
        coverageByType,
        coverageByTargetLevel,
        coverageBySection,
        orphanBranchRate,
        incompleteLeafRate,
        requirementCoverageUnits: units.map(serializeRequirementUnit),
        uncoveredRequirementUnits,
        lowConfidenceMatches,
        traceabilityMap,
        branchCount: branches.length,
        diagnostics: {
            thresholdProfile: mergedConfig.thresholdProfile,
            thresholds: mergedConfig.thresholds,
            qualityThresholds: mergedConfig.qualityThresholds,
            embeddingModelUsed: embeddingInfo.embeddingModelUsed,
            embeddingDisabled: embeddingInfo.embeddingDisabled,
            confidence: embeddingInfo.embeddingDisabled ? 'degraded' : 'normal',
            lowConfidenceMatches,
            coverageSource: effectiveCoverageSource,
            manualRegistryDiagnostics,
            incompleteLeafCount,
            incompleteLeaves,
            codeAugmentationAttempted: Boolean(codeAugmentationDiagnostics?.attempted),
            codeAugmentationSucceeded: Boolean(codeAugmentationDiagnostics?.succeeded),
            codeAugmentationReasons: codeAugmentationDiagnostics?.reasons || []
        }
    };
}

function groupUncoveredBySection(uncovered = []) {
    const groups = new Map();
    for (const unit of uncovered) {
        const section = unit.sectionPathDisplay || displaySectionPath(unit.sectionPath) || unit.sectionPathText || 'unknown section';
        if (!groups.has(section)) {
            groups.set(section, []);
        }
        groups.get(section).push(unit);
    }
    return groups;
}

function requirementGapFromTraceabilityEntry(entry = {}) {
    return {
        stableId: entry.stableId,
        sourceChunkId: entry.sourceChunkId,
        sourceRowId: entry.sourceRowId,
        requirementId: entry.requirementId,
        atom_id: entry.atom_id,
        contentHash: entry.contentHash,
        atomicRuleIndex: entry.atomicRuleIndex,
        sectionPath: entry.sectionPath,
        sectionPathDisplay: entry.sectionPathDisplay,
        sectionPathText: entry.sectionPathText,
        text: entry.text,
        coverageStatus: entry.coverageStatus || legacyToCoverageStatus(entry.status || 'uncovered'),
        bestScore: entry.bestMatch?.finalScore || 0,
        matchedBranchSignature: entry.bestMatch?.matchedBranchSignature || null,
        candidateBranches: entry.candidateBranches || entry.matches || []
    };
}

function collectRequirementCoverageGaps(requirementCoverage = {}) {
    const traceabilityMap = Array.isArray(requirementCoverage?.traceabilityMap)
        ? requirementCoverage.traceabilityMap
        : [];

    if (traceabilityMap.length > 0) {
        return traceabilityMap
            .filter((entry) => (entry?.coverageStatus || legacyToCoverageStatus(entry?.status)) !== 'strong')
            .map(requirementGapFromTraceabilityEntry);
    }

    return (Array.isArray(requirementCoverage?.uncoveredRequirementUnits)
        ? requirementCoverage.uncoveredRequirementUnits
        : []
    ).map((unit) => ({
        ...unit,
        coverageStatus: unit.coverageStatus || 'uncovered',
        bestScore: unit.bestScore || 0,
        matchedBranchSignature: unit.matchedBranchSignature || null
    }));
}

function selectSectionBalancedExamples(uncovered = [], maxExamples = 20) {
    const groups = [...groupUncoveredBySection(uncovered).entries()]
        .sort(([left], [right]) => left.localeCompare(right));
    const selected = [];
    let cursor = 0;

    while (selected.length < maxExamples && groups.some(([, items]) => items.length > 0)) {
        const [, items] = groups[cursor % groups.length];
        if (items.length > 0) {
            selected.push(items.shift());
        }
        cursor += 1;
    }

    return selected;
}

function collectCoveredBranchSignatures(traceabilityMap = [], maxSignatures = 80) {
    const signatures = new Set();
    for (const entry of Array.isArray(traceabilityMap) ? traceabilityMap : []) {
        for (const match of entry.candidateBranches || entry.matches || []) {
            const status = match.coverage_status || match.coverageStatus || legacyToCoverageStatus(match.status);
            const signature = match.matched_branch_signature || match.matchedBranchSignature;
            if (status === 'strong' && signature) {
                signatures.add(signature);
            }
            if (signatures.size >= maxSignatures) {
                return [...signatures];
            }
        }
    }
    return [...signatures];
}

export function buildRequirementCoverageRetryInstruction({
    requirementCoverage,
    maxExamples = DEFAULT_REQUIREMENT_COVERAGE_CONFIG.retry.maxExamples,
    maxCoveredSignatures = DEFAULT_REQUIREMENT_COVERAGE_CONFIG.retry.maxCoveredSignatures
} = {}) {
    const coverageGaps = collectRequirementCoverageGaps(requirementCoverage);
    const groups = [...groupUncoveredBySection(coverageGaps).entries()]
        .sort(([left], [right]) => left.localeCompare(right));
    const examples = selectSectionBalancedExamples(coverageGaps, maxExamples);
    const signatures = collectCoveredBranchSignatures(requirementCoverage?.traceabilityMap || [], maxCoveredSignatures);

    const sectionSummary = groups.length
        ? groups.map(([section, items]) => `- ${section}: ${items.length}`).join('\n')
        : '- none: 0';
    const exampleLines = examples.length
        ? examples.map((unit, index) => [
            `${index + 1}. stableId=${unit.stableId}`,
            `section=${unit.sectionPathDisplay || displaySectionPath(unit.sectionPath) || unit.sectionPathText || 'unknown section'}`,
            `sourceChunkId=${unit.sourceChunkId || 'n/a'}`,
            `sourceRowId=${unit.sourceRowId || 'n/a'}`,
            `coverageStatus=${unit.coverageStatus || 'uncovered'}`,
            `bestScore=${roundScore(unit.bestScore || 0)}`,
            ...(unit.matchedBranchSignature ? [`currentBestBranchSignature=${unit.matchedBranchSignature}`] : []),
            `requirement="${String(unit.text || '').replace(/\s+/g, ' ').slice(0, 700)}"`
        ].join(' | ')).join('\n')
        : 'No uncovered or partial requirement units.';
    const signatureLines = signatures.length
        ? signatures.map((signature) => `- ${signature}`).join('\n')
        : '- none';

    return [
        'QUALITY GATE RETRY INSTRUCTION',
        'The generated test model is under-covering concrete requirement units. Augment the current Feature -> Story -> Scenario -> Code model instead of rewriting it from scratch.',
        '',
        'Uncovered requirements by section (includes partial units below the covered threshold):',
        sectionSummary,
        '',
        'Section-balanced uncovered/partial examples to cover:',
        exampleLines,
        '',
        'Already covered branch signatures. Do not duplicate these branches; add only genuinely missing branches or codes. Partial matches are not listed here because they still need stronger, more specific coverage:',
        signatureLines,
        '',
        'Rules for the retry:',
        '- Cover the listed gaps with explicit Feature/Story/Scenario/Code branches.',
        '- Preserve useful existing branches.',
        '- Avoid duplicate scenarios and duplicate Code nodes.',
        '- Prefer targeted additions over inflating the model with generic branches.',
        '- Return the augmented model through submit_test_model only.'
    ].join('\n');
}

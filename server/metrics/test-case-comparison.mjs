import pLimit from 'p-limit';
import {
    getAllTestCases,
    getCaseIssue,
    getTestCaseSteps,
    getTestCaseExpectedResult,
    getTestCaseLayer,
    getTestCasePrecondition,
    getTestCaseCustomFields,
    getTestCaseOverview
} from '../http-service.mjs';
import { formatTestCaseAsJson } from '../generate-json.mjs';
import { normalizeTestCases } from '../normalizers/test-case-normalizer.mjs';
import { validateTestCases } from '../schemas/test-case-schemas.mjs';
import { scoreTextPairs } from './bert-score-client.mjs';
import { solveAssignment } from './hungarian.mjs';

const BLOCK_WEIGHTS = {
    title: 0.15,
    precondition: 0.20,
    steps: 0.40,
    expected: 0.15,
    context: 0.05
};

const MATCH_THRESHOLDS = {
    strong: 0.82,
    weak: 0.70,
    featureStory: 0.35,
    scenarioCode: 0.30,
    lexical: 0.18,
    lexicalFallback: 5,
    maxCandidates: 12,
    featureStoryTopN: 5,
    scenarioCodeTopN: 5,
    lexicalTopN: 8
};

const ASSIGNMENT_COSTS = {
    dummy: 0.30,
    outOfShortlist: 1.10
};

const MANUAL_CACHE_TTL_MS = 10 * 60 * 1000;
const ALLURE_READ_RETRY_ATTEMPTS = 3;
const ALLURE_READ_RETRY_DELAY_MS = 500;
const ISSUE_LOOKUP_CONCURRENCY = 8;
const DETAILS_LOOKUP_CONCURRENCY = 8;
const FAILURE_SAMPLE_LIMIT = 5;
const RETRYABLE_ERROR_CODES = new Set([
    'ABORT_ERR',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'FETCH_ERROR'
]);
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_PATTERNS = [
    'aborted',
    'connect etimedout',
    'econnaborted',
    'econnrefused',
    'econnreset',
    'eai_again',
    'enotfound',
    'fetch failed',
    'network timeout',
    'too many requests',
    'request timeout',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'socket hang up',
    'temporarily unavailable',
    'timed out',
    'timeout'
];

const manualCaseCache = new Map();
const issueLookupLimit = pLimit(ISSUE_LOOKUP_CONCURRENCY);
const detailsLookupLimit = pLimit(DETAILS_LOOKUP_CONCURRENCY);
const ID_PATTERN = /^(tc-(e2e|if|ib|uf)-\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

function pickText(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const stringValue = String(value).trim();
        if (stringValue) {
            return stringValue;
        }
    }
    return '';
}

function normalizeWhitespace(text) {
    return pickText(text).replace(/\s+/g, ' ').trim();
}

function normalizeIssueKey(issue) {
    return pickText(issue).toUpperCase();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorStatus(error) {
    const status = Number(
        error?.status ||
        error?.statusCode ||
        error?.response?.status
    );
    return Number.isFinite(status) ? status : null;
}

function isRetryableAllureError(error) {
    const code = pickText(error?.code).toUpperCase();
    if (code && RETRYABLE_ERROR_CODES.has(code)) {
        return true;
    }

    const status = extractErrorStatus(error);
    if (status !== null && RETRYABLE_STATUS_CODES.has(status)) {
        return true;
    }

    const message = pickText(error?.message).toLowerCase();
    return RETRYABLE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

async function withAllureRetry(operation, { label, attempts = ALLURE_READ_RETRY_ATTEMPTS } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt >= attempts || !isRetryableAllureError(error)) {
                throw error;
            }

            const delayMs = ALLURE_READ_RETRY_DELAY_MS * attempt;
            const errorMessage = pickText(error?.message) || 'Unknown Allure error';
            console.warn(
                `[test-case-comparison] ${label || 'Allure request'} failed ` +
                `(attempt ${attempt}/${attempts}): ${errorMessage}. Retrying in ${delayMs}ms.`
            );
            await sleep(delayMs);
        }
    }

    throw lastError;
}

function toFailureDiagnostic(testCaseId, error) {
    return {
        testCaseId,
        code: pickText(error?.code) || null,
        status: extractErrorStatus(error),
        message: pickText(error?.message) || String(error)
    };
}

function summarizeFailures(failures) {
    return {
        count: failures.length,
        sample: failures.slice(0, FAILURE_SAMPLE_LIMIT)
    };
}

function roundMetric(value) {
    return Number(Number(value || 0).toFixed(4));
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function normalizeStructureText(text) {
    return normalizeWhitespace(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractStructureKeywords(text) {
    return normalizeStructureText(text)
        .split(/\s+/)
        .filter((word) => word.length > 3);
}

function computeStructureSimilarityScore(expectedText, actualText) {
    const expected = normalizeStructureText(expectedText);
    const actual = normalizeStructureText(actualText);

    if (!expected || !actual) return 0;
    if (expected === actual) return 1;
    if (actual.includes(expected) || expected.includes(actual)) return 0.9;

    const keywords = extractStructureKeywords(expected);
    if (keywords.length === 0) return 0;

    const matches = keywords.filter((keyword) => actual.includes(keyword)).length;
    return matches / keywords.length;
}

function buildCustomFieldMap(customFields) {
    const map = {};
    for (const field of customFields || []) {
        const name = normalizeWhitespace(field?.name || field?.customField?.name).toLowerCase();
        if (!name) continue;
        const value = normalizeWhitespace(
            field?.value ||
            field?.name ||
            field?.values?.map((entry) => entry?.name || entry).join(' | ')
        );
        if (value) {
            map[name] = value;
        }
    }
    return map;
}

function serializeStepLine(step, prefix = '') {
    if (!step) return [];
    if (typeof step === 'string') {
        return [normalizeWhitespace(step)].filter(Boolean);
    }

    const lines = [];
    const description = pickText(step.description, step.action, step.text);
    const expectedResult = pickText(step.expectedResult, step.expected);

    if (description) {
        lines.push(prefix ? `${prefix}${description}` : description);
    }
    if (expectedResult) {
        lines.push(prefix ? `${prefix}Ожидаемый результат: ${expectedResult}` : `Ожидаемый результат: ${expectedResult}`);
    }

    if (Array.isArray(step.childSteps)) {
        step.childSteps.forEach((child, childIndex) => {
            lines.push(...serializeStepLine(child, `${prefix}${childIndex + 1}. `));
        });
    }

    if (Array.isArray(step.childStep)) {
        step.childStep.forEach((child, childIndex) => {
            const childText = normalizeWhitespace(child);
            if (childText) {
                lines.push(`${prefix}${childIndex + 1}. ${childText}`);
            }
        });
    }

    return lines.filter(Boolean);
}

function extractStepLines(steps) {
    const lines = [];
    for (const step of steps || []) {
        if (step && typeof step === 'object' && Object.prototype.hasOwnProperty.call(step, 'sharedStepId')) {
            lines.push(`Shared step #${step.sharedStepId}`);
            continue;
        }
        lines.push(...serializeStepLine(step));
    }
    return lines.map(normalizeWhitespace).filter(Boolean);
}

function buildComparisonBlocks(testCase) {
    const stepLines = Array.isArray(testCase.stepLines) ? testCase.stepLines : extractStepLines(testCase.steps);
    const contextLines = [
        testCase.feature ? `Feature: ${testCase.feature}` : '',
        testCase.story ? `Story: ${testCase.story}` : '',
        testCase.scenario ? `Scenario: ${testCase.scenario}` : '',
        testCase.code ? `Code: ${testCase.code}` : ''
    ].filter(Boolean);

    return {
        title: normalizeWhitespace(testCase.title),
        precondition: normalizeWhitespace(testCase.precondition),
        steps: stepLines.map((line, index) => `${index + 1}. ${line}`).join('\n'),
        expected: normalizeWhitespace(testCase.expected),
        context: contextLines.join('\n')
    };
}

function buildLexicalSearchText(testCase) {
    const firstSteps = (testCase.stepLines || []).slice(0, 2).join(' ');
    return normalizeWhitespace(`${testCase.title} ${firstSteps}`);
}

function normalizeLexicalText(text) {
    return normalizeWhitespace(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeText(text) {
    return new Set(
        normalizeLexicalText(text)
            .split(/\s+/)
            .filter((token) => token.length > 1)
    );
}

function buildTrigrams(text) {
    const normalized = normalizeLexicalText(text).replace(/\s+/g, ' ');
    if (!normalized) return new Set();
    if (normalized.length < 3) return new Set([normalized]);

    const trigrams = new Set();
    for (let index = 0; index <= normalized.length - 3; index += 1) {
        trigrams.add(normalized.slice(index, index + 3));
    }
    return trigrams;
}

function tokenJaccardScore(leftText, rightText) {
    const leftTokens = tokenizeText(leftText);
    const rightTokens = tokenizeText(rightText);
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

    let intersection = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) intersection += 1;
    }

    const union = leftTokens.size + rightTokens.size - intersection;
    return union > 0 ? intersection / union : 0;
}

function charTrigramDiceScore(leftText, rightText) {
    const leftTrigrams = buildTrigrams(leftText);
    const rightTrigrams = buildTrigrams(rightText);
    if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return 0;

    let intersection = 0;
    for (const trigram of leftTrigrams) {
        if (rightTrigrams.has(trigram)) intersection += 1;
    }

    return (2 * intersection) / (leftTrigrams.size + rightTrigrams.size);
}

function lexicalRetrievalScore(generatedCase, manualCase) {
    const leftText = buildLexicalSearchText(generatedCase);
    const rightText = buildLexicalSearchText(manualCase);
    return (0.6 * tokenJaccardScore(leftText, rightText)) + (0.4 * charTrigramDiceScore(leftText, rightText));
}

function getFeatureStoryScore(generatedCase, manualCase) {
    const scores = [];
    if (generatedCase.feature || manualCase.feature) {
        scores.push(computeStructureSimilarityScore(generatedCase.feature, manualCase.feature));
    }
    if (generatedCase.story || manualCase.story) {
        scores.push(computeStructureSimilarityScore(generatedCase.story, manualCase.story));
    }
    return average(scores);
}

function getScenarioCodeScore(generatedCase, manualCase) {
    const scores = [];
    if (generatedCase.scenario || manualCase.scenario) {
        scores.push(computeStructureSimilarityScore(generatedCase.scenario, manualCase.scenario));
    }
    if (generatedCase.code || manualCase.code) {
        scores.push(computeStructureSimilarityScore(generatedCase.code, manualCase.code));
    }
    return average(scores);
}

function topMatches(manualCases, scorer, threshold, topN) {
    return manualCases
        .map((manualCase, manualIndex) => ({
            manualIndex,
            score: scorer(manualCase)
        }))
        .filter((entry) => entry.score >= threshold)
        .sort((left, right) => right.score - left.score)
        .slice(0, topN);
}

function ensureCandidate(candidateMap, manualIndex) {
    if (!candidateMap.has(manualIndex)) {
        candidateMap.set(manualIndex, {
            manualIndex,
            stages: {},
            retrievalScore: 0
        });
    }
    return candidateMap.get(manualIndex);
}

function buildCandidateShortlists(generatedCases, manualCases) {
    return generatedCases.map((generatedCase) => {
        const candidateMap = new Map();

        const featureStoryMatches = topMatches(
            manualCases,
            (manualCase) => getFeatureStoryScore(generatedCase, manualCase),
            MATCH_THRESHOLDS.featureStory,
            MATCH_THRESHOLDS.featureStoryTopN
        );
        featureStoryMatches.forEach(({ manualIndex, score }) => {
            const candidate = ensureCandidate(candidateMap, manualIndex);
            candidate.stages.featureStory = score;
            candidate.retrievalScore = Math.max(candidate.retrievalScore, score);
        });

        const scenarioCodeMatches = topMatches(
            manualCases,
            (manualCase) => getScenarioCodeScore(generatedCase, manualCase),
            MATCH_THRESHOLDS.scenarioCode,
            MATCH_THRESHOLDS.scenarioCodeTopN
        );
        scenarioCodeMatches.forEach(({ manualIndex, score }) => {
            const candidate = ensureCandidate(candidateMap, manualIndex);
            candidate.stages.scenarioCode = score;
            candidate.retrievalScore = Math.max(candidate.retrievalScore, score);
        });

        const lexicalMatches = topMatches(
            manualCases,
            (manualCase) => lexicalRetrievalScore(generatedCase, manualCase),
            MATCH_THRESHOLDS.lexical,
            MATCH_THRESHOLDS.lexicalTopN
        );
        lexicalMatches.forEach(({ manualIndex, score }) => {
            const candidate = ensureCandidate(candidateMap, manualIndex);
            candidate.stages.lexical = score;
            candidate.retrievalScore = Math.max(candidate.retrievalScore, score);
        });

        if (candidateMap.size === 0) {
            const lexicalFallback = manualCases
                .map((manualCase, manualIndex) => ({
                    manualIndex,
                    score: lexicalRetrievalScore(generatedCase, manualCase)
                }))
                .sort((left, right) => right.score - left.score)
                .slice(0, MATCH_THRESHOLDS.lexicalFallback);

            lexicalFallback.forEach(({ manualIndex, score }) => {
                const candidate = ensureCandidate(candidateMap, manualIndex);
                candidate.stages.lexicalFallback = score;
                candidate.retrievalScore = Math.max(candidate.retrievalScore, score);
            });
        }

        return Array.from(candidateMap.values())
            .sort((left, right) => right.retrievalScore - left.retrievalScore)
            .slice(0, MATCH_THRESHOLDS.maxCandidates);
    });
}

function normalizeGeneratedCase(inputCase, index) {
    const stepLines = extractStepLines(inputCase?.steps || []);
    return {
        source: 'generated',
        id: pickText(inputCase?.id, `generated-${index + 1}`),
        title: pickText(inputCase?.title, inputCase?.name),
        precondition: pickText(inputCase?.precondition),
        steps: Array.isArray(inputCase?.steps) ? inputCase.steps : [],
        stepLines,
        expected: pickText(inputCase?.expected, inputCase?.expectedResult),
        layer: pickText(inputCase?.layer),
        feature: pickText(inputCase?.feature),
        story: pickText(inputCase?.story),
        scenario: pickText(inputCase?.scenario),
        code: pickText(inputCase?.code, inputCase?.codeNode),
        tags: Array.isArray(inputCase?.tags) ? inputCase.tags.filter(Boolean) : [],
        priority: pickText(inputCase?.priority),
        version: pickText(inputCase?.version, 'stable'),
        raw: inputCase
    };
}

function normalizeManualCase(formattedCase) {
    const customFields = buildCustomFieldMap(formattedCase?.customFields || []);
    const stepLines = extractStepLines(formattedCase?.steps || []);
    return {
        source: 'manual',
        id: pickText(formattedCase?.id),
        title: pickText(formattedCase?.name, formattedCase?.title),
        precondition: pickText(formattedCase?.precondition),
        steps: Array.isArray(formattedCase?.steps) ? formattedCase.steps : [],
        stepLines,
        expected: pickText(formattedCase?.expectedResult, formattedCase?.expected),
        layer: pickText(formattedCase?.layer),
        feature: pickText(customFields.feature),
        story: pickText(customFields.story),
        scenario: pickText(customFields.scenario),
        code: pickText(customFields.code),
        jiraIssue: pickText(formattedCase?.issue),
        raw: formattedCase
    };
}

function prepareGeneratedCasesForStrictValidation(generatedCases) {
    return generatedCases.map((testCase) => ({
        id: ID_PATTERN.test(String(testCase.id || '')) ? String(testCase.id) : undefined,
        title: pickText(testCase.title),
        layer: pickText(testCase.layer),
        feature: pickText(testCase.feature),
        story: pickText(testCase.story),
        scenario: testCase.scenario ? pickText(testCase.scenario) : undefined,
        code: testCase.code ? pickText(testCase.code) : undefined,
        steps: (testCase.steps || []).map((step) => {
            if (step && typeof step === 'object' && Object.prototype.hasOwnProperty.call(step, 'sharedStepId')) {
                const sharedStepId = Number(step.sharedStepId);
                return Number.isFinite(sharedStepId) ? { sharedStepId } : { sharedStepId: step.sharedStepId };
            }

            if (typeof step === 'object' && step !== null) {
                const action = pickText(step.action, step.description, step.text);
                const expectedResult = pickText(step.expectedResult, step.expected);
                return [action, expectedResult ? `Ожидаемый результат: ${expectedResult}` : '']
                    .filter(Boolean)
                    .join('\n');
            }

            return pickText(step);
        }).filter(Boolean),
        expected: pickText(testCase.expected),
        precondition: pickText(testCase.precondition),
        tags: Array.isArray(testCase.tags) ? testCase.tags.filter(Boolean) : [],
        version: pickText(testCase.version, 'stable'),
        priority: pickText(testCase.priority)
    }));
}

function validateGeneratedCases(generatedCases) {
    const preparedCases = prepareGeneratedCasesForStrictValidation(generatedCases);
    const normalizedCases = normalizeTestCases(preparedCases, {});
    const validationResult = validateTestCases(normalizedCases);
    const validationByIndex = new Map(
        (validationResult.allResults || []).map((result) => [result.index, result])
    );

    return generatedCases.map((testCase, index) => {
        const result = validationByIndex.get(index) || { valid: false, errors: ['Validation result is missing'] };
        return {
            generatedCaseId: testCase.id,
            valid: Boolean(result.valid),
            errors: Array.isArray(result.errors) ? result.errors : []
        };
    });
}

function validateManualCaseCompat(manualCase) {
    const warnings = [];

    if (!manualCase.title) warnings.push('Missing title');
    if (!manualCase.layer) warnings.push('Missing layer');
    if (!manualCase.expected) warnings.push('Missing expected result');
    if (!Array.isArray(manualCase.stepLines) || manualCase.stepLines.length === 0) warnings.push('Missing steps');
    if (!manualCase.feature && !manualCase.story && !manualCase.scenario && !manualCase.code) {
        warnings.push('Context custom fields are empty');
    }

    return {
        manualCaseId: manualCase.id,
        warnings
    };
}

async function loadManualCasesForJiraIssue(projectId, jiraIssue, onProgress = null) {
    const cacheKey = `${projectId}:${normalizeIssueKey(jiraIssue)}`;
    const cached = manualCaseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < MANUAL_CACHE_TTL_MS) {
        return cached.data;
    }

    onProgress?.(8);
    const allCases = await getAllTestCases(projectId);
    onProgress?.(16);

    const issueKey = normalizeIssueKey(jiraIssue);
    const issueLookupResults = await Promise.allSettled(
        allCases.map((testCase) => issueLookupLimit(async () => {
            const issues = await withAllureRetry(
                () => getCaseIssue(testCase.id),
                { label: `Load Jira links for Allure test case ${testCase.id}` }
            );
            const hasIssue = Array.isArray(issues) && issues.some((issue) => normalizeIssueKey(issue?.name) === issueKey);
            return hasIssue ? { ...testCase, issue: issues } : null;
        }))
    );

    const issueLookupFailures = [];
    const matchedBaseCases = [];
    issueLookupResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            if (result.value) {
                matchedBaseCases.push(result.value);
            }
            return;
        }

        issueLookupFailures.push(toFailureDiagnostic(allCases[index]?.id, result.reason));
    });

    if (issueLookupFailures.length > 0) {
        console.warn(
            `[test-case-comparison] Failed to load Jira links for ${issueLookupFailures.length}/${allCases.length} ` +
            `Allure test case(s) while searching issue ${jiraIssue}. Continuing with partial data.`
        );
    }

    if (matchedBaseCases.length === 0) {
        if (issueLookupFailures.length > 0) {
            throw new Error(
                `Failed to reliably load Jira links from Allure for issue ${jiraIssue}. ` +
                `${issueLookupFailures.length} request(s) failed; retry the comparison.`
            );
        }
        throw new Error(`No manual Allure test cases linked to Jira issue ${jiraIssue}`);
    }

    onProgress?.(28);
    const detailLookupResults = await Promise.allSettled(
        matchedBaseCases.map((testCase) => detailsLookupLimit(async () => {
            const [stepsRaw, expectedResult, layer, precondition, customFields, overview] = await Promise.all([
                withAllureRetry(
                    () => getTestCaseSteps(testCase.id),
                    { label: `Load steps for Allure test case ${testCase.id}` }
                ),
                withAllureRetry(
                    () => getTestCaseExpectedResult(testCase.id),
                    { label: `Load expected result for Allure test case ${testCase.id}` }
                ),
                withAllureRetry(
                    () => getTestCaseLayer(testCase.id),
                    { label: `Load layer for Allure test case ${testCase.id}` }
                ),
                withAllureRetry(
                    () => getTestCasePrecondition(testCase.id),
                    { label: `Load precondition for Allure test case ${testCase.id}` }
                ),
                withAllureRetry(
                    () => getTestCaseCustomFields(testCase.id, projectId),
                    { label: `Load custom fields for Allure test case ${testCase.id}` }
                ),
                withAllureRetry(
                    () => getTestCaseOverview(testCase.id),
                    { label: `Load overview for Allure test case ${testCase.id}` }
                )
            ]);

            const formatted = await formatTestCaseAsJson({
                id: testCase.id,
                name: testCase.name,
                issue: testCase.issue || [],
                layer,
                precondition,
                customFields,
                expectedResult,
                parameters: overview?.parameters || [],
                examples: overview?.examples || [],
                stepsRaw
            });

            return normalizeManualCase(formatted);
        }))
    );

    const detailLookupFailures = [];
    const manualCases = [];
    detailLookupResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            if (result.value) {
                manualCases.push(result.value);
            }
            return;
        }

        detailLookupFailures.push(toFailureDiagnostic(matchedBaseCases[index]?.id, result.reason));
    });

    if (detailLookupFailures.length > 0) {
        console.warn(
            `[test-case-comparison] Failed to load details for ${detailLookupFailures.length}/${matchedBaseCases.length} ` +
            `matched Allure test case(s) for issue ${jiraIssue}. Continuing with partial data.`
        );
    }

    if (manualCases.length === 0) {
        throw new Error(
            `Manual Allure test cases were found for ${jiraIssue}, but their details could not be loaded. ` +
            `Retry the comparison.`
        );
    }

    const diagnostics = {
        partialManualCaseData: issueLookupFailures.length > 0 || detailLookupFailures.length > 0,
        issueLookupFailures: summarizeFailures(issueLookupFailures),
        detailLookupFailures: summarizeFailures(detailLookupFailures)
    };

    manualCaseCache.set(cacheKey, {
        timestamp: Date.now(),
        data: { manualCases, diagnostics }
    });

    return { manualCases, diagnostics };
}

async function scoreCandidatePairs(generatedCases, manualCases, candidateShortlists, onProgress = null) {
    const pairState = new Map();
    const scoreRequestsByBlock = new Map(
        Object.keys(BLOCK_WEIGHTS).map((blockName) => [blockName, []])
    );

    const blockCacheByCase = {
        generated: generatedCases.map((testCase) => buildComparisonBlocks(testCase)),
        manual: manualCases.map((testCase) => buildComparisonBlocks(testCase))
    };

    for (let generatedIndex = 0; generatedIndex < generatedCases.length; generatedIndex += 1) {
        for (const candidate of candidateShortlists[generatedIndex]) {
            const manualIndex = candidate.manualIndex;
            const pairKey = `${generatedIndex}:${manualIndex}`;
            const state = {
                generatedIndex,
                manualIndex,
                retrieval: candidate,
                blocks: {},
                totals: {
                    activeWeight: 0,
                    weightedPrecision: 0,
                    weightedRecall: 0,
                    weightedF1: 0
                }
            };

            for (const [blockName, blockWeight] of Object.entries(BLOCK_WEIGHTS)) {
                const candidateText = blockCacheByCase.generated[generatedIndex][blockName];
                const referenceText = blockCacheByCase.manual[manualIndex][blockName];
                const active = Boolean(candidateText || referenceText);

                state.blocks[blockName] = {
                    weight: blockWeight,
                    active,
                    precision: 0,
                    recall: 0,
                    f1: 0
                };

                if (!active) continue;

                state.totals.activeWeight += blockWeight;
                if (!candidateText || !referenceText) {
                    continue;
                }

                scoreRequestsByBlock.get(blockName).push({
                    pairId: pairKey,
                    candidate: candidateText,
                    reference: referenceText
                });
            }

            pairState.set(pairKey, state);
        }
    }

    onProgress?.(44);
    await Promise.all(
        Array.from(scoreRequestsByBlock.entries()).map(async ([blockName, pairs]) => {
            if (pairs.length === 0) return;

            const scores = await scoreTextPairs(pairs, { lang: 'ru' });
            scores.forEach((score) => {
                const state = pairState.get(String(score.pairId));
                if (!state) return;
                state.blocks[blockName] = {
                    ...state.blocks[blockName],
                    precision: Number(score.precision || 0),
                    recall: Number(score.recall || 0),
                    f1: Number(score.f1 || 0)
                };
            });
        })
    );

    onProgress?.(64);
    for (const state of pairState.values()) {
        for (const block of Object.values(state.blocks)) {
            if (!block.active) continue;
            state.totals.weightedPrecision += block.weight * block.precision;
            state.totals.weightedRecall += block.weight * block.recall;
            state.totals.weightedF1 += block.weight * block.f1;
        }

        const denominator = state.totals.activeWeight || 1;
        state.weighted = {
            precision: state.totals.weightedPrecision / denominator,
            recall: state.totals.weightedRecall / denominator,
            f1: state.totals.weightedF1 / denominator
        };
    }

    return {
        pairState,
        blockCacheByCase
    };
}

function buildCostMatrix(generatedCases, manualCases, pairState) {
    const rowCount = generatedCases.length;
    const realColumnCount = manualCases.length;
    const totalColumnCount = realColumnCount + rowCount;

    return Array.from({ length: rowCount }, (_, generatedIndex) => (
        Array.from({ length: totalColumnCount }, (_, columnIndex) => {
            if (columnIndex >= realColumnCount) {
                return ASSIGNMENT_COSTS.dummy;
            }
            const pairKey = `${generatedIndex}:${columnIndex}`;
            const pair = pairState.get(pairKey);
            if (!pair) {
                return ASSIGNMENT_COSTS.outOfShortlist;
            }
            return 1 - pair.weighted.f1;
        })
    ));
}

function toPublicCaseSnapshot(testCase, blocks) {
    return {
        id: testCase.id,
        title: testCase.title,
        layer: testCase.layer,
        feature: testCase.feature,
        story: testCase.story,
        scenario: testCase.scenario,
        code: testCase.code,
        precondition: testCase.precondition,
        expected: testCase.expected,
        stepLines: testCase.stepLines,
        blocks
    };
}

function classifyPair(weightedF1, generatedValidation) {
    if (weightedF1 >= MATCH_THRESHOLDS.strong && generatedValidation.valid) {
        return 'strong';
    }
    if (weightedF1 >= MATCH_THRESHOLDS.weak) {
        return 'weak';
    }
    return 'mismatch';
}

function buildSummary(pairReports, manualCases, generatedValidations) {
    const coveredPairs = pairReports.filter((pair) => pair.matchClass === 'strong' || pair.matchClass === 'weak');
    const coveredManualIds = new Set(coveredPairs.map((pair) => pair.manualCase?.id).filter(Boolean));
    const blockSummary = {};

    for (const blockName of Object.keys(BLOCK_WEIGHTS)) {
        const activePairs = coveredPairs.filter((pair) => pair.blockScores?.[blockName]?.active);
        blockSummary[blockName] = {
            matchedMacroPrecision: roundMetric(average(activePairs.map((pair) => pair.blockScores[blockName].precision))),
            matchedMacroRecall: roundMetric(average(activePairs.map((pair) => pair.blockScores[blockName].recall))),
            matchedMacroF1: roundMetric(average(activePairs.map((pair) => pair.blockScores[blockName].f1)))
        };
    }

    const effectiveGeneratedScores = pairReports.map((pair) => (
        pair.matchClass === 'strong' || pair.matchClass === 'weak'
            ? pair.weighted.f1
            : 0
    ));

    const effectiveManualScores = manualCases.map((manualCase) => {
        const pair = coveredPairs.find((entry) => entry.manualCase?.id === manualCase.id);
        return pair ? pair.weighted.f1 : 0;
    });

    return {
        matchedMacroPrecision: roundMetric(average(coveredPairs.map((pair) => pair.weighted.precision))),
        matchedMacroRecall: roundMetric(average(coveredPairs.map((pair) => pair.weighted.recall))),
        matchedMacroF1: roundMetric(average(coveredPairs.map((pair) => pair.weighted.f1))),
        allGeneratedCoverage: pairReports.length > 0 ? roundMetric(coveredPairs.length / pairReports.length) : 0,
        allManualCoverage: manualCases.length > 0 ? roundMetric(coveredManualIds.size / manualCases.length) : 0,
        allGeneratedMeanScore: pairReports.length > 0 ? roundMetric(average(effectiveGeneratedScores)) : 0,
        allManualMeanScore: manualCases.length > 0 ? roundMetric(average(effectiveManualScores)) : 0,
        generatedCount: pairReports.length,
        manualCount: manualCases.length,
        strongCount: pairReports.filter((pair) => pair.matchClass === 'strong').length,
        weakCount: pairReports.filter((pair) => pair.matchClass === 'weak').length,
        mismatchCount: pairReports.filter((pair) => pair.matchClass === 'mismatch').length,
        unmatchedCount: pairReports.filter((pair) => pair.matchClass === 'unmatched').length,
        generatedStructurallyInvalidCount: generatedValidations.filter((item) => !item.valid).length,
        blockSummary
    };
}

export async function compareGeneratedCasesAgainstAllure({
    projectId,
    jiraIssue,
    generatedCases,
    onProgress = null
}) {
    if (!projectId) {
        throw new Error('projectId is required for test case comparison');
    }
    if (!Array.isArray(generatedCases) || generatedCases.length === 0) {
        throw new Error('generatedCases must be a non-empty array');
    }

    const normalizedIssue = normalizeIssueKey(jiraIssue);
    if (!normalizedIssue) {
        throw new Error('jiraIssue is required for test case comparison');
    }

    onProgress?.(4);
    const normalizedGeneratedCases = generatedCases.map(normalizeGeneratedCase);
    const generatedValidations = validateGeneratedCases(normalizedGeneratedCases);

    onProgress?.(12);
    const {
        manualCases,
        diagnostics
    } = await loadManualCasesForJiraIssue(projectId, normalizedIssue, onProgress);
    const manualCompatValidations = manualCases.map(validateManualCaseCompat);

    onProgress?.(32);
    const candidateShortlists = buildCandidateShortlists(normalizedGeneratedCases, manualCases);
    const { pairState, blockCacheByCase } = await scoreCandidatePairs(
        normalizedGeneratedCases,
        manualCases,
        candidateShortlists,
        onProgress
    );

    onProgress?.(72);
    const { assignment } = solveAssignment(buildCostMatrix(normalizedGeneratedCases, manualCases, pairState));

    onProgress?.(84);
    const pairReports = normalizedGeneratedCases.map((generatedCase, generatedIndex) => {
        const assignedColumn = assignment[generatedIndex];
        const generatedValidation = generatedValidations[generatedIndex];

        if (assignedColumn === -1 || assignedColumn >= manualCases.length) {
            return {
                generatedIndex,
                generatedCase: toPublicCaseSnapshot(generatedCase, blockCacheByCase.generated[generatedIndex]),
                manualIndex: null,
                manualCase: null,
                matchClass: 'unmatched',
                weighted: { precision: 0, recall: 0, f1: 0 },
                shortlistSize: candidateShortlists[generatedIndex]?.length || 0,
                retrieval: null,
                blockScores: {},
                generatedValidation,
                manualCompatValidation: null
            };
        }

        const pairKey = `${generatedIndex}:${assignedColumn}`;
        const pair = pairState.get(pairKey);
        const manualCase = manualCases[assignedColumn];

        return {
            generatedIndex,
            generatedCase: toPublicCaseSnapshot(generatedCase, blockCacheByCase.generated[generatedIndex]),
            manualIndex: assignedColumn,
            manualCase: toPublicCaseSnapshot(manualCase, blockCacheByCase.manual[assignedColumn]),
            matchClass: pair ? classifyPair(pair.weighted.f1, generatedValidation) : 'mismatch',
            weighted: {
                precision: roundMetric(pair?.weighted?.precision || 0),
                recall: roundMetric(pair?.weighted?.recall || 0),
                f1: roundMetric(pair?.weighted?.f1 || 0)
            },
            shortlistSize: candidateShortlists[generatedIndex]?.length || 0,
            retrieval: pair?.retrieval || null,
            blockScores: Object.fromEntries(
                Object.entries(pair?.blocks || {}).map(([blockName, block]) => ([
                    blockName,
                    {
                        active: Boolean(block.active),
                        weight: block.weight,
                        precision: roundMetric(block.precision),
                        recall: roundMetric(block.recall),
                        f1: roundMetric(block.f1)
                    }
                ]))
            ),
            generatedValidation,
            manualCompatValidation: manualCompatValidations[assignedColumn]
        };
    });

    const summary = buildSummary(pairReports, manualCases, generatedValidations);
    const uncoveredManualCases = manualCases
        .filter((manualCase) => !pairReports.some((pair) => (
            (pair.matchClass === 'strong' || pair.matchClass === 'weak') &&
            pair.manualCase?.id === manualCase.id
        )))
        .map((manualCase, manualIndex) => ({
            manualIndex,
            manualCase: toPublicCaseSnapshot(manualCase, blockCacheByCase.manual[manualIndex]),
            manualCompatValidation: manualCompatValidations[manualIndex]
        }));

    onProgress?.(100);
    return {
        projectId,
        jiraIssue: normalizedIssue,
        weights: BLOCK_WEIGHTS,
        thresholds: MATCH_THRESHOLDS,
        assignmentCosts: ASSIGNMENT_COSTS,
        diagnostics,
        summary,
        pairReports,
        uncoveredManualCases,
        generatedValidations,
        manualCompatValidations
    };
}

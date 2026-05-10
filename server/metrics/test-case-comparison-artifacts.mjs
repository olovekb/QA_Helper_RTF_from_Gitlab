import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function safeFilenamePart(value, fallback) {
    const text = String(value || fallback || '').trim();
    const safe = text.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || fallback;
}

function relativeArtifactPath(filename) {
    return join('report', 'test-cases', filename).replace(/\\/g, '/');
}

function buildPairMetrics(pairReport = {}) {
    return {
        generatedIndex: pairReport.generatedIndex,
        manualIndex: pairReport.manualIndex,
        matchClass: pairReport.matchClass,
        generatedCaseId: pairReport.generatedCase?.id || null,
        manualCaseId: pairReport.manualCase?.id || null,
        generatedCaseTitle: pairReport.generatedCase?.title || null,
        manualCaseTitle: pairReport.manualCase?.title || null,
        weighted: pairReport.weighted || { precision: 0, recall: 0, f1: 0 },
        blockScores: pairReport.blockScores || {},
        retrieval: pairReport.retrieval || null,
        generatedValidation: pairReport.generatedValidation || null,
        manualCompatValidation: pairReport.manualCompatValidation || null
    };
}

export function buildBertScoreMetricsArtifactPayload({
    taskId,
    result,
    generatedAt = new Date().toISOString()
} = {}) {
    const pairReports = Array.isArray(result?.pairReports) ? result.pairReports : [];

    return {
        taskId,
        generatedAt,
        projectId: result?.projectId || null,
        jiraIssue: result?.jiraIssue || null,
        weights: result?.weights || {},
        thresholds: result?.thresholds || {},
        assignmentCosts: result?.assignmentCosts || {},
        summary: result?.summary || null,
        bertScoreMetrics: {
            summary: result?.summary || null,
            pairs: pairReports.map(buildPairMetrics)
        },
        pairReports,
        uncoveredManualCases: result?.uncoveredManualCases || [],
        generatedValidations: result?.generatedValidations || [],
        manualCompatValidations: result?.manualCompatValidations || [],
        diagnostics: result?.diagnostics || null
    };
}

export async function writeBertScoreMetricsArtifact({
    taskId,
    result,
    outputDir = join(process.cwd(), 'report', 'test-cases'),
    generatedAt
} = {}) {
    await mkdir(outputDir, { recursive: true });

    const id = safeFilenamePart(taskId, 'manual');
    const issue = safeFilenamePart(result?.jiraIssue, 'unknown-issue');
    const filename = `${id}-${issue}-bert-score-metrics.json`;
    const absoluteFilePath = join(outputDir, filename);
    const payload = buildBertScoreMetricsArtifactPayload({ taskId, result, generatedAt });

    await writeFile(absoluteFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    return {
        absoluteFilePath,
        relativeFilePath: relativeArtifactPath(filename)
    };
}

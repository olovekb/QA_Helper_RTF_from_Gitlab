import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export const TRACEABILITY_CSV_COLUMNS = Object.freeze([
    'coverage_source',
    'document_id',
    'atom_id',
    'stable_id',
    'content_hash',
    'source_section',
    'type',
    'target_level',
    'mode',
    'action',
    'condition',
    'expected_result',
    'method_ref',
    'method_name',
    'http_method',
    'endpoint',
    'request_params',
    'response_params',
    'coverage_status',
    'best_branch_id',
    'best_matched_branch_signature',
    'candidate_branch_ids',
    'candidate_branch_statuses',
    'candidate_branch_confidences',
    'confidence',
    'reason',
    'evidence',
    'comment'
]);

function safeTaskId(taskId) {
    return String(taskId || 'manual').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function csvEscape(value) {
    const text = Array.isArray(value)
        ? value.join(';')
        : String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function relativeArtifactPath(filename) {
    return join('report', 'test-models', filename).replace(/\\/g, '/');
}

function candidateValue(entry, key) {
    return (entry.candidateBranches || entry.matches || [])
        .map((candidate) => candidate?.[key])
        .filter((value) => value != null && String(value).trim())
        .join(';');
}

function evidenceText(entry) {
    if (Array.isArray(entry.evidence)) {
        return entry.evidence.join(';');
    }
    if (Array.isArray(entry.bestMatch?.evidence)) {
        return entry.bestMatch.evidence.join(';');
    }
    return entry.evidence || entry.bestMatch?.evidence || '';
}

function traceabilityRow(entry = {}) {
    return {
        coverage_source: entry.coverageSource || entry.coverage_source || '',
        document_id: entry.documentId || entry.document_id || '',
        atom_id: entry.atom_id || entry.requirementId || entry.sourceRowId || '',
        stable_id: entry.stableId || entry.stable_id || '',
        content_hash: entry.contentHash || entry.content_hash || entry.textHash || '',
        source_section: entry.source_section || entry.sectionPathDisplay || '',
        type: entry.type || '',
        target_level: entry.target_level || '',
        mode: entry.mode || '',
        action: entry.action || '',
        condition: entry.condition || '',
        expected_result: entry.expected_result || '',
        method_ref: entry.method_ref || '',
        method_name: entry.method_name || '',
        http_method: entry.http_method || '',
        endpoint: entry.endpoint || '',
        request_params: entry.request_params || '',
        response_params: entry.response_params || '',
        coverage_status: entry.coverageStatus || entry.coverage_status || entry.status || '',
        best_branch_id: entry.bestBranchId || entry.bestMatch?.branch_id || entry.bestMatch?.branchId || '',
        best_matched_branch_signature: entry.bestMatchedBranchSignature || entry.best_matched_branch_signature || entry.bestMatch?.matched_branch_signature || entry.bestMatch?.matchedBranchSignature || '',
        candidate_branch_ids: candidateValue(entry, 'branch_id') || candidateValue(entry, 'branchId'),
        candidate_branch_statuses: candidateValue(entry, 'coverage_status') || candidateValue(entry, 'coverageStatus') || candidateValue(entry, 'status'),
        candidate_branch_confidences: candidateValue(entry, 'confidence') || candidateValue(entry, 'finalScore'),
        confidence: entry.confidence || entry.bestMatch?.confidence || entry.bestMatch?.finalScore || '',
        reason: entry.reason || entry.bestMatch?.reason || '',
        evidence: evidenceText(entry),
        comment: entry.comment || ''
    };
}

function buildTraceabilityCsv(traceabilityMap = []) {
    const rows = [
        TRACEABILITY_CSV_COLUMNS.join(',')
    ];
    for (const entry of Array.isArray(traceabilityMap) ? traceabilityMap : []) {
        const row = traceabilityRow(entry);
        rows.push(TRACEABILITY_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(','));
    }
    return `${rows.join('\n')}\n`;
}

function writeJsonArtifact(outputDir, filename, payload) {
    const absoluteFilePath = join(outputDir, filename);
    writeFileSync(absoluteFilePath, JSON.stringify(payload, null, 2), 'utf8');
    return {
        absoluteFilePath,
        relativeFilePath: relativeArtifactPath(filename)
    };
}

function coverageSnapshot(coverage = null) {
    if (!coverage) {
        return null;
    }
    return {
        status: coverage.status || null,
        coverageSource: coverage.coverageSource || null,
        allTestableAtoms: coverage.allTestableAtoms ?? coverage.totalTestableRequirementUnits ?? null,
        strongCount: coverage.strongCount ?? coverage.coveredRequirementUnits ?? null,
        partialCount: coverage.partialCount ?? coverage.partialRequirementUnits ?? null,
        notCoveredCount: coverage.notCoveredCount ?? coverage.notCoveredRequirementUnits ?? null,
        strictCoverage: coverage.strictCoverage ?? coverage.hardCoverageRatio ?? null,
        potentialCoverage: coverage.potentialCoverage ?? null,
        hardCoverageRatio: coverage.hardCoverageRatio ?? null,
        partialCoverageRatio: coverage.partialCoverageRatio ?? null,
        softCoverageScore: coverage.softCoverageScore ?? null,
        orphanBranchRate: coverage.orphanBranchRate ?? null,
        incompleteLeafRate: coverage.incompleteLeafRate ?? null,
        branchCount: coverage.branchCount ?? null,
        embeddingModelUsed: coverage.embeddingModelUsed ?? null,
        confidence: coverage.confidence ?? null
    };
}

function manualRegistrySummary(coverage = null) {
    const diagnostics = coverage?.diagnostics?.manualRegistryDiagnostics || null;
    if (!diagnostics) {
        return null;
    }
    return {
        sourceFile: diagnostics.sourceFile || null,
        encodingUsed: diagnostics.encodingUsed || null,
        delimiterUsed: diagnostics.delimiterUsed || null,
        totalRows: diagnostics.totalRows ?? null,
        parsedRows: diagnostics.parsedRows ?? null,
        repairedRows: Array.isArray(diagnostics.repairedRows) ? diagnostics.repairedRows.length : 0,
        invalidRows: Array.isArray(diagnostics.invalidRows) ? diagnostics.invalidRows.length : 0,
        warnings: Array.isArray(diagnostics.warnings) ? diagnostics.warnings.length : 0
    };
}

export function buildQualitySummary({
    taskId,
    qualityStatus,
    qualityGate = null,
    postValidationQualityCheck = null
} = {}) {
    const finalCoverage = postValidationQualityCheck?.requirementCoverage ||
        qualityGate?.requirementCoverage ||
        null;
    const initialCoverage = qualityGate?.initial?.requirementCoverage ||
        qualityGate?.requirementCoverage ||
        null;

    return {
        taskId,
        qualityStatus,
        coverageSource: finalCoverage?.coverageSource || initialCoverage?.coverageSource || null,
        final: coverageSnapshot(finalCoverage),
        initial: coverageSnapshot(initialCoverage),
        manualRegistry: manualRegistrySummary(finalCoverage) || manualRegistrySummary(initialCoverage)
    };
}

export function writeTraceabilityArtifacts({
    taskId,
    outputDir,
    qualityStatus,
    qualityGate = null,
    postValidationQualityCheck = null,
    traceabilityMap = []
} = {}) {
    const resolvedOutputDir = outputDir || join(process.cwd(), 'report', 'test-models');
    mkdirSync(resolvedOutputDir, { recursive: true });

    const id = safeTaskId(taskId);
    const qualitySummary = buildQualitySummary({
        taskId,
        qualityStatus,
        qualityGate,
        postValidationQualityCheck
    });
    const traceabilityJson = writeJsonArtifact(
        resolvedOutputDir,
        `${id}-traceability-map.json`,
        {
            taskId,
            generatedAt: new Date().toISOString(),
            qualitySummary,
            qualityStatus,
            coverageSource: postValidationQualityCheck?.requirementCoverage?.coverageSource ||
                qualityGate?.requirementCoverage?.coverageSource ||
                traceabilityMap?.[0]?.coverageSource ||
                null,
            traceabilityMap
        }
    );

    const csvFilename = `${id}-traceability-map.csv`;
    const csvAbsoluteFilePath = join(resolvedOutputDir, csvFilename);
    writeFileSync(csvAbsoluteFilePath, buildTraceabilityCsv(traceabilityMap), 'utf8');
    const traceabilityCsv = {
        absoluteFilePath: csvAbsoluteFilePath,
        relativeFilePath: relativeArtifactPath(csvFilename)
    };

    const effectiveRequirementCoverage = postValidationQualityCheck?.requirementCoverage ||
        qualityGate?.requirementCoverage ||
        null;
    const qualitySummaryJson = writeJsonArtifact(
        resolvedOutputDir,
        `${id}-quality-summary.json`,
        qualitySummary
    );
    const qualityDiagnosticsJson = writeJsonArtifact(
        resolvedOutputDir,
        `${id}-quality-diagnostics.json`,
        {
            taskId,
            generatedAt: new Date().toISOString(),
            qualitySummary,
            qualityStatus,
            qualityGate,
            postValidationQualityCheck,
            requirementCoverageDiagnostics: effectiveRequirementCoverage?.diagnostics || null
        }
    );

    return {
        qualitySummary,
        traceabilityJson,
        traceabilityCsv,
        qualitySummaryJson,
        qualityDiagnosticsJson
    };
}

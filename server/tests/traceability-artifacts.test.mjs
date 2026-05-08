import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';

import { writeTraceabilityArtifacts } from '../traceability-artifacts.mjs';

test('traceability artifacts write JSON CSV and diagnostics files', () => {
    const root = join(process.cwd(), '.tmp-tests');
    mkdirSync(root, { recursive: true });
    const outputDir = mkdtempSync(join(root, 'traceability-artifacts-'));
    const artifacts = writeTraceabilityArtifacts({
        taskId: 'task-1',
        outputDir,
        qualityStatus: 'needs_review',
        qualityGate: {
            requirementCoverage: {
                coverageSource: 'manual_atom_registry',
                diagnostics: { confidence: 'normal' }
            }
        },
        postValidationQualityCheck: {
            requirementCoverage: {
                status: 'needs_review',
                coverageSource: 'manual_atom_registry',
                allTestableAtoms: 2,
                strongCount: 1,
                partialCount: 1,
                notCoveredCount: 0,
                strictCoverage: 0.5,
                potentialCoverage: 1,
                softCoverageScore: 0.77,
                orphanBranchRate: 0,
                incompleteLeafRate: 0,
                branchCount: 2,
                embeddingModelUsed: 'Qwen/Qwen3-Embedding-0.6B',
                confidence: 'normal',
                diagnostics: {
                    confidence: 'normal',
                    manualRegistryDiagnostics: {
                        sourceFile: 'latest.csv',
                        encodingUsed: 'utf-8',
                        delimiterUsed: ';',
                        totalRows: 2,
                        parsedRows: 2,
                        repairedRows: [],
                        invalidRows: []
                    }
                }
            }
        },
        traceabilityMap: [
            {
                coverageSource: 'manual_atom_registry',
                documentId: 'doc-1',
                atom_id: 'REQ-1',
                stableId: 'doc-1:REQ-1',
                contentHash: 'hash-1',
                source_section: '2.1 Registry',
                type: 'UI_BEHAVIOR',
                target_level: 'C1_E2E',
                mode: 'list',
                action: 'open list',
                condition: 'authorized user',
                expected_result: 'rows are visible',
                coverageStatus: 'strong',
                bestBranchId: 'branch-1',
                bestMatchedBranchSignature: 'feature > story > scenario > code',
                confidence: 0.91,
                reason: 'verified',
                evidence: ['rows are visible'],
                comment: 'baseline',
                candidateBranches: [
                    { branch_id: 'branch-1', coverage_status: 'strong', confidence: 0.91 },
                    { branch_id: 'branch-2', coverage_status: 'partial', confidence: 0.62 }
                ]
            }
        ]
    });

    assert.ok(artifacts.traceabilityJson.absoluteFilePath.endsWith('task-1-traceability-map.json'));
    assert.ok(artifacts.traceabilityCsv.absoluteFilePath.endsWith('task-1-traceability-map.csv'));
    assert.ok(artifacts.qualityDiagnosticsJson.absoluteFilePath.endsWith('task-1-quality-diagnostics.json'));
    assert.ok(artifacts.qualitySummaryJson.absoluteFilePath.endsWith('task-1-quality-summary.json'));

    const csv = readFileSync(artifacts.traceabilityCsv.absoluteFilePath, 'utf8');
    assert.match(csv.split('\n')[0], /coverage_source,document_id,atom_id,stable_id,content_hash/);
    assert.match(csv, /manual_atom_registry/);
    assert.match(csv, /branch-1;branch-2/);
    assert.match(csv, /strong;partial/);

    const diagnostics = JSON.parse(readFileSync(artifacts.qualityDiagnosticsJson.absoluteFilePath, 'utf8'));
    const traceabilityJson = JSON.parse(readFileSync(artifacts.traceabilityJson.absoluteFilePath, 'utf8'));
    const summary = JSON.parse(readFileSync(artifacts.qualitySummaryJson.absoluteFilePath, 'utf8'));

    assert.equal(diagnostics.qualityStatus, 'needs_review');
    assert.equal(diagnostics.qualitySummary.final.strictCoverage, 0.5);
    assert.equal(diagnostics.qualitySummary.manualRegistry.encodingUsed, 'utf-8');
    assert.equal(traceabilityJson.qualitySummary.final.potentialCoverage, 1);
    assert.equal(summary.final.strongCount, 1);
    assert.equal(summary.manualRegistry.delimiterUsed, ';');
});

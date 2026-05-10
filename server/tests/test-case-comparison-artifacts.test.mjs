import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { writeBertScoreMetricsArtifact } from '../metrics/test-case-comparison-artifacts.mjs';

test('writeBertScoreMetricsArtifact persists full BERTScore comparison metrics as JSON', async () => {
    const outputDir = join(process.cwd(), 'report', `test-cases-test-${Date.now()}`);
    await mkdir(outputDir, { recursive: true });

    const comparisonResult = {
        projectId: '100',
        jiraIssue: 'KCB-8978',
        weights: { title: 0.15, steps: 0.4 },
        thresholds: { strong: 0.82, weak: 0.7 },
        summary: {
            matchedMacroPrecision: 0.8123,
            matchedMacroRecall: 0.7456,
            matchedMacroF1: 0.7788,
            blockSummary: {
                steps: {
                    matchedMacroPrecision: 0.9,
                    matchedMacroRecall: 0.8,
                    matchedMacroF1: 0.85
                }
            }
        },
        pairReports: [{
            generatedIndex: 0,
            manualIndex: 2,
            matchClass: 'strong',
            weighted: { precision: 0.91, recall: 0.82, f1: 0.86 },
            blockScores: {
                title: { active: true, weight: 0.15, precision: 0.95, recall: 0.9, f1: 0.92 },
                steps: { active: true, weight: 0.4, precision: 0.9, recall: 0.8, f1: 0.85 }
            },
            generatedCase: { id: 'tc-1', title: 'Generated case' },
            manualCase: { id: '12345', title: 'Manual case' }
        }]
    };

    try {
        const artifact = await writeBertScoreMetricsArtifact({
            taskId: 'task-1',
            result: comparisonResult,
            outputDir,
            generatedAt: '2026-05-09T00:00:00.000Z'
        });

        assert.equal(artifact.relativeFilePath, 'report/test-cases/task-1-KCB-8978-bert-score-metrics.json');
        assert.ok(artifact.absoluteFilePath.endsWith('task-1-KCB-8978-bert-score-metrics.json'));

        const persisted = JSON.parse(await readFile(artifact.absoluteFilePath, 'utf8'));
        assert.equal(persisted.taskId, 'task-1');
        assert.equal(persisted.projectId, '100');
        assert.equal(persisted.jiraIssue, 'KCB-8978');
        assert.deepEqual(persisted.weights, comparisonResult.weights);
        assert.deepEqual(persisted.thresholds, comparisonResult.thresholds);
        assert.deepEqual(persisted.summary, comparisonResult.summary);
        assert.deepEqual(persisted.pairReports, comparisonResult.pairReports);
        assert.deepEqual(persisted.bertScoreMetrics.pairs[0].weighted, comparisonResult.pairReports[0].weighted);
        assert.deepEqual(persisted.bertScoreMetrics.pairs[0].blockScores, comparisonResult.pairReports[0].blockScores);
    } finally {
        await rm(outputDir, { recursive: true, force: true });
    }
});

/**
 * Debug API маршруты для автоматического тестирования и улучшения агента
 */

import { runAutomatedTest, analyzeResults, compareWithReference } from './debug-agent.mjs';
import { analyzeProjectRules, debugRuleApplication, getRulesForProject } from './validation-engine.mjs';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execPromise = promisify(exec);
const upload = multer({ dest: os.tmpdir() });

/**
 * Регистрирует debug маршруты на Express app
 */
export function registerDebugRoutes(app) {

    /**
     * POST /api/debug/test-agent
     * Автоматическое тестирование агента с заданными требованиями
     * Body: { requirements: string }
     */
    app.post('/api/debug/test-agent', async (req, res) => {
        try {
            const { requirements, projectId } = req.body;

            if (!requirements) {
                return res.status(400).json({ error: 'requirements обязателен' });
            }

            console.log('[DEBUG API] Запуск автоматического тестирования агента...');
            if (projectId) {
                console.log(`[DEBUG API] 🔑 ProjectId: ${projectId}`);
            }

            const baseURL = `http://localhost:${process.env.PORT || 5002}`;
            console.log(`[DEBUG API] Используем baseURL: ${baseURL}`);
            const result = await runAutomatedTest(requirements, baseURL, projectId);

            res.json({
                success: result.success,
                score: result.score,
                duration: result.duration,
                testModelStats: result.comparison.modelValidation.stats,
                testCasesStats: result.comparison.casesValidation.stats,
                errors: {
                    model: result.comparison.modelValidation.errors,
                    cases: result.comparison.casesValidation.errors
                },
                warnings: {
                    model: result.comparison.modelValidation.warnings,
                    cases: result.comparison.casesValidation.warnings
                },
                suggestions: result.analysis.suggestions,
                testModel: result.testModel,
                testCases: result.testCases
            });

        } catch (error) {
            console.error('[DEBUG API] Ошибка тестирования:', error);
            res.status(500).json({ error: error.message, stack: error.stack });
        }
    });

    /**
     * POST /api/debug/validate-model
     * Валидация тестовой модели
     * Body: { testModel: array }
     */
    app.post('/api/debug/validate-model', async (req, res) => {
        try {
            const { testModel } = req.body;

            if (!testModel || !Array.isArray(testModel)) {
                return res.status(400).json({ error: 'testModel должен быть массивом' });
            }

            const comparison = compareWithReference({ testModel, testCases: [] });
            const analysis = analyzeResults(comparison);

            res.json({
                valid: comparison.modelValidation.valid,
                score: analysis.score,
                errors: comparison.modelValidation.errors,
                warnings: comparison.modelValidation.warnings,
                stats: comparison.modelValidation.stats,
                suggestions: analysis.suggestions.filter(s => s.type.includes('test_model'))
            });

        } catch (error) {
            console.error('[DEBUG API] Ошибка валидации модели:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/debug/validate-cases
     * Валидация тест-кейсов
     * Body: { testCases: array, testModel: array }
     */
    app.post('/api/debug/validate-cases', async (req, res) => {
        try {
            const { testCases, testModel } = req.body;

            if (!testCases || !Array.isArray(testCases)) {
                return res.status(400).json({ error: 'testCases должен быть массивом' });
            }

            const comparison = compareWithReference({ testModel: testModel || [], testCases });
            const analysis = analyzeResults(comparison);

            res.json({
                valid: comparison.casesValidation.valid,
                score: analysis.score,
                errors: comparison.casesValidation.errors,
                warnings: comparison.casesValidation.warnings,
                stats: comparison.casesValidation.stats,
                suggestions: analysis.suggestions.filter(s => s.type.includes('test_case'))
            });

        } catch (error) {
            console.error('[DEBUG API] Ошибка валидации тест-кейсов:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/debug/analyze-rules
     * Анализ правил для проекта
     * Body: { projectId: string }
     */
    app.post('/api/debug/analyze-rules', async (req, res) => {
        try {
            const { projectId } = req.body;

            if (!projectId) {
                return res.status(400).json({ error: 'projectId is required' });
            }

            const analysis = analyzeProjectRules(projectId);

            res.json({
                success: true,
                analysis,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[DEBUG] Ошибка анализа правил:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/debug/test-rule-application
     * Отладка применения правил к конкретному тест-кейсу
     * Body: { testCase: object, projectId: string }
     */
    app.post('/api/debug/test-rule-application', async (req, res) => {
        try {
            const { testCase, projectId } = req.body;

            if (!testCase || !projectId) {
                return res.status(400).json({ error: 'testCase and projectId are required' });
            }

            const debugInfo = debugRuleApplication(testCase, projectId);

            res.json({
                success: true,
                debugInfo,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[DEBUG] Ошибка отладки правил:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /api/debug/rules/:projectId
     * Получение всех правил для проекта
     */
    app.get('/api/debug/rules/:projectId', async (req, res) => {
        try {
            const { projectId } = req.params;
            const rules = getRulesForProject(projectId);

            const rulesSummary = rules.map(rule => ({
                id: rule.id,
                name: rule.name,
                source: rule.source,
                enabled: rule.enabled !== false,
                checkType: rule.check_type,
                category: rule.category,
                level: rule.level,
                appliesTo: rule.appliesTo
            }));

            res.json({
                success: true,
                projectId,
                totalRules: rules.length,
                rules: rulesSummary,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[DEBUG] Ошибка получения правил:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/debug/ocr
     * Отладка OCR воркера
     * Body: file (multipart), targetText (field)
     */
    app.post('/api/debug/ocr', upload.single('image'), async (req, res) => {
        try {
            const { targetText = 'все' } = req.body;
            const file = req.file;

            if (!file) {
                return res.status(400).json({ error: 'Изображение (image) обязательно' });
            }

            console.log(`[DEBUG OCR] Тестирование OCR для файла: ${file.originalname}, цель: ${targetText}`);

            const scriptPath = path.join(process.cwd(), 'server', 'scripts', 'ocr_worker.py');
            const command = `python "${scriptPath}" "${file.path}" "${targetText}"`;

            try {
                const { stdout, stderr } = await execPromise(command, {
                    env: { ...process.env }
                });

                if (stderr) console.warn('[DEBUG OCR] stderr:', stderr);

                const result = JSON.parse(stdout);
                res.json(result);

            } finally {
                // Удаляем временный файл
                await fs.unlink(file.path).catch(() => {});
            }

        } catch (error) {
            console.error('[DEBUG OCR] Ошибка:', error);
            res.status(500).json({ error: error.message });
        }
    });

    console.log('[DEBUG] Debug API маршруты зарегистрированы:');
    console.log('[DEBUG]   POST /api/debug/test-agent');
    console.log('[DEBUG]   POST /api/debug/validate-model');
    console.log('[DEBUG]   POST /api/debug/validate-cases');
    console.log('[DEBUG]   POST /api/debug/analyze-rules');
    console.log('[DEBUG]   POST /api/debug/test-rule-application');
    console.log('[DEBUG]   GET  /api/debug/rules/:projectId');
}

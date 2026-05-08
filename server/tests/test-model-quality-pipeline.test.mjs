import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getTestModelRulesFingerprint,
    getRecommendedJudgeModelSequence,
    getSkippedRuntimeRules,
    getValidationPromptRules,
    loadTestModelRuntimeRules,
    parseTestModelValidationRules
} from '../test-model-rules-runtime.mjs';
import {
    TEST_MODEL_VALIDATION_PIPELINE_VERSION,
    collectStaticTestModelIssues,
    hasPersistedRuntimeValidation,
    isRuntimeValidationComplete,
    runTestModelValidationPipeline
} from '../test-model-quality-pipeline.mjs';

function createMinimalValidModel() {
    return [
        {
            id: 'f-1',
            text: 'Платежи',
            stories: [
                {
                    id: 'st-1',
                    text: 'Оплата счета',
                    scenarios: [
                        {
                            id: 'sc-1',
                            text: 'Нажать кнопку "Оплатить"',
                            codes: [
                                { id: 'c-1', text: 'Отправляется POST /payments', type: 'frontend' },
                                { id: 'c-2', text: 'Возвращается успешный ответ для POST /payments', type: 'backend' }
                            ]
                        }
                    ]
                }
            ]
        }
    ];
}

function assertValidationMetadata(validation) {
    assert.equal(validation.pipelineVersion, TEST_MODEL_VALIDATION_PIPELINE_VERSION);
    assert.equal(validation.rulesFingerprint, getTestModelRulesFingerprint());
    assert.equal(typeof validation.executedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(validation.executedAt)));
    assert.equal(isRuntimeValidationComplete(validation), true);
}

test('test model rules parser extracts runtime rules and skipped export rules', () => {
    const rules = loadTestModelRuntimeRules();
    assert.ok(rules.length > 10);

    const parsedAgain = parseTestModelValidationRules(
        '# Demo\n\n## Section\n- Runtime rule [ERROR]\n- Secondary rule [WARNING]\n'
    );
    assert.equal(parsedAgain.length, 2);
    assert.equal(parsedAgain[0].severity, 'error');
    assert.equal(parsedAgain[1].severity, 'warning');

    const skippedRules = getSkippedRuntimeRules();
    assert.ok(skippedRules.some((rule) => rule.applicability === 'export_only'));
    assert.ok(skippedRules.some((rule) => rule.applicability === 'not_applicable_at_generation'));
});

test('recommended judge model sequence prefers fixed Cloud.ru order', () => {
    const sequence = getRecommendedJudgeModelSequence([
        'MiniMaxAI/MiniMax-M2',
        'Qwen/Qwen3-235B-A22B-Instruct-2507',
        'Qwen/Qwen3-Next-80B-A3B-Instruct',
        'zai-org/GLM-4.7'
    ]);

    assert.deepEqual(sequence.slice(0, 3), [
        'Qwen/Qwen3-235B-A22B-Instruct-2507',
        'Qwen/Qwen3-Next-80B-A3B-Instruct',
        'MiniMaxAI/MiniMax-M2'
    ]);
});

test('static validation finds detailed steps, technical leakage, subjective naming and invalid code type', () => {
    const invalidModel = [
        {
            id: 'f-1',
            text: 'Платежи корректно',
            stories: [
                {
                    id: 'st-1',
                    text: 'API создание и удаление',
                    scenarios: [
                        {
                            id: 'sc-1',
                            text: '1. Открыть форму затем ввести данные',
                            codes: [
                                {
                                    id: 'c-1',
                                    text: 'curl -H Authorization: Bearer abc POST /payments {"amount":100,"currency":"RUB"}',
                                    type: 'integration'
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ];

    const { staticIssues } = collectStaticTestModelIssues(invalidModel, {
        analyzeScenarioActionability: () => ({
            valid: false,
            reason: 'Scenario описывает пошаговую инструкцию'
        }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => []
    });

    assert.ok(staticIssues.some((issue) => issue.message.includes('оценочную формулировку')));
    assert.ok(staticIssues.some((issue) => issue.message.includes('техническая реализация')));
    assert.ok(staticIssues.some((issue) => issue.message.includes('пошаговая инструкция')));
    assert.ok(staticIssues.some((issue) => issue.message.includes('недопустимый type')));
    assert.ok(staticIssues.some((issue) => issue.message.includes('запрещенную техническую детализацию')));
});

test('validation pipeline passes on first judge attempt when model is valid', async () => {
    const validModel = createMinimalValidModel();
    const llmClient = async (messages, options) => {
        assert.equal(options.model, 'Qwen/Qwen3-235B-A22B-Instruct-2507');
        assert.match(String(messages[0].content), /LLM-as-a-judge/);
        return {
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            passed: true,
                            summary: 'ok',
                            issues: [],
                            scores: { structure: 95, readability: 92, atomicity: 96, detailLevel: 94 }
                        })
                    }
                }
            ]
        };
    };

    const result = await runTestModelValidationPipeline({
        model: validModel,
        llmClient,
        modelsToTry: ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
        requirementsText: 'Оплата счета',
        analyzeScenarioActionability: () => ({ valid: true, reason: null }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => [],
        prepareModel: (value) => value,
        maxAttempts: 3
    });

    assert.equal(result.validation.passed, true);
    assert.equal(result.validation.attemptsUsed, 0);
    assert.equal(result.validation.judgeModel, 'Qwen/Qwen3-235B-A22B-Instruct-2507');
    assert.equal(result.validation.summary.errors, 0);
    assertValidationMetadata(result.validation);
    assert.equal(hasPersistedRuntimeValidation({
        result: { validation: result.validation },
        metrics: {
            validationExecuted: true,
            validationPassed: result.validation.passed,
            validationAttempts: result.validation.attemptsUsed,
            validationErrors: result.validation.summary.errors,
            validationRulesFingerprint: result.validation.rulesFingerprint
        }
    }), true);
});

test('validation pipeline repairs model after judge error and passes on retry', async () => {
    const baseModel = createMinimalValidModel();
    const fixedModel = createMinimalValidModel();
    fixedModel[0].stories[0].scenarios[0].text = 'Нажать кнопку "Оплатить повторно"';

    const blockingRuleId = getValidationPromptRules()[0].ruleId;
    let judgeCalls = 0;

    const llmClient = async (messages) => {
        const systemPrompt = String(messages[0].content || '');

        if (systemPrompt.includes('LLM-as-a-judge')) {
            judgeCalls += 1;
            if (judgeCalls === 1) {
                return {
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    passed: false,
                                    summary: 'need fix',
                                    issues: [
                                        {
                                            ruleId: blockingRuleId,
                                            severity: 'error',
                                            nodePath: 'Платежи → Оплата счета → Нажать кнопку "Оплатить"',
                                            nodeId: 'sc-1',
                                            nodeType: 'scenario',
                                            message: 'Scenario нужно уточнить',
                                            evidence: 'Слишком общий сценарий',
                                            suggestedFix: 'Добавить более точное действие'
                                        }
                                    ]
                                })
                            }
                        }
                    ]
                };
            }

            return {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                passed: true,
                                summary: 'fixed',
                                issues: [],
                                scores: { structure: 97, readability: 96, atomicity: 97, detailLevel: 95 }
                            })
                        }
                    }
                ]
            };
        }

        return {
            choices: [
                {
                    message: {
                        content: JSON.stringify(fixedModel)
                    }
                }
            ]
        };
    };

    const result = await runTestModelValidationPipeline({
        model: baseModel,
        llmClient,
        modelsToTry: ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
        requirementsText: 'Оплата счета',
        analyzeScenarioActionability: () => ({ valid: true, reason: null }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => [],
        prepareModel: (value) => value,
        maxAttempts: 3
    });

    assert.equal(result.validation.passed, true);
    assert.equal(result.validation.attemptsUsed, 1);
    assertValidationMetadata(result.validation);
    assert.equal(result.model[0].stories[0].scenarios[0].text, 'Нажать кнопку "Оплатить повторно"');
});

test('validation pipeline repairs judge issues with the original generation model', async () => {
    const baseModel = createMinimalValidModel();
    const fixedModel = createMinimalValidModel();
    fixedModel[0].stories[0].scenarios[0].text = 'Click Pay again';

    const blockingRuleId = getValidationPromptRules()[0].ruleId;
    const calls = [];
    let judgeCalls = 0;

    const llmClient = async (messages, options) => {
        const systemPrompt = String(messages[0].content || '');

        if (systemPrompt.includes('LLM-as-a-judge')) {
            calls.push({ phase: 'judge', model: options.model });
            judgeCalls += 1;

            return {
                choices: [
                    {
                        message: {
                            content: JSON.stringify(judgeCalls === 1
                                ? {
                                    passed: false,
                                    summary: 'needs repair',
                                    issues: [
                                        {
                                            ruleId: blockingRuleId,
                                            severity: 'error',
                                            nodePath: 'Feature -> Story -> Scenario',
                                            nodeId: 'sc-1',
                                            nodeType: 'scenario',
                                            message: 'Scenario needs a targeted repair',
                                            evidence: 'judge issue',
                                            suggestedFix: 'Rewrite the scenario with the source generation model'
                                        }
                                    ]
                                }
                                : {
                                    passed: true,
                                    summary: 'fixed',
                                    issues: [],
                                    scores: { structure: 97, readability: 96, atomicity: 97, detailLevel: 95 }
                                })
                        }
                    }
                ]
            };
        }

        calls.push({ phase: 'repair', model: options.model });
        return {
            choices: [
                {
                    message: {
                        content: JSON.stringify(fixedModel)
                    }
                }
            ]
        };
    };

    const result = await runTestModelValidationPipeline({
        model: baseModel,
        llmClient,
        modelsToTry: ['judge-qwen'],
        repairModelsToTry: ['selected-generation-model', 'judge-qwen'],
        requirementsText: 'Payment',
        analyzeScenarioActionability: () => ({ valid: true, reason: null }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => [],
        prepareModel: (value) => value,
        maxAttempts: 3
    });

    assert.equal(result.validation.passed, true);
    assert.deepEqual(calls.map((call) => `${call.phase}:${call.model}`), [
        'judge:judge-qwen',
        'repair:selected-generation-model',
        'judge:judge-qwen'
    ]);
    assert.equal(result.model[0].stories[0].scenarios[0].text, 'Click Pay again');
});

test('validation pipeline preserves previous model when repair degenerates to empty array', async () => {
    const baseModel = createMinimalValidModel();
    const blockingRuleId = getValidationPromptRules()[0].ruleId;

    const llmClient = async (messages) => {
        const systemPrompt = String(messages[0].content || '');

        if (systemPrompt.includes('LLM-as-a-judge')) {
            return {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                passed: false,
                                summary: 'need fix',
                                issues: [
                                    {
                                        ruleId: blockingRuleId,
                                        severity: 'error',
                                        nodePath: 'РџР»Р°С‚РµР¶Рё',
                                        nodeId: 'f-1',
                                        nodeType: 'feature',
                                        message: 'Feature РЅСѓР¶РЅРѕ СѓС‚РѕС‡РЅРёС‚СЊ',
                                        evidence: 'judge issue',
                                        suggestedFix: 'РЎРґРµР»Р°С‚СЊ feature С‚РѕС‡РЅРµРµ'
                                    }
                                ]
                            })
                        }
                    }
                ]
            };
        }

        return {
            choices: [
                {
                    message: {
                        content: JSON.stringify([])
                    }
                }
            ]
        };
    };

    const result = await runTestModelValidationPipeline({
        model: baseModel,
        llmClient,
        modelsToTry: ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
        requirementsText: 'РћРїР»Р°С‚Р° СЃС‡РµС‚Р°',
        analyzeScenarioActionability: () => ({ valid: true, reason: null }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => [],
        prepareModel: (value) => value,
        maxAttempts: 3
    });

    assert.equal(result.validation.passed, false);
    assert.equal(result.validation.attemptsUsed, 1);
    assert.deepEqual(result.model, baseModel);
    assert.ok(result.validation.judgeIssues.some((issue) => issue.message.includes('empty test model')));
    assertValidationMetadata(result.validation);
});

test('validation pipeline preserves previous model when repair removes existing branches', async () => {
    const baseModel = createMinimalValidModel();
    const shrunkenModel = createMinimalValidModel();
    shrunkenModel[0].stories[0].scenarios[0].codes = shrunkenModel[0].stories[0].scenarios[0].codes.slice(0, 1);
    const blockingRuleId = getValidationPromptRules()[0].ruleId;
    let judgeCalls = 0;

    const llmClient = async (messages) => {
        const systemPrompt = String(messages[0].content || '');

        if (systemPrompt.includes('LLM-as-a-judge')) {
            judgeCalls += 1;
            return {
                choices: [
                    {
                        message: {
                            content: JSON.stringify(judgeCalls === 1
                                ? {
                                    passed: false,
                                    summary: 'need fix',
                                    issues: [
                                        {
                                            ruleId: blockingRuleId,
                                            severity: 'error',
                                            nodePath: 'Feature -> Story -> Scenario -> Code',
                                            nodeId: 'c-2',
                                            nodeType: 'code',
                                            message: 'Code needs a targeted wording fix',
                                            evidence: 'judge issue',
                                            suggestedFix: 'Rewrite one Code node'
                                        }
                                    ]
                                }
                                : {
                                    passed: true,
                                    summary: 'ok',
                                    issues: []
                                })
                        }
                    }
                ]
            };
        }

        return {
            choices: [
                {
                    message: {
                        content: JSON.stringify(shrunkenModel)
                    }
                }
            ]
        };
    };

    const result = await runTestModelValidationPipeline({
        model: baseModel,
        llmClient,
        modelsToTry: ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
        requirementsText: 'Payment',
        analyzeScenarioActionability: () => ({ valid: true, reason: null }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => [],
        prepareModel: (value) => value,
        maxAttempts: 3
    });

    assert.equal(result.validation.passed, false);
    assert.equal(result.validation.attemptsUsed, 1);
    assert.deepEqual(result.model, baseModel);
    assert.ok(result.validation.judgeIssues.some((issue) => issue.message.includes('reduced test model coverage')));
    assertValidationMetadata(result.validation);
});

test('validation pipeline returns invalid result after exhausting repair attempts', async () => {
    const validModel = createMinimalValidModel();
    const blockingRuleId = getValidationPromptRules()[0].ruleId;

    const llmClient = async (messages) => {
        const systemPrompt = String(messages[0].content || '');

        if (systemPrompt.includes('LLM-as-a-judge')) {
            return {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                passed: false,
                                summary: 'still failing',
                                issues: [
                                    {
                                        ruleId: blockingRuleId,
                                        severity: 'error',
                                        nodePath: 'Платежи → Оплата счета',
                                        nodeId: 'st-1',
                                        nodeType: 'story',
                                        message: 'Story дублирует логику',
                                        evidence: 'semantic duplicate',
                                        suggestedFix: 'Перестроить Story'
                                    }
                                ]
                            })
                        }
                    }
                ]
            };
        }

        return {
            choices: [
                {
                    message: {
                        content: JSON.stringify(validModel)
                    }
                }
            ]
        };
    };

    const result = await runTestModelValidationPipeline({
        model: validModel,
        llmClient,
        modelsToTry: ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
        requirementsText: 'Оплата счета',
        analyzeScenarioActionability: () => ({ valid: true, reason: null }),
        validateTestModelLegacy: () => ({ valid: true, errors: [], warnings: [] }),
        detectModelStructureIssues: () => [],
        prepareModel: (value) => value,
        maxAttempts: 3
    });

    assert.equal(result.validation.passed, false);
    assert.equal(result.validation.attemptsUsed, 3);
    assert.ok(result.validation.summary.errors > 0);
    assertValidationMetadata(result.validation);
});

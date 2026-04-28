import {
    TEST_MODEL_CANONICAL_CODE_TYPES,
    buildTestModelRulesPrompt,
    getCuratedTestModelExemplarJson,
    getSkippedRuntimeRules,
    getTestModelRulesFingerprint,
    getValidationPromptRules,
    loadTestModelRuntimeRules
} from './test-model-rules-runtime.mjs';

const SUBJECTIVE_WORDS_REGEX = /(^|[^\p{L}\p{N}_])(корректно|нормально|удобно|успешно|правильно|красиво|быстро|легко)(?=$|[^\p{L}\p{N}_])/iu;
const MIXED_OUTCOME_HINTS_REGEX = /(^|[^\p{L}\p{N}_])(успех|ошибка|таймаут|timeout|отмена|cancel|недоступ|скрыт|неактив|валидац)(?=$|[^\p{L}\p{N}_])/giu;
const STEP_LIKE_REGEX = /(^|\s)(\d+\s*[\).]|шаг\s*\d+|step\s*\d+|затем\b|после этого\b|далее\b|потом\b)/i;
const PARAMETER_ENUM_REGEX = /\b(min|max|min-1|max\+1|boundary|граничн|параметр|перебор|набор значений|examples?|string\)|boolean\)|integer\)|enum)\b/i;
const FORBIDDEN_TECH_DETAILS_REGEX = /\b(curl|authorization|bearer|content-type|headers?|request body|response body|jwt|cookie|set-cookie|тело запроса|заголовки|токен)\b/i;
const FULL_ERROR_CATALOG_REGEX = /\b(400|401|403|404|409|422|429|500|502|503)\b.*\b(400|401|403|404|409|422|429|500|502|503)\b/i;
const JSON_PAYLOAD_REGEX = /\{[^}]{18,}\}/;
const TECHNICAL_STORY_REGEX = /\b(api|endpoint|метод|реализац|обработк|валидатор|кнопк|чек-?бокс|checkbox|radio|toggle|поле|loader|лоадер|response|request)\b/i;
const CRUD_BUNDLE_REGEX = /\b(создани|редактирован|обновлени|удалени|просмотр|получени).*(создани|редактирован|обновлени|удалени|просмотр|получени)\b/i;

export const TEST_MODEL_VALIDATION_PIPELINE_VERSION = 1;

function normalizeText(text = '') {
    return String(text || '')
        .toLowerCase()
        .replace(/["'`«»„”“]/g, ' ')
        .replace(/[^\p{L}\p{N}\s/:-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePathPart(text = '') {
    return String(text || '').trim() || 'Без названия';
}

function createIssue({
    rule,
    severity = null,
    source = 'static',
    nodePath = '',
    nodeId = null,
    nodeType = null,
    message,
    evidence = '',
    suggestedFix = ''
}) {
    return {
        ruleId: rule?.ruleId || 'runtime.test_model',
        severity: severity || rule?.severity || 'warning',
        source,
        nodePath,
        nodeId,
        nodeType,
        message,
        evidence,
        suggestedFix
    };
}

function dedupeIssues(issues = []) {
    const seen = new Set();
    return (issues || []).filter((issue) => {
        const key = [
            issue.ruleId,
            issue.severity,
            normalizeText(issue.nodePath),
            normalizeText(issue.message)
        ].join('|');

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function resolveRuleCatalog() {
    const rules = loadTestModelRuntimeRules();
    const findRule = (pattern) => rules.find((rule) => pattern.test(rule.text));
    return {
        rules,
        storySingleMeaning: findRule(/одна Story описывает один сквозной пользовательский смысл/i),
        scenarioNotTestCase: findRule(/Scenario не превращается в тест-кейс/i),
        scenarioSplitChecks: findRule(/если внутри одной точки фактически разные проверки/i),
        detailedSteps: findRule(/детальные шаги выполнения/i),
        parameterSets: findRule(/наборы параметров и перебор данных/i),
        detailedExpected: findRule(/подробные ожидаемые результаты/i),
        fullCurl: findRule(/полный curl/i),
        fullHeaders: findRule(/заголовки, токены, тело запроса целиком/i),
        fullErrors: findRule(/полный перечень всех вариантов ошибок/i),
        allowedStartLine: findRule(/стартовая строка как идентификатор точки взаимодействия/i),
        noSubjectiveWords: findRule(/названия узлов должны быть однозначными/i),
        noMixedChecks: findRule(/смесь нескольких разных проверок и разных итогов/i),
        splitOutcomes: findRule(/если одно название требует разных итогов/i),
        crudDomainOnly: findRule(/CRUD используется только там/i),
        crudNoFormalSplit: findRule(/если операция не существует как самостоятельная функция/i),
        onlyRealCrudOps: findRule(/если удаление или изменение недоступны/i),
        bulkWithoutMechanicalCrud: findRule(/пакетные и массовые операции отражаются/i),
        dedupeAcrossStories: findRule(/Если одна и та же проверка повторяется в нескольких Story/i),
        qualityIntegrationNoInstructions: findRule(/интеграционные точки уровня C2 C3 отражают смысл проверок/i),
        qualityReadable: findRule(/модель читается однозначно без знания автора/i)
    };
}

function countOutcomeHints(text = '') {
    const matches = String(text || '').match(MIXED_OUTCOME_HINTS_REGEX);
    return matches ? matches.length : 0;
}

function looksLikeMultipleChecks(text = '') {
    const normalized = String(text || '');
    if (countOutcomeHints(normalized) >= 2) {
        return true;
    }

    const separators = [';', '/', ' и ', ' или ', ' либо '];
    return separators.some((separator) => normalized.toLowerCase().includes(separator)) &&
        /(ошиб|успех|таймаут|недоступ|отмена|валидац|подсветк|блокировк)/i.test(normalized);
}

function looksTooDetailed(text = '') {
    return STEP_LIKE_REGEX.test(text) || PARAMETER_ENUM_REGEX.test(text) || JSON_PAYLOAD_REGEX.test(text);
}

function hasForbiddenTechnicalDetail(text = '') {
    return FORBIDDEN_TECH_DETAILS_REGEX.test(text) || FULL_ERROR_CATALOG_REGEX.test(text);
}

function hasExpandedExpected(text = '') {
    return JSON_PAYLOAD_REGEX.test(text) || /\b(должен|должна|ожидается|expected|status:|errorCode|message:)\b/i.test(text);
}

function normalizeCodeType(text = '', currentType = '') {
    if (TEST_MODEL_CANONICAL_CODE_TYPES.includes(currentType)) {
        return currentType;
    }

    const normalized = String(text || '').toLowerCase();
    if (
        /^(возвращается|сохраняется|создается|удаляется|обновляется|отправляется push|отправляется sms|отправляется email)/i.test(normalized) ||
        /(бд|db|уведомлени|лог\b|event\b)/i.test(normalized)
    ) {
        return 'backend';
    }

    return 'frontend';
}

export function extractJsonCandidate(rawContent, preferred = 'object') {
    const text = String(rawContent || '').trim();
    if (!text) {
        throw new Error('Пустой ответ модели');
    }

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');

    if (preferred === 'array' && arrayStart !== -1 && arrayEnd > arrayStart) {
        return text.slice(arrayStart, arrayEnd + 1).trim();
    }

    if (objectStart !== -1 && objectEnd > objectStart) {
        return text.slice(objectStart, objectEnd + 1).trim();
    }

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
        return text.slice(arrayStart, arrayEnd + 1).trim();
    }

    return text;
}

export function parseJudgeResultContent(rawContent) {
    const parsed = JSON.parse(extractJsonCandidate(rawContent, 'object'));
    return {
        passed: Boolean(parsed?.passed),
        summary: String(parsed?.summary || '').trim(),
        scores: parsed?.scores && typeof parsed.scores === 'object' ? parsed.scores : null,
        issues: Array.isArray(parsed?.issues) ? parsed.issues : []
    };
}

function parseRepairResultContent(rawContent) {
    const candidate = extractJsonCandidate(rawContent, 'array');
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
        return parsed;
    }
    if (Array.isArray(parsed?.model)) {
        return parsed.model;
    }
    throw new Error('Repair response is not an array model');
}

function summarizeRequirements(reqStructure = null, requirementsText = '') {
    const featureLines = Array.isArray(reqStructure?.features)
        ? reqStructure.features.slice(0, 20).map((feature) => (
            `- ${feature.name}: ${(feature.stories || []).map((story) => story.name).join('; ')}`
        ))
        : [];

    const rawPreview = String(requirementsText || '').trim();
    const rawExcerpt = rawPreview.length > 4000
        ? `${rawPreview.slice(0, 4000)}...`
        : rawPreview;

    return [
        featureLines.length > 0 ? `STRUCTURE SUMMARY:\n${featureLines.join('\n')}` : null,
        rawExcerpt ? `RAW REQUIREMENTS EXCERPT:\n${rawExcerpt}` : null
    ].filter(Boolean).join('\n\n');
}

function normalizeJudgeIssues(judgeIssues = []) {
    const validationRules = getValidationPromptRules();
    const rulesById = new Map(validationRules.map((rule) => [rule.ruleId, rule]));

    return judgeIssues
        .filter(Boolean)
        .map((issue) => {
            const rule = rulesById.get(issue.ruleId) || validationRules.find((candidate) => candidate.ruleId === issue.ruleId);
            return {
                ruleId: issue.ruleId || rule?.ruleId || 'judge.rule',
                severity: String(issue.severity || rule?.severity || 'warning').toLowerCase(),
                source: 'judge',
                nodePath: String(issue.nodePath || '').trim(),
                nodeId: issue.nodeId || null,
                nodeType: issue.nodeType || null,
                message: String(issue.message || '').trim(),
                evidence: String(issue.evidence || '').trim(),
                suggestedFix: String(issue.suggestedFix || '').trim()
            };
        })
        .filter((issue) => issue.message);
}

function getModelCounts(model) {
    const featureList = Array.isArray(model) ? model : [];
    return featureList.reduce((acc, feature) => {
        acc.features += 1;
        const stories = Array.isArray(feature?.stories) ? feature.stories : [];
        acc.stories += stories.length;
        for (const story of stories) {
            const scenarios = Array.isArray(story?.scenarios) ? story.scenarios : [];
            acc.scenarios += scenarios.length;
            for (const scenario of scenarios) {
                const codes = Array.isArray(scenario?.codes) ? scenario.codes : [];
                acc.codes += codes.length;
            }
        }
        return acc;
    }, { features: 0, stories: 0, scenarios: 0, codes: 0 });
}

function isModelEmpty(model) {
    return getModelCounts(model).features === 0;
}

export function collectStaticTestModelIssues(model, options = {}) {
    const {
        analyzeScenarioActionability,
        reqStructure,
        validateTestModelLegacy,
        detectModelStructureIssues
    } = options;
    const ruleCatalog = resolveRuleCatalog();
    const issues = [];
    const storyScenarioSignatures = new Map();

    const featureList = Array.isArray(model) ? model : [];

    featureList.forEach((feature) => {
        const featurePath = normalizePathPart(feature?.text);
        const featureText = String(feature?.text || '').trim();

        if (SUBJECTIVE_WORDS_REGEX.test(featureText)) {
            issues.push(createIssue({
                rule: ruleCatalog.noSubjectiveWords,
                nodePath: featurePath,
                nodeId: feature?.id || null,
                nodeType: 'feature',
                message: `Feature "${featureText}" содержит оценочную формулировку`,
                evidence: featureText,
                suggestedFix: 'Сделать название нейтральным и однозначным'
            }));
        }

        (feature?.stories || []).forEach((story) => {
            const storyPath = `${featurePath} → ${normalizePathPart(story?.text)}`;
            const storyText = String(story?.text || '').trim();
            const storySignature = normalizeText(storyText);

            if (TECHNICAL_STORY_REGEX.test(storyText)) {
                issues.push(createIssue({
                    rule: ruleCatalog.storySingleMeaning,
                    nodePath: storyPath,
                    nodeId: story?.id || null,
                    nodeType: 'story',
                    message: `Story "${storyText}" выглядит как техническая реализация, а не как пользовательский смысл`,
                    evidence: storyText,
                    suggestedFix: 'Сформулировать Story как пользовательский результат уровня C1'
                }));
            }

            if (SUBJECTIVE_WORDS_REGEX.test(storyText)) {
                issues.push(createIssue({
                    rule: ruleCatalog.noSubjectiveWords,
                    nodePath: storyPath,
                    nodeId: story?.id || null,
                    nodeType: 'story',
                    message: `Story "${storyText}" содержит оценочную формулировку`,
                    evidence: storyText,
                    suggestedFix: 'Убрать слова "корректно", "удобно", "успешно" и подобные'
                }));
            }

            if (CRUD_BUNDLE_REGEX.test(storyText)) {
                issues.push(createIssue({
                    rule: ruleCatalog.crudDomainOnly,
                    nodePath: storyPath,
                    nodeId: story?.id || null,
                    nodeType: 'story',
                    message: `Story "${storyText}" выглядит как механическая CRUD-группировка`,
                    evidence: storyText,
                    suggestedFix: 'Оставить только реальные пользовательские операции, значимые для предметной области'
                }));
            }

            if (looksLikeMultipleChecks(storyText)) {
                issues.push(createIssue({
                    rule: ruleCatalog.noMixedChecks,
                    nodePath: storyPath,
                    nodeId: story?.id || null,
                    nodeType: 'story',
                    message: `Story "${storyText}" смешивает несколько проверок или исходов`,
                    evidence: storyText,
                    suggestedFix: 'Разделить Story по смыслу пользовательского результата'
                }));
            }

            const scenarioSignatures = [];

            (story?.scenarios || []).forEach((scenario) => {
                const scenarioPath = `${storyPath} → ${normalizePathPart(scenario?.text)}`;
                const scenarioText = String(scenario?.text || '').trim();
                const scenarioAnalysis = typeof analyzeScenarioActionability === 'function'
                    ? analyzeScenarioActionability(scenarioText)
                    : { valid: true, reason: null };

                if (!scenarioAnalysis.valid) {
                    issues.push(createIssue({
                        rule: ruleCatalog.scenarioNotTestCase,
                        severity: 'error',
                        nodePath: scenarioPath,
                        nodeId: scenario?.id || null,
                        nodeType: 'scenario',
                        message: `Scenario "${scenarioText}" не является конкретным выполнимым действием пользователя`,
                        evidence: scenarioAnalysis.reason || scenarioText,
                        suggestedFix: 'Сделать Scenario одним атомарным пользовательским действием'
                    }));
                }

                if (STEP_LIKE_REGEX.test(scenarioText)) {
                    issues.push(createIssue({
                        rule: ruleCatalog.detailedSteps,
                        severity: 'error',
                        nodePath: scenarioPath,
                        nodeId: scenario?.id || null,
                        nodeType: 'scenario',
                        message: `Scenario "${scenarioText}" выглядит как пошаговая инструкция`,
                        evidence: scenarioText,
                        suggestedFix: 'Оставить только одну точку пользовательского взаимодействия'
                    }));
                }

                if (looksLikeMultipleChecks(scenarioText)) {
                    issues.push(createIssue({
                        rule: ruleCatalog.scenarioSplitChecks,
                        nodePath: scenarioPath,
                        nodeId: scenario?.id || null,
                        nodeType: 'scenario',
                        message: `Scenario "${scenarioText}" объединяет несколько проверок или исходов`,
                        evidence: scenarioText,
                        suggestedFix: 'Разделить разные проверки на отдельные Scenario'
                    }));
                }

                if (SUBJECTIVE_WORDS_REGEX.test(scenarioText)) {
                    issues.push(createIssue({
                        rule: ruleCatalog.noSubjectiveWords,
                        nodePath: scenarioPath,
                        nodeId: scenario?.id || null,
                        nodeType: 'scenario',
                        message: `Scenario "${scenarioText}" содержит оценочную формулировку`,
                        evidence: scenarioText,
                        suggestedFix: 'Сделать текст нейтральным и проверяемым'
                    }));
                }

                if (PARAMETER_ENUM_REGEX.test(scenarioText)) {
                    issues.push(createIssue({
                        rule: ruleCatalog.parameterSets,
                        severity: 'error',
                        nodePath: scenarioPath,
                        nodeId: scenario?.id || null,
                        nodeType: 'scenario',
                        message: `Scenario "${scenarioText}" содержит параметризацию или перебор данных`,
                        evidence: scenarioText,
                        suggestedFix: 'Вынести конкретные наборы данных в test case, а не в test model'
                    }));
                }

                const codes = Array.isArray(scenario?.codes) ? scenario.codes : [];
                const codeSignatures = [];

                codes.forEach((code) => {
                    const codePath = `${scenarioPath} → ${normalizePathPart(code?.text)}`;
                    const codeText = String(code?.text || '').trim();
                    const normalizedType = normalizeCodeType(codeText, code?.type);

                    if (!TEST_MODEL_CANONICAL_CODE_TYPES.includes(String(code?.type || ''))) {
                        issues.push(createIssue({
                            rule: ruleCatalog.qualityIntegrationNoInstructions,
                            severity: 'error',
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" использует недопустимый type="${code?.type || 'empty'}"`,
                            evidence: String(code?.type || ''),
                            suggestedFix: `Использовать только type="${normalizedType}"`
                        }));
                    }

                    if (FORBIDDEN_TECH_DETAILS_REGEX.test(codeText) || FULL_ERROR_CATALOG_REGEX.test(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.fullHeaders,
                            severity: 'error',
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" содержит запрещенную техническую детализацию`,
                            evidence: codeText,
                            suggestedFix: 'Оставить только метод и путь либо краткий смысл реакции'
                        }));
                    }

                    if (/curl/i.test(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.fullCurl,
                            severity: 'error',
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" содержит полный curl`,
                            evidence: codeText,
                            suggestedFix: 'Оставить только стартовую строку HTTP-взаимодействия'
                        }));
                    }

                    if (JSON_PAYLOAD_REGEX.test(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.detailedExpected,
                            severity: 'error',
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" содержит подробный payload или expected result`,
                            evidence: codeText,
                            suggestedFix: 'Сократить реакцию до краткого смысла без полного payload'
                        }));
                    }

                    if (PARAMETER_ENUM_REGEX.test(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.parameterSets,
                            severity: 'error',
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" содержит перечисление параметров или значений`,
                            evidence: codeText,
                            suggestedFix: 'Убрать детализацию параметров из test model'
                        }));
                    }

                    if (hasForbiddenTechnicalDetail(codeText) && !/\b(GET|POST|PUT|DELETE|PATCH)\b\s+\//i.test(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.allowedStartLine,
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" выходит за допустимый уровень технической детализации`,
                            evidence: codeText,
                            suggestedFix: 'Оставить только стартовую строку либо короткую системную реакцию'
                        }));
                    }

                    if (hasExpandedExpected(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.detailedExpected,
                            severity: 'error',
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" выглядит как expanded expected result`,
                            evidence: codeText,
                            suggestedFix: 'Перенести детальный expected в test case'
                        }));
                    }

                    if (SUBJECTIVE_WORDS_REGEX.test(codeText)) {
                        issues.push(createIssue({
                            rule: ruleCatalog.noSubjectiveWords,
                            nodePath: codePath,
                            nodeId: code?.id || null,
                            nodeType: 'code',
                            message: `Code "${codeText}" содержит оценочную лексику`,
                            evidence: codeText,
                            suggestedFix: 'Сделать формулировку нейтральной'
                        }));
                    }

                    codeSignatures.push(`${normalizeText(codeText)}::${normalizedType}`);
                });

                scenarioSignatures.push(`${normalizeText(scenarioText)}::${codeSignatures.sort().join('|')}`);
            });

            if (scenarioSignatures.length > 0) {
                const storyKey = `${featurePath}::${storySignature}`;
                storyScenarioSignatures.set(storyKey, scenarioSignatures.sort().join(' || '));
            }
        });
    });

    const signatureGroups = new Map();
    for (const [storyKey, signature] of storyScenarioSignatures.entries()) {
        if (!signatureGroups.has(signature)) {
            signatureGroups.set(signature, []);
        }
        signatureGroups.get(signature).push(storyKey);
    }

    for (const [signature, stories] of signatureGroups.entries()) {
        if (stories.length < 2) {
            continue;
        }

        stories.forEach((storyKey) => {
            issues.push(createIssue({
                rule: ruleCatalog.dedupeAcrossStories,
                nodePath: storyKey.replace('::', ' → '),
                nodeId: null,
                nodeType: 'story',
                message: 'Story дублирует ту же проверочную логику, что и другая Story уровня C1',
                evidence: signature,
                suggestedFix: 'Вынести повторяемую логику на уровень C2/C3'
            }));
        });
    }

    if (typeof validateTestModelLegacy === 'function') {
        const legacyReport = validateTestModelLegacy(model, reqStructure);
        for (const error of legacyReport?.errors || []) {
            issues.push(createIssue({
                rule: ruleCatalog.qualityIntegrationNoInstructions,
                severity: 'error',
                source: 'legacy-static',
                message: error,
                evidence: error,
                suggestedFix: 'Исправить структуру модели согласно runtime rules'
            }));
        }
        for (const warning of legacyReport?.warnings || []) {
            issues.push(createIssue({
                rule: ruleCatalog.qualityReadable,
                severity: 'warning',
                source: 'legacy-static',
                message: warning,
                evidence: warning,
                suggestedFix: 'Сократить детализацию или уточнить формулировки'
            }));
        }
    }

    if (typeof detectModelStructureIssues === 'function') {
        const structureIssues = detectModelStructureIssues(model, 'runtime-quality');
        for (const issueText of structureIssues || []) {
            issues.push(createIssue({
                rule: ruleCatalog.qualityIntegrationNoInstructions,
                severity: /code|scenario/i.test(issueText) ? 'error' : 'warning',
                source: 'legacy-static',
                message: issueText,
                evidence: issueText,
                suggestedFix: 'Исправить ветку модели по runtime rules'
            }));
        }
    }

    return {
        staticIssues: dedupeIssues(issues),
        skippedRules: getSkippedRuntimeRules()
    };
}

function buildValidationSummary(staticIssues = [], judgeIssues = [], skippedRules = [], judgeScores = null) {
    const countBySeverity = (items, severity) => items.filter((item) => item.severity === severity).length;
    const totalErrors = countBySeverity(staticIssues, 'error') + countBySeverity(judgeIssues, 'error');
    const totalWarnings = countBySeverity(staticIssues, 'warning') + countBySeverity(judgeIssues, 'warning');

    return {
        errors: totalErrors,
        warnings: totalWarnings,
        staticErrors: countBySeverity(staticIssues, 'error'),
        staticWarnings: countBySeverity(staticIssues, 'warning'),
        judgeErrors: countBySeverity(judgeIssues, 'error'),
        judgeWarnings: countBySeverity(judgeIssues, 'warning'),
        skippedRules: skippedRules.length,
        judgeScores
    };
}

function buildValidationEnvelope(validation = {}) {
    return {
        pipelineVersion: TEST_MODEL_VALIDATION_PIPELINE_VERSION,
        rulesFingerprint: getTestModelRulesFingerprint(),
        executedAt: new Date().toISOString(),
        ...validation
    };
}

export function isRuntimeValidationComplete(validation) {
    if (!validation || typeof validation !== 'object') {
        return false;
    }

    if (typeof validation.passed !== 'boolean') {
        return false;
    }

    if (!Number.isInteger(validation.attemptsUsed) || validation.attemptsUsed < 0) {
        return false;
    }

    if (!Array.isArray(validation.staticIssues) || !Array.isArray(validation.judgeIssues) || !Array.isArray(validation.skippedRules)) {
        return false;
    }

    if (!validation.summary || typeof validation.summary !== 'object') {
        return false;
    }

    if (typeof validation.summary.text !== 'string' || !validation.summary.text.trim()) {
        return false;
    }

    if (typeof validation.executedAt !== 'string' || Number.isNaN(Date.parse(validation.executedAt))) {
        return false;
    }

    if (typeof validation.rulesFingerprint !== 'string' || validation.rulesFingerprint.length < 8) {
        return false;
    }

    if (validation.pipelineVersion !== TEST_MODEL_VALIDATION_PIPELINE_VERSION) {
        return false;
    }

    return true;
}

export function assertRuntimeValidationComplete(validation, context = 'runtime validation') {
    if (!isRuntimeValidationComplete(validation)) {
        throw new Error(`${context} did not produce a complete runtime validation result`);
    }
    return validation;
}

function normalizeJsonValue(value) {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

export function hasPersistedRuntimeValidation(task) {
    if (!task || typeof task !== 'object') {
        return false;
    }

    const result = normalizeJsonValue(task.result);
    const metrics = normalizeJsonValue(task.metrics);
    const validation = result?.validation;

    if (!isRuntimeValidationComplete(validation)) {
        return false;
    }

    if (metrics == null) {
        return true;
    }

    return (
        typeof metrics.validationExecuted === 'boolean' &&
        metrics.validationExecuted === true &&
        typeof metrics.validationPassed === 'boolean' &&
        Number.isInteger(metrics.validationAttempts) &&
        Number.isInteger(metrics.validationErrors) &&
        typeof metrics.validationRulesFingerprint === 'string' &&
        metrics.validationRulesFingerprint === validation.rulesFingerprint
    );
}

async function callWithModelFallback(llmClient, messages, modelsToTry, requestOptions = {}) {
    let lastError = null;
    const models = Array.isArray(modelsToTry) && modelsToTry.length > 0
        ? modelsToTry
        : [];

    for (const model of models) {
        try {
            const response = await llmClient(messages, {
                ...requestOptions,
                model
            });
            return { response, model };
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('No LLM models configured for test model validation');
}

async function runJudge(model, options = {}) {
    const {
        llmClient,
        modelsToTry,
        requirementsText,
        reqStructure
    } = options;
    const rulesPrompt = buildTestModelRulesPrompt({ mode: 'judge' });
    const requirementsSummary = summarizeRequirements(reqStructure, requirementsText);

    const messages = [
        {
            role: 'system',
            content: [
                'Ты — LLM-as-a-judge для test model.',
                'Проверяй модель только по runtime rules и возвращай только JSON.',
                'Не исправляй модель и не переписывай JSON test model.',
                'РќРёРєРѕРіРґР° РЅРµ РІРѕР·РІСЂР°С‰Р°Р№ РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ Рё РЅРµ СѓРґР°Р»СЏР№ РІСЃСЋ РјРѕРґРµР»СЊ РґР»СЏ РёСЃРїСЂР°РІР»РµРЅРёСЏ. Р•СЃР»Рё РїСЂР°РІРєР° СЃРѕРјРЅРёС‚РµР»СЊРЅР°, СЃРѕС…СЂР°РЅРё РёСЃС…РѕРґРЅСѓСЋ РІРµС‚РєСѓ Рё СЃРґРµР»Р°Р№ РјРёРЅРёРјР°Р»СЊРЅРѕРµ РёР·РјРµРЅРµРЅРёРµ.',
                'Do not return an empty model and do not remove existing Feature/Story/Scenario nodes unless the issue explicitly requires a targeted split or rename.',
                rulesPrompt
            ].join('\n\n')
        },
        {
            role: 'user',
            content: `
ОЦЕНИ ТЕСТОВУЮ МОДЕЛЬ И ВЕРНИ JSON ОБЪЕКТ:
{
  "passed": boolean,
  "summary": "краткий итог",
  "issues": [
    {
      "ruleId": "tmr_xxx",
      "severity": "error|warning",
      "nodePath": "Feature → Story → Scenario → Code",
      "nodeId": "optional",
      "nodeType": "feature|story|scenario|code",
      "message": "что нарушено",
      "evidence": "цитата или краткое доказательство",
      "suggestedFix": "что исправить"
    }
  ],
  "scores": {
    "structure": 0,
    "readability": 0,
    "atomicity": 0,
    "detailLevel": 0
  }
}

Не добавляй правила export_only и не проверяй XMind/TMS sync.

Do not delete the whole model and do not return an empty array. If only part of the issues can be fixed, preserve unaffected nodes and return the fullest valid JSON you can.

${requirementsSummary ? `${requirementsSummary}\n\n` : ''}CURATED EXEMPLAR:
\`\`\`json
${getCuratedTestModelExemplarJson()}
\`\`\`

MODEL TO JUDGE:
\`\`\`json
${JSON.stringify(model, null, 2)}
\`\`\`
`.trim()
        }
    ];

    const { response, model: usedModel } = await callWithModelFallback(llmClient, messages, modelsToTry, {
        temperature: 0,
        max_tokens: 12000
    });

    const parsed = parseJudgeResultContent(response?.choices?.[0]?.message?.content || '');
    return {
        ...parsed,
        usedModel
    };
}

async function runRepair(model, combinedIssues = [], options = {}) {
    const {
        llmClient,
        modelsToTry,
        requirementsText,
        reqStructure
    } = options;
    const rulesPrompt = buildTestModelRulesPrompt({ mode: 'repair' });
    const requirementsSummary = summarizeRequirements(reqStructure, requirementsText);
    const issuesText = JSON.stringify(combinedIssues, null, 2);

    const messages = [
        {
            role: 'system',
            content: [
                'Ты — JSON patcher для test model.',
                'Исправляй только указанные нарушения и сохраняй существующие ID, если элемент не разделяется.',
                'Нельзя добавлять выдуманные детали, XMind/TMS-структуру и export-only сущности.',
                rulesPrompt
            ].join('\n\n')
        },
        {
            role: 'user',
            content: `
ИСПРАВЬ МОДЕЛЬ ПО СПИСКУ ISSUES.
Верни только полный JSON-массив Feature → Story → Scenario → Code.
Если код type не canonical, нормализуй его к frontend/backend.

${requirementsSummary ? `${requirementsSummary}\n\n` : ''}CURATED EXEMPLAR:
\`\`\`json
${getCuratedTestModelExemplarJson()}
\`\`\`

ISSUES:
\`\`\`json
${issuesText}
\`\`\`

CURRENT MODEL:
\`\`\`json
${JSON.stringify(model, null, 2)}
\`\`\`
`.trim()
        }
    ];

    const { response, model: usedModel } = await callWithModelFallback(llmClient, messages, modelsToTry, {
        temperature: 0.1,
        max_tokens: 24000
    });

    return {
        model: parseRepairResultContent(response?.choices?.[0]?.message?.content || ''),
        usedModel
    };
}

function getBlockingIssues(staticIssues = [], judgeIssues = []) {
    return [...staticIssues, ...judgeIssues].filter((issue) => issue.severity === 'error');
}

export async function runTestModelValidationPipeline(options = {}) {
    const {
        model,
        llmClient,
        modelsToTry,
        requirementsText = '',
        reqStructure = null,
        analyzeScenarioActionability,
        validateTestModelLegacy,
        detectModelStructureIssues,
        prepareModel = (value) => value,
        maxAttempts = 3
    } = options;

    let currentModel = prepareModel(model);
    let attemptsUsed = 0;
    let finalStaticIssues = [];
    let finalJudgeIssues = [];
    let judgeScores = null;
    let judgeModel = null;
    let judgeSummary = '';

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        const staticResult = collectStaticTestModelIssues(currentModel, {
            analyzeScenarioActionability,
            reqStructure,
            validateTestModelLegacy,
            detectModelStructureIssues
        });
        finalStaticIssues = staticResult.staticIssues;

        try {
            const judgeResult = await runJudge(currentModel, {
                llmClient,
                modelsToTry,
                requirementsText,
                reqStructure
            });

            finalJudgeIssues = dedupeIssues(normalizeJudgeIssues(judgeResult.issues));
            judgeScores = judgeResult.scores;
            judgeModel = judgeResult.usedModel;
            judgeSummary = judgeResult.summary || '';
        } catch (error) {
            finalJudgeIssues = [
                createIssue({
                    rule: getValidationPromptRules()[0] || loadTestModelRuntimeRules()[0],
                    severity: 'error',
                    source: 'judge',
                    message: `LLM judge не выполнился: ${error.message}`,
                    evidence: error.stack || error.message,
                    suggestedFix: 'Проверить доступность cloud.ru judge и повторить валидацию'
                })
            ];
            judgeScores = null;
            judgeSummary = 'LLM judge failed';
        }

        const blockingIssues = getBlockingIssues(finalStaticIssues, finalJudgeIssues);
        if (blockingIssues.length === 0) {
            const skippedRules = getSkippedRuntimeRules();
            return {
                model: currentModel,
                validation: buildValidationEnvelope({
                    passed: true,
                    attemptsUsed,
                    judgeModel,
                    staticIssues: finalStaticIssues,
                    judgeIssues: finalJudgeIssues,
                    skippedRules,
                    summary: {
                        ...buildValidationSummary(finalStaticIssues, finalJudgeIssues, skippedRules, judgeScores),
                        text: judgeSummary || 'Модель прошла runtime validation'
                    }
                })
            };
        }

        if (attempt === maxAttempts) {
            break;
        }

        try {
            const repairResult = await runRepair(currentModel, blockingIssues, {
                llmClient,
                modelsToTry,
                requirementsText,
                reqStructure
            });
            const repairedCandidate = prepareModel(repairResult.model);
            attemptsUsed += 1;

            if (!isModelEmpty(currentModel) && isModelEmpty(repairedCandidate)) {
                finalJudgeIssues = dedupeIssues([
                    ...finalJudgeIssues,
                    createIssue({
                        rule: getValidationPromptRules()[0] || loadTestModelRuntimeRules()[0],
                        severity: 'error',
                        source: 'judge',
                        message: 'LLM repair returned an empty test model; previous non-empty model was preserved',
                        evidence: JSON.stringify({
                            before: getModelCounts(currentModel),
                            after: getModelCounts(repairedCandidate)
                        }),
                        suggestedFix: 'Уточнить repair prompt или исправить модель вручную без удаления всей структуры'
                    })
                ]);
                break;
            }

            currentModel = repairedCandidate;
        } catch (error) {
            finalJudgeIssues = dedupeIssues([
                ...finalJudgeIssues,
                createIssue({
                    rule: getValidationPromptRules()[0] || loadTestModelRuntimeRules()[0],
                    severity: 'error',
                    source: 'judge',
                    message: `LLM repair не выполнился: ${error.message}`,
                    evidence: error.stack || error.message,
                    suggestedFix: 'Проверить Cloud.ru repair pass или исправить модель вручную'
                })
            ]);
            break;
        }
    }

    const skippedRules = getSkippedRuntimeRules();
    return {
        model: currentModel,
        validation: buildValidationEnvelope({
            passed: false,
            attemptsUsed,
            judgeModel,
            staticIssues: finalStaticIssues,
            judgeIssues: finalJudgeIssues,
            skippedRules,
            summary: {
                ...buildValidationSummary(finalStaticIssues, finalJudgeIssues, skippedRules, judgeScores),
                text: judgeSummary || 'Модель не прошла runtime validation'
            }
        })
    };
}

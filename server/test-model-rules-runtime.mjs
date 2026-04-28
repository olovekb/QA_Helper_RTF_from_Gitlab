import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RULES_FILE_PATH = join(__dirname, 'config', 'test-model-validation-rules.md');
const EXAMPLE_FILE_PATH = join(__dirname, 'config', 'examples', 'test-model-example.json');

export const TEST_MODEL_JUDGE_PRIMARY_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507';
export const TEST_MODEL_JUDGE_FALLBACK_MODELS = [
    'Qwen/Qwen3-Next-80B-A3B-Instruct',
    'MiniMaxAI/MiniMax-M2'
];
export const TEST_MODEL_CANONICAL_CODE_TYPES = ['frontend', 'backend'];

let cachedRules = null;
let cachedRulesMarkdown = null;
let cachedCuratedExemplar = null;
let cachedCuratedExemplarJson = null;
let cachedRulesFingerprint = null;

function normalizeWhitespace(text = '') {
    return String(text || '')
        .replace(/\\\[(ERROR|WARNING)\\\]/gi, '[$1]')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripSeverityMarker(text = '') {
    return normalizeWhitespace(
        String(text || '').replace(/\s*(?:\\)?\[(ERROR|WARNING)(?:\\)?\]\s*$/i, '')
    );
}

function hashRuleId(seed) {
    return `tmr_${createHash('sha1').update(String(seed || '')).digest('hex').slice(0, 12)}`;
}

function isSeverityCarrierLine(line = '') {
    return /^(запрещено|допустимо)\s+(?:\\)?\[(error|warning)(?:\\)?\]/i.test(line);
}

function classifyApplicability(text = '') {
    const normalized = String(text || '').toLowerCase();

    if (
        /(xmind|тестопс|tms|после экспорта|последующую синхронизацию|ручные отклонения структуры|кастомн\w+\s+флаг)/i.test(normalized)
    ) {
        return 'export_only';
    }

    if (
        /(расширенн\w+\s+структур|на уровне проекта|схеме проекта и согласована|описано на странице проекта|фиксируется как проектное правило)/i.test(normalized)
    ) {
        return 'not_applicable_at_generation';
    }

    return 'generation';
}

function isStaticRule(text = '') {
    return [
        /не превращается в тест-кейс/i,
        /детальные шаги/i,
        /наборы параметров/i,
        /подробные ожидаемые результаты/i,
        /полный curl/i,
        /заголовки, токены, тело запроса/i,
        /полный перечень всех вариантов ошибок/i,
        /стартовая строка как идентификатор/i,
        /названия узлов должны быть однозначными/i,
        /смесь нескольких разных проверок/i,
        /если одно название требует разных итогов/i,
        /если внутри одной точки фактически разные проверки/i,
        /интеграционные точки уровня c2 c3 отражают смысл проверок, но не превращены в пошаговые инструкции/i,
        /модель читается однозначно без знания автора/i
    ].some((pattern) => pattern.test(text));
}

function classifyRule(text = '') {
    const applicability = classifyApplicability(text);
    const validators = applicability === 'generation'
        ? (isStaticRule(text) ? ['static', 'judge'] : ['judge'])
        : [];

    return {
        applicability,
        validators
    };
}

export function parseTestModelValidationRules(markdown = '') {
    const lines = String(markdown || '').split(/\r?\n/);
    const headings = [];
    let inheritedSeverity = null;
    const rules = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
            continue;
        }

        const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const title = normalizeWhitespace(headingMatch[2]);
            const headingIndex = Math.max(0, level - 2);
            headings.length = headingIndex;
            headings[headingIndex] = title;
            inheritedSeverity = null;
            continue;
        }

        if (isSeverityCarrierLine(line)) {
            inheritedSeverity = /(?:\\)?\[ERROR(?:\\)?\]/i.test(line) ? 'error' : 'warning';
            continue;
        }

        const bulletMatch = line.match(/^-\s+(.+)$/);
        const explicitSeverityMatch = line.match(/(?:\\)?\[(ERROR|WARNING)(?:\\)?\]\s*$/i);
        const severity = explicitSeverityMatch
            ? explicitSeverityMatch[1].toLowerCase()
            : bulletMatch && inheritedSeverity
                ? inheritedSeverity
                : null;

        if (!severity) {
            continue;
        }

        const rawText = bulletMatch ? bulletMatch[1] : line;
        const text = stripSeverityMarker(rawText);
        if (!text) {
            continue;
        }

        const definitionPath = headings.filter(Boolean);
        const ruleIdSeed = `${definitionPath.join(' > ')} | ${text}`;
        const classification = classifyRule(text);

        rules.push({
            ruleId: hashRuleId(ruleIdSeed),
            text,
            severity,
            headings: definitionPath,
            applicability: classification.applicability,
            validators: classification.validators
        });
    }

    return rules.filter((rule, index, arr) => (
        arr.findIndex((candidate) => candidate.ruleId === rule.ruleId) === index
    ));
}

export function loadTestModelRulesMarkdown() {
    if (!cachedRulesMarkdown) {
        cachedRulesMarkdown = readFileSync(RULES_FILE_PATH, 'utf8');
    }
    return cachedRulesMarkdown;
}

export function getTestModelRulesFingerprint() {
    if (!cachedRulesFingerprint) {
        cachedRulesFingerprint = createHash('sha1')
            .update(loadTestModelRulesMarkdown())
            .digest('hex')
            .slice(0, 16);
    }
    return cachedRulesFingerprint;
}

export function loadTestModelRuntimeRules() {
    if (!cachedRules) {
        cachedRules = parseTestModelValidationRules(loadTestModelRulesMarkdown());
    }
    return cachedRules;
}

function normalizeExampleCodeType(text = '', currentType = '') {
    if (TEST_MODEL_CANONICAL_CODE_TYPES.includes(currentType)) {
        return currentType;
    }

    const normalized = String(text || '').toLowerCase();
    if (
        /^(возвращается|сохраняется|создается|обновляется|удаляется|отправляется push|отправляется sms|отправляется email)/i.test(normalized) ||
        /(бд|db|уведомлени|лог\b|event\b)/i.test(normalized)
    ) {
        return 'backend';
    }

    return 'frontend';
}

function sanitizeExampleCodeText(text = '') {
    const value = normalizeWhitespace(text);
    const methodPathMatch = value.match(/\b(GET|POST|PUT|DELETE|PATCH)\b\s+([^\s*]+|\*\*[^*]+\*\*)/i);
    const methodPath = methodPathMatch
        ? `${methodPathMatch[1].toUpperCase()} ${String(methodPathMatch[2]).replace(/\*\*/g, '')}`
        : null;

    if (/^отправляется/i.test(value) && methodPath) {
        return `Отправляется ${methodPath}`;
    }

    if (/^возвращается/i.test(value) && methodPath) {
        if (/ошиб/i.test(value)) {
            return `Возвращается ошибка для ${methodPath}`;
        }
        return `Возвращается успешный ответ для ${methodPath}`;
    }

    if (/^отправляется push/i.test(value)) {
        return 'Отправляется push-уведомление';
    }

    return value
        .replace(/\s+с\s+параметр[^.]+/i, '')
        .replace(/\s+с\s+\{[^}]+\}/g, '')
        .replace(/\s+\{[^}]+\}/g, '')
        .trim();
}

function buildCuratedTestModelExemplarObject() {
    if (cachedCuratedExemplar) {
        return cachedCuratedExemplar;
    }

    const parsed = JSON.parse(readFileSync(EXAMPLE_FILE_PATH, 'utf8'));
    const exemplar = (Array.isArray(parsed) ? parsed : [])
        .slice(0, 1)
        .map((feature) => ({
            ...feature,
            stories: (feature.stories || []).slice(0, 1).map((story) => ({
                ...story,
                scenarios: (story.scenarios || []).slice(0, 4).map((scenario) => ({
                    ...scenario,
                    codes: (scenario.codes || []).slice(0, 3).map((code) => ({
                        ...code,
                        text: sanitizeExampleCodeText(code.text),
                        type: normalizeExampleCodeType(code.text, code.type)
                    }))
                }))
            }))
        }));

    cachedCuratedExemplar = exemplar;
    return exemplar;
}

export function getCuratedTestModelExemplar() {
    return buildCuratedTestModelExemplarObject();
}

export function getCuratedTestModelExemplarJson() {
    if (!cachedCuratedExemplarJson) {
        cachedCuratedExemplarJson = JSON.stringify(getCuratedTestModelExemplar(), null, 2);
    }
    return cachedCuratedExemplarJson;
}

function formatRuleHeading(rule) {
    return rule.headings?.length ? rule.headings.join(' → ') : 'Правило';
}

export function getGenerationPromptRules() {
    return loadTestModelRuntimeRules().filter((rule) => rule.applicability === 'generation');
}

export function getValidationPromptRules() {
    return loadTestModelRuntimeRules().filter(
        (rule) => rule.applicability === 'generation' && rule.validators.includes('judge')
    );
}

export function getSkippedRuntimeRules() {
    return loadTestModelRuntimeRules()
        .filter((rule) => rule.applicability !== 'generation')
        .map((rule) => ({
            ruleId: rule.ruleId,
            text: rule.text,
            severity: rule.severity,
            applicability: rule.applicability,
            reason: rule.applicability === 'export_only'
                ? 'Правило относится к XMind/TMS/export stage и не применяется при исходной генерации test model'
                : 'Правило требует проектного или организационного контекста вне runtime generation'
        }));
}

export function buildTestModelRulesPrompt({ mode = 'generation' } = {}) {
    const rules = mode === 'judge'
        ? getValidationPromptRules()
        : getGenerationPromptRules();

    const heading = mode === 'repair'
        ? 'RUNTIME RULES ДЛЯ ИСПРАВЛЕНИЯ TEST MODEL'
        : mode === 'judge'
            ? 'RUNTIME RULES ДЛЯ ПРОВЕРКИ TEST MODEL'
            : 'RUNTIME RULES ДЛЯ ГЕНЕРАЦИИ TEST MODEL';

    const formattedRules = rules
        .map((rule) => `- [${rule.severity.toUpperCase()}][${rule.ruleId}] ${rule.text} (${formatRuleHeading(rule)})`)
        .join('\n');

    return `
${heading}
Source of truth: server/config/test-model-validation-rules.md
Если любые старые примеры или общие инструкции ниже противоречат этому блоку, приоритет всегда у этого блока.

${formattedRules}
`.trim();
}

export function getRecommendedJudgeModelSequence(availableModels = []) {
    const available = Array.isArray(availableModels) ? availableModels.filter(Boolean) : [];
    const preferred = [
        TEST_MODEL_JUDGE_PRIMARY_MODEL,
        ...TEST_MODEL_JUDGE_FALLBACK_MODELS
    ];

    const picked = preferred.filter((model) => available.includes(model));
    const tail = available.filter((model) => !picked.includes(model));
    return picked.length > 0 ? [...picked, ...tail] : preferred;
}

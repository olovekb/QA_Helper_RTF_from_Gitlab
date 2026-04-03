import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.json' assert { type: 'json' };
import { repairJsonCommonErrors, createDeveloperContent, loadTestModelExamples, callOpenRouterForAnalyze } from './ai-testcase.mjs';
import { buildTestModelRulesPrompt } from './test-model-rules.mjs';

function appendOptionalModelAntiexamples (systemContent)
{
    const examples = loadTestModelExamples();
    const block = createDeveloperContent(examples);
    if (!block) return systemContent;
    return `${systemContent}\n\n# АНТИПРИМЕРЫ (тестовая модель)\n${block}\n`;
}

function formatPreviousModelIssuesBlock (issues)
{
    if (!Array.isArray(issues) || issues.length === 0) return 'нет';
    return issues.map((iss, idx) =>
    {
        const meta = [];
        if (iss.ruleId) meta.push(`ruleId: ${iss.ruleId}`);
        if (iss.nodeName && iss.nodeName !== 'Общее') meta.push(`узел: ${iss.nodeName}`);
        const suffix = meta.length ? ` (${meta.join(', ')})` : '';
        return `${idx + 1}. **${iss.title || 'Замечание'}**${suffix}: ${iss.message}`;
    }).join('\n');
}

const AI_LOGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ai-logs');
const MAX_RESPONSE_LENGTH = 100000;

const MODEL_ISSUE_CATEGORIES = [
    'structure',
    'scope_boundaries',
    'naming',
    'decomposition',
    'duplication',
    'export_sync',
    'flags',
    'quality',
    'other'
];

const RECOMMENDATION_RESPONSE_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            title: { type: 'string' },
            recommendation: { type: 'string' },
            severity: { type: 'string', enum: ['error', 'warning'] },
            category: { type: 'string', enum: MODEL_ISSUE_CATEGORIES },
            ruleId: { type: 'string', description: 'id правила из конфига' },
            nodeName: { type: 'string', description: 'Имя узла из модели' }
        },
        required: ['title', 'recommendation', 'severity', 'category', 'ruleId', 'nodeName'],
        additionalProperties: false
    }
};

function ensureAILogsDir ()
{
    if (!fs.existsSync(AI_LOGS_DIR)) {
        fs.mkdirSync(AI_LOGS_DIR, { recursive: true });
    }
}

function extractJSON (responseText)
{
    const markdownMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch) return markdownMatch[1];
    const jsonMatch = responseText.match(/(\[[\s\S]*\])/);
    if (jsonMatch) return jsonMatch[1];
    return responseText;
}

const ALLOWED_MODEL_CATEGORIES = new Set(MODEL_ISSUE_CATEGORIES);

function normalizeModelRecommendations (items)
{
    if (!Array.isArray(items)) return [];
    return items.map((item) =>
    {
        const category = ALLOWED_MODEL_CATEGORIES.has(item?.category) ? item.category : 'other';
        return {
            title: item?.title || 'Замечание',
            recommendation: item?.recommendation || '',
            severity: item?.severity === 'error' ? 'error' : 'warning',
            category,
            ruleId: item?.ruleId != null ? String(item.ruleId) : '',
            nodeName: item?.nodeName ? String(item.nodeName) : 'Общее'
        };
    });
}

export async function analyzeTestModelWithAI (modelData, apiKey = null, projectId = null)
{
    try {
        const rulesBlock = buildTestModelRulesPrompt(projectId);

        const systemContent = `Проведи ревью тестовой модели по правилам ниже.
Тестовая модель передана в формате JSON (иерархия блоков/фич/стори/сценариев/кода и вложенные узлы — см. данные).

${rulesBlock}

# КАК ОТВЕЧАТЬ:
- Для каждого реального нарушения правил добавь один элемент массива.
- severity: "error" или "warning" в соответствии с ожидаемой серьёзностью у пункта правил; при сомнении — warning.
- category: одна из схемы (structure, scope_boundaries, naming, decomposition, duplication, export_sync, flags, quality, other).
- ruleId: id правила из текста выше (например tm_scenario_boundary); если нет подходящего — "".
- nodeName: точное имя узла из JSON; если ко всей модели — "Общее".
- Не дублируй одно и то же замечание. Не придумывай проблемы без опоры на JSON.

# ВЕРНИ СТРОГО JSON-МАССИВ (title, recommendation, severity, category, ruleId, nodeName).

Пример:
[
  { "title": "Scenario оформлен как пошаговый ТК", "recommendation": "Сократи узел до смысла точки покрытия...", "severity": "error", "category": "scope_boundaries", "ruleId": "tm_scenario_boundary", "nodeName": "Оплата картой" }
]`;

        const systemContentFull = appendOptionalModelAntiexamples(systemContent);

        const userContent = `Тестовая модель (JSON):
${JSON.stringify(modelData, null, 2)}`;

        ensureAILogsDir();
        const promptFile = path.join(AI_LOGS_DIR, `ai-prompt-model-last.txt`);
        fs.writeFileSync(promptFile, `${new Date().toISOString()}\n\n=== SYSTEM ===\n${systemContentFull}\n\n=== USER ===\n${userContent}`, 'utf8');

        const API_TOKEN = config.openRouterAiKey;
        if (!API_TOKEN) throw new Error('Не найден OPENROUTER_API_KEY. Проверьте ваш .env файл.');

        const messages = [
            { role: 'system', content: systemContentFull },
            { role: 'user', content: userContent }
        ];

        const response_format = {
            type: 'json_schema',
            json_schema: {
                name: 'model_recommendations',
                description: 'Рекомендации по тестовой модели',
                strict: true,
                schema: RECOMMENDATION_RESPONSE_SCHEMA
            }
        };

        const data = await callOpenRouterForAnalyze(messages, apiKey || API_TOKEN, {
            max_tokens: 16000,
            temperature: 0.1,
            response_format
        });

        let responseText = '';
        if (data.choices?.[0]?.message?.content) {
            responseText = data.choices[0].message.content.trim();
        } else if (data.text) {
            responseText = data.text.trim();
        }

        if (!responseText) throw new Error('Ответ от модели пустой');

        const responseFile = path.join(AI_LOGS_DIR, `ai-response-model-last.txt`);
        fs.writeFileSync(responseFile, `${new Date().toISOString()}\n\n${responseText}`, 'utf8');

        try {
            const jsonText = extractJSON(responseText);
            let parsed = [];
            try {
                parsed = JSON.parse(jsonText);
            } catch (e) {
                parsed = JSON.parse(repairJsonCommonErrors(jsonText) || jsonText);
            }
            if (!Array.isArray(parsed)) {
                if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
                    parsed = parsed.recommendations;
                } else {
                    parsed = [parsed];
                }
            }
            return normalizeModelRecommendations(parsed);
        } catch (e) {
            console.error('[AI-model-analyze] Ошибка парсинга ответа ИИ для тестовой модели', e);
            return normalizeModelRecommendations([{
                title: 'Ошибка парсинга AI',
                recommendation: 'Не удалось распарсить ответ',
                severity: 'error',
                category: 'other',
                ruleId: '',
                nodeName: 'Общее'
            }]);
        }
    } catch (error) {
        console.error('[AI-model-analyze] Ошибка в analyzeTestModelWithAI:', error);
        throw error;
    }
}

/**
 * Повторное ревью тестовой модели: проверка списка замечаний с предыдыщего прогона
 */
export async function analyzeTestModelRecheckWithAI (modelData, previousIssues, apiKey = null, projectId = null, jiraIssue = null)
{
    if (!Array.isArray(previousIssues) || previousIssues.length === 0) {
        return analyzeTestModelWithAI(modelData, apiKey, projectId);
    }

    try {
        const issuesBlock = formatPreviousModelIssuesBlock(previousIssues);

        const systemContent = `Тебе передали обновленную тестовую модель (JSON) и список замечаний с предыдущего ревью.

# ЗАДАЧА
Для каждого пункта из блока «Ранее выданные замечания» определи: исправлено / не исправлено / частично исправлено.
- Исправлено полностью — не включай этот пункт в ответ.
- Не исправлено или частично — добавь один элемент массива с тем же title (как в списке) и уточненной recommendation по текущему JSON модели.
- Сохраняй severity и category в духе исходного замечания; ruleId и nodeName укажи заново по фактическому JSON (если не применимо — ruleId: "", nodeName: "Общее").

Работай ТОЛЬКО с замечаниями из списка. Не проводи полное ревью и не добавляй новые проблемы, которых не было в списке.

# ФОРМАТ ОТВЕТА
Строгий JSON-массив объектов с полями title, recommendation, severity, category, ruleId, nodeName.
Если все пункты из списка сняты — верни пустой массив [].`;

        const systemContentFull = appendOptionalModelAntiexamples(systemContent);

        const userContent = `### Текущая тестовая модель
${JSON.stringify(modelData, null, 2)}

### Ранее выданные замечания
${issuesBlock}`;

        ensureAILogsDir();
        const jiraPrefix = jiraIssue ? `${jiraIssue}-` : '';
        const promptFile = path.join(AI_LOGS_DIR, `ai-prompt-model-recheck-${jiraPrefix}last.txt`);
        fs.writeFileSync(promptFile, `${new Date().toISOString()}\n\n=== SYSTEM ===\n${systemContentFull}\n\n=== USER ===\n${userContent}`, 'utf8');

        const API_TOKEN = config.openRouterAiKey;
        if (!API_TOKEN) throw new Error('Не найден OPENROUTER_API_KEY. Проверьте ваш .env файл.');

        const messages = [
            { role: 'system', content: systemContentFull },
            { role: 'user', content: userContent }
        ];

        const response_format = {
            type: 'json_schema',
            json_schema: {
                name: 'model_recheck_recommendations',
                description: 'Проверка исправлений замечаний по тестовой модели',
                strict: true,
                schema: RECOMMENDATION_RESPONSE_SCHEMA
            }
        };

        const data = await callOpenRouterForAnalyze(messages, apiKey || API_TOKEN, {
            max_tokens: 16000,
            temperature: 0.15,
            response_format
        });

        let responseText = '';
        if (data.choices?.[0]?.message?.content) {
            responseText = data.choices[0].message.content.trim();
        } else if (data.text) {
            responseText = data.text.trim();
        }

        if (!responseText) throw new Error('Ответ от модели пустой');

        if (responseText.length > MAX_RESPONSE_LENGTH) {
            console.warn(`[AI-model-recheck] Ответ обрезан до ${MAX_RESPONSE_LENGTH} симв.`);
            responseText = responseText.slice(0, MAX_RESPONSE_LENGTH);
        }

        const responseFile = path.join(AI_LOGS_DIR, `ai-response-model-recheck-${jiraPrefix}last.txt`);
        fs.writeFileSync(responseFile, `${new Date().toISOString()}\n\n${responseText}`, 'utf8');

        const jsonText = extractJSON(responseText);
        let parsed = [];
        try {
            parsed = JSON.parse(jsonText);
        } catch (e) {
            parsed = JSON.parse(repairJsonCommonErrors(jsonText) || jsonText);
        }
        if (!Array.isArray(parsed)) {
            if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
                parsed = parsed.recommendations;
            } else {
                parsed = [parsed];
            }
        }
        return normalizeModelRecommendations(parsed);
    } catch (error) {
        console.error('[AI-model-recheck] Ошибка в analyzeTestModelRecheckWithAI:', error);
        throw error;
    }
}

import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, 'config', 'test-model-analysis-rules.yaml');
const PROJECTS_DIR = join(__dirname, 'config', 'projects');

/**
 * Все базовые правила из YAML (для документации / .md), без мержа с проектом.
 */
export function getBaseTestModelRulesRaw ()
{
    const doc = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));
    return (doc.base_model_rules || []).map(r => ({ ...r }));
}

/**
 * Правила для промпта AI: базовые из test-model-analysis-rules.yaml + model_rules["<projectId>"] из projects/*.yaml
 */
export function getTestModelAIRules (projectId)
{
    const doc = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));
    const base = doc.base_model_rules || [];
    const map = new Map();
    for (const r of base) {
        if (r?.id) map.set(r.id, { ...r });
    }

    const projectIdStr = projectId != null && projectId !== '' ? String(projectId) : '';
    if (!projectIdStr) {
        return Array.from(map.values()).filter(
            r => r.enabled !== false &&
                r.is_ai_enabled === true &&
                String(r.ai_prompt || '').trim()
        );
    }

    try {
        const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of files) {
            const cfg = yaml.load(readFileSync(join(PROJECTS_DIR, file), 'utf8'));
            const extra = cfg.model_rules?.[projectIdStr];
            if (!Array.isArray(extra)) continue;
            for (const r of extra) {
                if (!r?.id) continue;
                const prev = map.get(r.id) || {};
                map.set(r.id, { ...prev, ...r });
            }
        }
    } catch (err) {
        console.warn(`[getTestModelAIRules] ${err.message}`);
    }

    return Array.from(map.values()).filter(
        r => r.enabled !== false &&
            r.is_ai_enabled === true &&
            String(r.ai_prompt || '').trim()
    );
}

function toModelRuleDoc (rule)
{
    return {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        level: rule.level,
        category: rule.category,
        enabled: rule.enabled !== false
    };
}

export function getProjectModelRulesDocumentation (projectId)
{
    const projectIdStr = projectId != null && projectId !== '' ? String(projectId) : '';
    if (!projectIdStr) return [];

    const map = new Map();
    try {
        const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of files) {
            const cfg = yaml.load(readFileSync(join(PROJECTS_DIR, file), 'utf8'));
            const extra = cfg.model_rules?.[projectIdStr];
            if (!Array.isArray(extra)) continue;
            for (const r of extra) {
                if (!r?.id) continue;
                const prev = map.get(r.id) || {};
                map.set(r.id, { ...prev, ...r });
            }
        }
    } catch (err) {
        console.warn(`[getProjectModelRulesDocumentation] ${err.message}`);
    }

    return Array.from(map.values()).map(toModelRuleDoc);
}

/**
 * Название правила по id для HTML-отчета
 */
export function getTestModelRuleDisplayName (ruleId, projectId = null)
{
    const id = ruleId != null ? String(ruleId).trim() : '';
    if (!id) return '';
    try {
        const rules = getTestModelAIRules(projectId);
        const hit = rules.find(r => r.id === id);
        if (hit?.name) return String(hit.name).trim();
    } catch (err) {
        console.warn(`[getTestModelRuleDisplayName] ${err.message}`);
    }
    try {
        const base = getBaseTestModelRulesRaw();
        const b = base.find(r => r.id === id);
        if (b?.name) return String(b.name).trim();
    } catch (err) {
        console.warn(`[getTestModelRuleDisplayName] base ${err.message}`);
    }
    return id;
}

/**
 * Текст стайлгайда тестовой модели для system/user промпта
 */
export function buildTestModelRulesPrompt (projectId)
{
    const rules = getTestModelAIRules(projectId);
    if (rules.length === 0) {
        return '# ПРАВИЛА ТЕСТОВОЙ МОДЕЛИ: правила не загружены';
    }
    let out = '# ПРАВИЛА АНАЛИЗА ТЕСТОВОЙ МОДЕЛИ\nПроверь JSON модели по каждому пункту. Если пункт неприменим к данной модели — не придумывай нарушений.\n';
    rules.forEach((r, i) =>
    {
        const level = r.level === 'error' ? 'error' : 'warning';
        const head = `${i + 1}. [${r.id}] ${r.name || r.id} — ожидаемая серьёзность при явном нарушении: ${level}`;
        out += `\n${head}\n${String(r.ai_prompt).trim()}\n`;
    });
    return out;
}

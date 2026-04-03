import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Нужно ли пересобирать markdown: нет файла или исходники новее
 * @param {string} outputPath — путь к генерируемому .md
 * @param {string[]} yamlPaths — пути к YAML-конфигам
 * @param {string} projectsDir — папка с файлами проектов (*.yaml / *.yml)
 */
export function shouldRegenerateMarkdown (outputPath, yamlPaths, projectsDir, logPrefix = '[shouldRegenerateMarkdown]')
{
    if (!existsSync(outputPath)) return true;
    try {
        const outputMtime = statSync(outputPath).mtimeMs;
        for (const p of yamlPaths) {
            if (existsSync(p) && statSync(p).mtimeMs > outputMtime) return true;
        }
        if (existsSync(projectsDir)) {
            const files = readdirSync(projectsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            for (const file of files) {
                if (statSync(join(projectsDir, file)).mtimeMs > outputMtime) return true;
            }
        }
        return false;
    } catch (err) {
        console.warn(`${logPrefix} ${err.message}`);
        return true;
    }
}

/**
 * Markdown-блок по списку правил
 * @param {Array<{ id?: string, name: string, level?: string, description?: string, category?: string, enabled?: boolean }>} rules
 * @param {object} options
 * @param {Record<string, string>} options.categoryNames
 * @param {string} [options.heading='###']
 * @param {Map<string, { name: string }>|null} [options.baseRulesMap=null]
 * @param {boolean} [options.markOverrides=false] — помечать правила, id которых есть в baseRulesMap
 */
export function buildRulesSectionMarkdown (rules, {
    heading = '###',
    categoryNames,
    baseRulesMap = null,
    markOverrides = false
} = {})
{
    if (!categoryNames || typeof categoryNames !== 'object') {
        throw new Error('buildRulesSectionMarkdown: categoryNames is required');
    }
    if (!rules || rules.length === 0) {
        return 'Правила не настроены\n\n';
    }

    const enabledRules = rules.filter(r => r.enabled !== false);
    if (enabledRules.length === 0) {
        return 'Нет активных правил\n\n';
    }

    const byCat = {};
    for (const r of enabledRules) {
        const c = r.category || 'other';
        if (!byCat[c]) byCat[c] = [];
        byCat[c].push(r);
    }

    let md = '';
    for (const [cat, list] of Object.entries(byCat)) {
        md += `${heading} ${categoryNames[cat] || cat}\n\n`;
        for (const r of list) {
            let overrideMark = '';
            if (markOverrides && baseRulesMap?.has(r.id)) {
                const baseRule = baseRulesMap.get(r.id);
                overrideMark = ` (оверрайд правила "${baseRule.name}")`;
            }
            md += `- **${r.name}** [${String(r.level || '').toUpperCase()}]${overrideMark}\n\n`;
            const descriptionLines = String(r.description || '').split('\n');
            for (let i = 0; i < descriptionLines.length; i++) {
                const line = descriptionLines[i];
                const trimmed = line.trim();
                if (!trimmed) {
                    md += `\n`;
                } else {
                    md += `  ${trimmed}\n`;
                }
            }
            md += `\n`;
        }
    }

    return md;
}

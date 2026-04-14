import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getAllProjects, getProjectSettings } from '../validation-engine.mjs';
import { getBaseTestModelRulesRaw, getProjectModelRulesDocumentation } from '../test-model-rules.mjs';
import { buildRulesSectionMarkdown, shouldRegenerateMarkdown } from './build-rules-section-markdown.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');
const OUTPUT_PATH = join(CONFIG_DIR, 'test-model-rules.md');
const YAML_PATH = join(CONFIG_DIR, 'test-model-analysis-rules.yaml');

const categoryNames = {
    structure: 'Структура и слои C1–C4',
    scope_boundaries: 'Границы модели и TMS',
    naming: 'Именование узлов',
    decomposition: 'Декомпозиция (CRUD и др.)',
    duplication: 'Дубли и переиспользование',
    export_sync: 'Экспорт и синхронизация с TMS',
    flags: 'Флаги и обозначения XMind',
    quality: 'Критерии качества',
    other: 'Прочее'
};

/**
 * Запись server/config/test-model-rules.md
 * @param {boolean} force
 */
export function writeTestModelRulesMarkdown (force = false)
{
    if (!force && !shouldRegenerateMarkdown(
        OUTPUT_PATH,
        [YAML_PATH, join(CONFIG_DIR, 'project-settings.yaml')],
        join(CONFIG_DIR, 'projects'),
        '[generate-test-model-rules]'
    )) {
        console.log('[generate-test-model-rules] Файл актуален, пропускаем генерацию');
        return OUTPUT_PATH;
    }

    const projects = getAllProjects() || {};
    const baseRules = getBaseTestModelRulesRaw() || [];
    const baseRulesMap = new Map(baseRules.map(r => [r.id, r]));

    let markdown = '# Правила анализа тестовой модели\n\n';
    markdown += '---\n\n';

    markdown += '## Базовые правила\n\n';
    markdown += buildRulesSectionMarkdown(baseRules, { heading: '###', categoryNames });
    markdown += '---\n\n';

    markdown += '## Проекты\n\n';
    const sortedProjects = Object.entries(projects).sort(([a], [b]) => Number(a) - Number(b));
    for (const [projectId, meta] of sortedProjects) {
        const settings = getProjectSettings(projectId);
        const projectModelRules = getProjectModelRulesDocumentation(projectId) || [];
        const name = (meta && meta.name) || (settings && settings.name) || `Проект ${projectId}`;
        const modelWarnTh =
            settings.model_warning_threshold != null
                ? settings.model_warning_threshold
                : settings.warning_threshold;

        markdown += `### ${name} (ID: ${projectId})\n\n`;
        markdown += `Допустимый процент предупреждений: ${modelWarnTh}%\n\n`;

        if (projectModelRules.length === 0) {
            markdown += `На проекте не настроены кастомные правила\n\n`;
        } else {
            markdown += buildRulesSectionMarkdown(projectModelRules, {
                heading: '####',
                categoryNames,
                baseRulesMap,
                markOverrides: true
            });
        }

        markdown += `---\n\n`;
    }

    writeFileSync(OUTPUT_PATH, markdown, 'utf8');
    return OUTPUT_PATH;
}

const isMain = process.argv[1] && process.argv[1].endsWith('generate-test-model-rules-md.mjs');
if (isMain) {
    try {
        const force = process.argv.includes('--force') || process.argv.includes('-f');
        const out = writeTestModelRulesMarkdown(force);
        console.log(`[generate-test-model-rules] Записано: ${out}`);
    } catch (e) {
        console.error('[generate-test-model-rules] Ошибка:', e.message);
        process.exit(1);
    }
}

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    getAllProjects,
    getProjectSettings,
    getBaseRulesDocumentation,
    getProjectRulesDocumentation
} from '../validation-engine.mjs';
import { buildRulesSectionMarkdown, shouldRegenerateMarkdown } from './build-rules-section-markdown.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');
const OUTPUT_PATH = join(CONFIG_DIR, 'validation-rules.md');

const categoryNames = {
    required_fields: 'Обязательные поля',
    naming: 'Правила именования',
    expected_result: 'Ожидаемый результат',
    steps: 'Шаги тест-кейса',
    tags: 'Теги',
    custom_fields: 'Кастомные поля',
    parameters: 'Параметры',
    other: 'Прочее',
    test_scope: 'Границы ответственности'
};

/**
 * Генерация validation-rules.md с записью в server/config/validation-rules.md
 * @param {boolean} force - принудительная генерация, игнорируя проверку времени модификации
 */
export function writeValidationRulesMarkdown(force = false) {
    if (!force && !shouldRegenerateMarkdown(
        OUTPUT_PATH,
        [join(CONFIG_DIR, 'static-analysis-rules.yaml'), join(CONFIG_DIR, 'project-settings.yaml')],
        join(CONFIG_DIR, 'projects'),
        '[generate-validation-rules]'
    )) {
        console.log('[generate-validation-rules] Файл актуален, пропускаем генерацию');
        return OUTPUT_PATH;
    }
    const projects = getAllProjects() || {};
    const baseRules = getBaseRulesDocumentation() || [];
    const baseRulesMap = new Map(baseRules.map(r => [r.id, r]));

    let markdown = `# Правила статического анализа тест-кейсов\n\n`;

    markdown += `---\n\n`;

    // Базовые правила
    markdown += `## Базовые правила\n\n`;
    markdown += buildRulesSectionMarkdown(baseRules, { heading: '###', categoryNames });
    markdown += `---\n\n`;

    // Проекты: пороговые значения и кастомные правила
    markdown += `## Проекты\n\n`;
    const sortedProjects = Object.entries(projects).sort(([a], [b]) => Number(a) - Number(b));
    for (const [projectId, meta] of sortedProjects) {
        const settings = getProjectSettings(projectId);
        const projectRules = getProjectRulesDocumentation(projectId) || [];
        const name = (meta && meta.name) || (settings && settings.name) || `Проект ${projectId}`;

        markdown += `### ${name} (ID: ${projectId})\n\n`;
        markdown += `Допустимый процент предупреждений: ${settings.warning_threshold}%\n\n`;

        if (projectRules.length === 0) {
            markdown += `На проекте не настроены кастомные правила\n\n`;
        } else {
            markdown += buildRulesSectionMarkdown(projectRules, {
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

const isMain = process.argv[1] && process.argv[1].endsWith('generate-validation-rules-md.mjs');
if (isMain) {
    try {
        // При запуске из командной строки можно использовать --force для принудительной генерации
        const force = process.argv.includes('--force') || process.argv.includes('-f');
        const out = writeValidationRulesMarkdown(force);
        console.log(`[generate-validation-rules] Записано: ${out}`);
    } catch (e) {
        console.error('[generate-validation-rules] Ошибка:', e.message);
        process.exit(1);
    }
}

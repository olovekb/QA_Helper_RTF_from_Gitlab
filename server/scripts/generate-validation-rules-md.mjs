import { writeFileSync, statSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    getAllProjects,
    getProjectSettings,
    getBaseRulesDocumentation,
    getProjectRulesDocumentation
} from '../validation-engine.mjs';

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

function buildRulesSectionMarkdown(rules, { heading = '###', baseRulesMap = null, markOverrides = false } = {}) {
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
            // обработка многострочных описаний с сохранением переносов и пустых строк
            const descriptionLines = String(r.description || '').split('\n');
            if (descriptionLines.length > 0) {
                for (let i = 0; i < descriptionLines.length; i++) {
                    const line = descriptionLines[i];
                    const trimmed = line.trim();
                    
                    if (!trimmed) {
                        md += `\n`;
                    } else {
                        md += `  ${trimmed}\n`;
                    }
                }
            }
            md += `\n`;
        }
    }

    return md;
}

/**
 * Проверяет, нужно ли обновлять validation-rules.md
 * Возвращает true, если файл не существует или исходные конфиги новее
 */
function shouldRegenerateMarkdown() {
    // Если файл не существует, нужно генерировать
    if (!existsSync(OUTPUT_PATH)) {
        return true;
    }

    try {
        const outputMtime = statSync(OUTPUT_PATH).mtimeMs;
        
        // Проверяем время модификации основных конфигов
        const rulesPath = join(CONFIG_DIR, 'static-analysis-rules.yaml');
        const settingsPath = join(CONFIG_DIR, 'project-settings.yaml');
        const projectsDir = join(CONFIG_DIR, 'projects');
        
        // Проверяем базовые конфиги
        if (existsSync(rulesPath) && statSync(rulesPath).mtimeMs > outputMtime) {
            return true;
        }
        
        if (existsSync(settingsPath) && statSync(settingsPath).mtimeMs > outputMtime) {
            return true;
        }
        
        // Проверяем файлы проектов
        if (existsSync(projectsDir)) {
            const projectFiles = readdirSync(projectsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            for (const file of projectFiles) {
                const projectFilePath = join(projectsDir, file);
                if (statSync(projectFilePath).mtimeMs > outputMtime) {
                    return true;
                }
            }
        }
        
        return false;
    } catch (err) {
        // В случае ошибки лучше перегенерировать
        console.warn(`[generate-validation-rules] Ошибка при проверке времени модификации: ${err.message}`);
        return true;
    }
}

/**
 * Генерация validation-rules.md с записью в server/config/validation-rules.md
 * @param {boolean} force - принудительная генерация, игнорируя проверку времени модификации
 */
export function writeValidationRulesMarkdown(force = false) {
    // Проверяем, нужно ли обновлять файл
    if (!force && !shouldRegenerateMarkdown()) {
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
    markdown += buildRulesSectionMarkdown(baseRules, { heading: '###' });
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

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем примеры из JSON файлов (статические примеры по умолчанию)
const e2eExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'e2e-examples.json'), 'utf-8'));
const integrationFeExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'integration-fe-examples.json'), 'utf-8'));
const integrationBeExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'integration-be-examples.json'), 'utf-8'));
const parametrizedExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'parametrized-examples.json'), 'utf-8'));

/**
 * Выбирает набор примеров для промпта (статические + идеальные из БД)
 * @param {Array} chunk - Модель чанка (не используется, оставлен для совместимости)
 * @param {string} mode - Режим генерации: 'FULL', 'BATCH', 'E2E_ONLY', 'INTEGRATION_ONLY'
 * @param {Object} [perfectExamples] - Идеальные примеры из БД, сгруппированные по слоям: { 'E2E Tests': [...], ... }
 * @param {Object} [db] - Knex instance для работы с БД (опционально, для получения примеров)
 * @param {string} [projectId] - ID проекта Allure (опционально)
 * @returns {Promise<Object>} Объект с примерами по категориям
 */
async function selectExamples(chunk, mode = 'FULL', perfectExamples = null, db = null, projectId = null) {
    // Сначала пытаемся получить идеальные примеры из БД, если они не переданы
    let perfect = perfectExamples;
    if (!perfect && db) {
        try {
            const { getAllPerfectExamplesByLayer } = await import('../perfect-examples.mjs');
            perfect = await getAllPerfectExamplesByLayer(projectId, db);
        } catch (err) {
            console.warn('[selectExamples] Ошибка загрузки идеальных примеров из БД:', err.message);
            perfect = null;
        }
    }

    // Функция для получения примеров: сначала идеальные, затем статические
    const getExamples = (layer, staticExamples, maxCount = 3) => {
        const result = [];
        
        // Добавляем идеальные примеры из БД (если есть)
        if (perfect && perfect[layer] && perfect[layer].length > 0) {
            const perfectCount = Math.min(perfect[layer].length, Math.floor(maxCount / 2));
            result.push(...perfect[layer].slice(0, perfectCount));
            console.log(`[selectExamples] Использовано ${perfectCount} идеальных примеров для ${layer}`);
        }
        
        // Дополняем статическими примерами до нужного количества
        const staticNeeded = maxCount - result.length;
        if (staticNeeded > 0 && staticExamples && staticExamples.length > 0) {
            result.push(...staticExamples.slice(0, staticNeeded));
        }
        
        return result;
    };

    if (mode === 'E2E_ONLY') {
        return {
            e2e: getExamples('E2E Tests', e2eExamples, 3),
            parametrized: parametrizedExamples.slice(0, 1)
        };
    }

    if (mode === 'INTEGRATION_ONLY') {
        return {
            integration_fe: getExamples('Integration frontend Tests', integrationFeExamples, 3),
            integration_be: getExamples('Integration backend Tests', integrationBeExamples, 3),
            parametrized: parametrizedExamples.slice(0, 2)
        };
    }

    // FULL режим (ONE-PASS) - комбинация статических и идеальных примеров
    return {
        e2e: getExamples('E2E Tests', e2eExamples, 2),
        integration_fe: getExamples('Integration frontend Tests', integrationFeExamples, 3),
        integration_be: getExamples('Integration backend Tests', integrationBeExamples, 2),
        parametrized: parametrizedExamples.slice(0, 2)
    };
}

/**
 * Формирует секцию примеров для промпта
 * @param {Object} examples - Объект с примерами по категориям
 * @returns {string} Форматированная секция примеров
 */
function buildExamplesSection(examples) {
    let section = '';

    // E2E примеры
    if (examples.e2e && examples.e2e.length > 0) {
        section += `\n## E2E ТЕСТЫ (${examples.e2e.length} пример${examples.e2e.length > 1 ? 'а' : ''})\n\n`;
        section += `🚨 ВАЖНО: Эти примеры показывают ИДЕАЛЬНЫЙ формат E2E тестов. Изучи их структуру и следуй формату!\n\n`;
        examples.e2e.forEach((ex, i) => {
            section += `### Пример ${i + 1}: ${ex.title}\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Integration Frontend примеры
    if (examples.integration_fe && examples.integration_fe.length > 0) {
        section += `\n## INTEGRATION FRONTEND (${examples.integration_fe.length} пример${examples.integration_fe.length > 1 ? 'а' : ''})\n\n`;
        section += `🚨 ВАЖНО: Эти примеры показывают ИДЕАЛЬНЫЙ формат Integration frontend тестов. Изучи их структуру и следуй формату!\n\n`;
        examples.integration_fe.forEach((ex, i) => {
            section += `### Пример ${i + 1}: ${ex.title}\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Integration Backend примеры
    if (examples.integration_be && examples.integration_be.length > 0) {
        section += `\n## INTEGRATION BACKEND (${examples.integration_be.length} пример${examples.integration_be.length > 1 ? 'а' : ''})\n\n`;
        section += `🚨 ВАЖНО: Эти примеры показывают ИДЕАЛЬНЫЙ формат Integration backend тестов. Изучи их структуру и следуй формату!\n\n`;
        examples.integration_be.forEach((ex, i) => {
            section += `### Пример ${i + 1}: ${ex.title}\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Параметризация примеры
    if (examples.parametrized && examples.parametrized.length > 0) {
        section += `\n## ПАРАМЕТРИЗАЦИЯ (${examples.parametrized.length} пример${examples.parametrized.length > 1 ? 'а' : ''})\n\n`;
        section += `🚨 КРИТИЧЕСКИ ВАЖНО: Используй параметризацию вместо дубликатов!\n\n`;
        examples.parametrized.forEach((ex, i) => {
            section += `### Пример ${i + 1}: ${ex.title}\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    return section.trim();
}

// Синхронная версия для обратной совместимости (использует только статические примеры)
function selectExamplesSync(chunk, mode = 'FULL') {
    if (mode === 'E2E_ONLY') {
        return {
            e2e: e2eExamples.slice(0, 2),
            parametrized: parametrizedExamples.slice(0, 1)
        };
    }

    if (mode === 'INTEGRATION_ONLY') {
        return {
            integration_fe: integrationFeExamples.slice(0, 2),
            integration_be: integrationBeExamples.slice(0, 2),
            parametrized: parametrizedExamples.slice(0, 2)
        };
    }

    return {
        e2e: e2eExamples.slice(0, 1),
        integration_fe: integrationFeExamples.slice(0, 2),
        integration_be: integrationBeExamples.slice(0, 1),
        parametrized: parametrizedExamples.slice(0, 2)
    };
}

export {
    selectExamples,
    selectExamplesSync,
    buildExamplesSection
};


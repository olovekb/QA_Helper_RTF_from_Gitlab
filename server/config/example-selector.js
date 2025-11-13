import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем примеры из JSON файлов
const e2eExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'e2e-examples.json'), 'utf-8'));
const integrationFeExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'integration-fe-examples.json'), 'utf-8'));
const integrationBeExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'integration-be-examples.json'), 'utf-8'));
const parametrizedExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'parametrized-examples.json'), 'utf-8'));

/**
 * Выбирает фиксированный набор примеров для промпта
 * @param {Array} chunk - Модель чанка (не используется, оставлен для совместимости)
 * @param {string} mode - Режим генерации: 'FULL', 'BATCH', 'E2E_ONLY', 'INTEGRATION_ONLY'
 * @returns {Object} Объект с примерами по категориям
 */
function selectExamples(chunk, mode = 'FULL') {
    if (mode === 'E2E_ONLY') {
        return {
            e2e: e2eExamples.slice(0, 2), // 2 примера E2E
            parametrized: parametrizedExamples.slice(0, 1) // 1 пример параметризации
        };
    }

    if (mode === 'INTEGRATION_ONLY') {
        return {
            integration_fe: integrationFeExamples.slice(0, 2),
            integration_be: integrationBeExamples.slice(0, 2),
            parametrized: parametrizedExamples.slice(0, 2) // 2 примера с разными типами
        };
    }

    // FULL режим (ONE-PASS) - фиксированный набор примеров
    return {
        e2e: e2eExamples.slice(0, 1),
        integration_fe: integrationFeExamples.slice(0, 2),
        integration_be: integrationBeExamples.slice(0, 1),
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
        examples.e2e.forEach((ex, i) => {
            section += `### Пример ${i + 1}: ${ex.title}\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Integration Frontend примеры
    if (examples.integration_fe && examples.integration_fe.length > 0) {
        section += `\n## INTEGRATION FRONTEND (${examples.integration_fe.length} пример${examples.integration_fe.length > 1 ? 'а' : ''})\n\n`;
        examples.integration_fe.forEach((ex, i) => {
            section += `### Пример ${i + 1}: ${ex.title}\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Integration Backend примеры
    if (examples.integration_be && examples.integration_be.length > 0) {
        section += `\n## INTEGRATION BACKEND (${examples.integration_be.length} пример${examples.integration_be.length > 1 ? 'а' : ''})\n\n`;
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

export {
    selectExamples,
    buildExamplesSection
};


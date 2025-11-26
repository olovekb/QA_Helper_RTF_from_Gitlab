import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ АРХИТЕКТУРНОЕ РЕШЕНИЕ: Загружаем примеры из JSON файлов (статические примеры по умолчанию)
// Эти примеры ВСЕГДА доступны и используются как обязательные шаблоны
let e2eExamples = [];
let integrationFeExamples = [];
let integrationBeExamples = [];
let parametrizedExamples = [];

try {
    e2eExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'e2e-examples.json'), 'utf-8'));
    console.log(`[example-selector] ✅ Загружено ${e2eExamples.length} E2E примеров`);
} catch (err) {
    console.error(`[example-selector] ❌ Ошибка загрузки e2e-examples.json:`, err.message);
}

try {
    integrationFeExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'integration-fe-examples.json'), 'utf-8'));
    console.log(`[example-selector] ✅ Загружено ${integrationFeExamples.length} Integration Frontend примеров`);
} catch (err) {
    console.error(`[example-selector] ❌ Ошибка загрузки integration-fe-examples.json:`, err.message);
}

try {
    integrationBeExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'integration-be-examples.json'), 'utf-8'));
    console.log(`[example-selector] ✅ Загружено ${integrationBeExamples.length} Integration Backend примеров`);
} catch (err) {
    console.error(`[example-selector] ❌ Ошибка загрузки integration-be-examples.json:`, err.message);
}

try {
    parametrizedExamples = JSON.parse(readFileSync(join(__dirname, 'examples', 'parametrized-examples.json'), 'utf-8'));
    console.log(`[example-selector] ✅ Загружено ${parametrizedExamples.length} параметризованных примеров`);
} catch (err) {
    console.error(`[example-selector] ❌ Ошибка загрузки parametrized-examples.json:`, err.message);
}

// ✅ ПРОВЕРКА: Убеждаемся, что хотя бы базовые примеры загружены
const totalStaticExamples = e2eExamples.length + integrationFeExamples.length + integrationBeExamples.length + parametrizedExamples.length;
if (totalStaticExamples === 0) {
    console.error(`[example-selector] ❌ КРИТИЧЕСКАЯ ОШИБКА: Не загружено ни одного статического примера! Проверьте файлы в server/config/examples/`);
} else {
    console.log(`[example-selector] ✅ Всего загружено ${totalStaticExamples} статических примеров`);
}

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
 * Делает примеры ОБЯЗАТЕЛЬНЫМИ ШАБЛОНАМИ для агента
 * @param {Object} examples - Объект с примерами по категориям
 * @returns {string} Форматированная секция примеров
 */
function buildExamplesSection(examples) {
    let section = '';

    section += `\n\n═══════════════════════════════════════════════════════════════\n`;
    section += `🚨🚨🚨 ОБЯЗАТЕЛЬНЫЕ ЭТАЛОННЫЕ ШАБЛОНЫ - СТРОГО СЛЕДУЙ ИМ! 🚨🚨🚨\n`;
    section += `═══════════════════════════════════════════════════════════════\n\n`;
    section += `Эти примеры - ЭТАЛОН для генерации тест-кейсов. Ты ОБЯЗАН:\n`;
    section += `1. Изучить структуру JSON в каждом примере\n`;
    section += `2. Строго следовать формату полей (feature, story, scenario, steps, expected, layer, priority, tags)\n`;
    section += `3. Использовать ТОЧНО такой же стиль шагов и expected, как в примерах\n`;
    section += `4. Для Integration frontend: steps = ТОЛЬКО пользовательские действия (НЕ API вызовы!)\n`;
    section += `5. Для параметризации: использовать parameters + examples (как в примерах)\n\n`;

    // E2E примеры
    if (examples.e2e && examples.e2e.length > 0) {
        section += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        section += `📋 ЭТАЛОН E2E ТЕСТОВ (${examples.e2e.length} пример${examples.e2e.length > 1 ? 'а' : ''})\n`;
        section += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        section += `🚨 КРИТИЧНО: Эти примеры показывают ИДЕАЛЬНЫЙ формат E2E тестов.\n`;
        section += `Ты ОБЯЗАН следовать ТОЧНО такому же формату: структура, стиль шагов, формат expected!\n\n`;
        examples.e2e.forEach((ex, i) => {
            section += `\n### 📌 ЭТАЛОН E2E #${i + 1}: "${ex.title}"\n\n`;
            section += `**Обрати внимание на:**\n`;
            section += `- Формат steps: только пользовательские действия, БЕЗ технических деталей\n`;
            section += `- Формат expected: начинается с "**Отображается**" или "**Осуществляется**"\n`;
            section += `- Структура: layer="E2E Tests", НЕТ scenario, НЕТ code\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Integration Frontend примеры
    if (examples.integration_fe && examples.integration_fe.length > 0) {
        section += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        section += `📋 ЭТАЛОН INTEGRATION FRONTEND ТЕСТОВ (${examples.integration_fe.length} пример${examples.integration_fe.length > 1 ? 'а' : ''})\n`;
        section += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        section += `🚨 КРИТИЧНО: Эти примеры показывают ИДЕАЛЬНЫЙ формат Integration frontend тестов.\n`;
        section += `Ты ОБЯЗАН следовать ТОЧНО такому же формату!\n\n`;
        section += `**СУТЬ INTEGRATION FRONTEND ТЕСТОВ:**\n`;
        section += `Дойти до формы/страницы/компонента, сделать минимум 1 действие (или более), получить ожидаемый результат.\n\n`;
        section += `**КЛЮЧЕВЫЕ ПРАВИЛА из примеров:**\n`;
        section += `- steps: ТОЛЬКО пользовательские действия ("Нажать кнопку", "Ввести текст", "Выбрать значение", "Выбрать дату")\n`;
        section += `- Может быть 1 действие или несколько (например: "Выбрать дату" + "Ввести число" + "Нажать кнопку")\n`;
        section += `- Параметризация в steps: можно использовать {{параметр}} прямо в шагах ("Ввести {{Код}}", "Авторизоваться с помощью {{Способ}}")\n`;
        section += `- ❌ НЕ используй в steps: "Отправить GET", "Выполнить запрос", "Дождаться загрузки", "Получить ответ" - это технические детали!\n`;
        section += `- precondition: ОБЯЗАТЕЛЬНО! Описание состояния UI БЕЗ действий ("Пользователь авторизован, на странице...")\n`;
        section += `- precondition с подменами: для негативных/граничных тестов добавляй подмены с нумерацией ("1. Состояние...\n2. Подменить статус-код запроса **/api/endpoint** на 400")\n`;
        section += `- expected: может содержать UI реакции ("**Отображается**...") и технические ("**Отправляется** GET...")\n`;
        section += `- scenario: ОБЯЗАТЕЛЬНО должен быть указан (из тестовой модели)\n\n`;
        examples.integration_fe.forEach((ex, i) => {
            section += `\n### 📌 ЭТАЛОН Integration Frontend #${i + 1}: "${ex.title}"\n\n`;
            section += `**Обрати внимание на:**\n`;
            section += `- steps: ${JSON.stringify(ex.steps || [])} ← ТОЛЬКО пользовательские действия!\n`;
            section += `- precondition: "${ex.precondition || ''}" ← Состояние UI БЕЗ действий!\n`;
            section += `- expected: "${ex.expected || ''}" ← Реакция системы (UI + техническая)\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Integration Backend примеры
    if (examples.integration_be && examples.integration_be.length > 0) {
        section += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        section += `📋 ЭТАЛОН INTEGRATION BACKEND ТЕСТОВ (${examples.integration_be.length} пример${examples.integration_be.length > 1 ? 'а' : ''})\n`;
        section += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        section += `🚨 КРИТИЧНО: Эти примеры показывают ИДЕАЛЬНЫЙ формат Integration backend тестов.\n`;
        section += `Ты ОБЯЗАН следовать ТОЧНО такому же формату!\n\n`;
        examples.integration_be.forEach((ex, i) => {
            section += `\n### 📌 ЭТАЛОН Integration Backend #${i + 1}: "${ex.title}"\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    // Параметризация примеры
    if (examples.parametrized && examples.parametrized.length > 0) {
        section += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        section += `📋 ЭТАЛОН ПАРАМЕТРИЗАЦИИ (${examples.parametrized.length} пример${examples.parametrized.length > 1 ? 'а' : ''})\n`;
        section += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        section += `🚨 КРИТИЧЕСКИ ВАЖНО: Используй параметризацию вместо дубликатов!\n`;
        section += `Если шаги и expected одинаковые, но меняются только входные данные → используй parameters + examples!\n\n`;
        examples.parametrized.forEach((ex, i) => {
            section += `\n### 📌 ЭТАЛОН Параметризации #${i + 1}: "${ex.title}"\n\n`;
            section += `**Обрати внимание на:**\n`;
            section += `- parameters: массив с name и values\n`;
            section += `- examples: массив объектов с параметрами\n`;
            section += `- Использование {{параметр}} в steps и expected\n\n`;
            section += `\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n\n`;
        });
    }

    section += `\n═══════════════════════════════════════════════════════════════\n`;
    section += `🚨 ЗАПОМНИ: Эти примеры - ЭТАЛОН. Строго следуй их формату!\n`;
    section += `═══════════════════════════════════════════════════════════════\n\n`;

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


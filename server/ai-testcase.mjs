import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callWithCloudRuFallback } from './cloudruClient.mjs';
import config from './config.json' assert { type: 'json' };
import { getAIRulesForProject } from './validation-engine.mjs';
import { formatStepsForPrompt } from './stepsNormalizer.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function callOpenRouterForAnalyze (messages, apiKey, opts = {})
{
    const { callWithBackoff } = await import('./server.js');
    return callWithBackoff(OPENROUTER_URL, messages, apiKey, {
        models: ['google/gemma-4-31b-it', ...(config.fallbackModels || [])],
        reduceTokensOn400: true,
        ...opts
    });
}

// Папка для запросов/ответов AI
const AI_LOGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ai-logs');

/** Максимальное количество тест-кейсов в одном запросе к AI */
export const BATCH_SIZE = 20;

// Максимальная длина ответа модели в символах для обрезки до парсинга
const MAX_RESPONSE_LENGTH = 100000;

/** JSON Schema для ответа AI */
const RECOMMENDATION_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                recommendation: { type: 'string' },
                severity: { type: 'string', enum: ['error', 'warning' /* , 'improvement' */] },
                category: { type: 'string', enum: ['required_fields', 'naming', 'expected_result', 'steps', 'parameters', 'test_scope', 'other'] }
            },
            required: ['title', 'recommendation', 'severity', 'category'],
            additionalProperties: false
        }
    }
};

/**
 * Создание папки, если не найдена
 */
function ensureAILogsDir ()
{
    if (!fs.existsSync(AI_LOGS_DIR)) {
        fs.mkdirSync(AI_LOGS_DIR, { recursive: true });
    }
}

/**
 * Замена " на ' в тест-кейсах
 */
function sanitizeDataForPrompt (text)
{
    if (!text || typeof text !== 'string') return text;
    return text.replace(/"/g, "'");
}

/** Маппинг слоев на .md-файлы в test-cases/ */
const LAYER_TO_MD = {
    'Integration frontend Tests': 'integration-fe.md',
    'Integration backend Tests': 'integration-be.md',
    'E2E Tests': 'e2e.md'
};

const EXAMPLES_MD_DIR = path.join('./server/config/examples', 'test-cases');
const EXAMPLES_TEST_MODEL_DIR = path.join('./server/config/examples', 'test-model');

/**
 * Парсит содержимое .md-файла в массив блоков примеров (разделители: --- или ## Пример)
 */
export function parseMdExamples (content)
{
    const blocks = content
        .split(/\r?\n---\r?\n/)
        .flatMap(block => block.split(/\r?\n\r?\n(?=## Пример )/))
        .map(b => b.trim())
        .filter(b => b.length > 0);
    return blocks;
}

/**
 * Загрузка примеров тест-кейсов для конкретного слоя из MD-файлов
 */
function getExamplesForLayer (layer)
{
    /* TODO: раскомментировать после проверки гипотезы с антипримерами
    const filename = LAYER_TO_MD[layer] || 'integration-fe.md';
    const filepath = path.join(EXAMPLES_MD_DIR, filename);

    try {
        if (fs.existsSync(filepath)) {
            const content = fs.readFileSync(filepath, 'utf8');
            return parseMdExamples(content);
        }
    } catch (error) {
        console.warn(`[getExamplesForLayer] Не удалось загрузить примеры из ${filepath}:`, error.message);
    }

    return [];
    */

    const filepath = path.join(EXAMPLES_MD_DIR, 'antiexamples.md');
    try {
        if (fs.existsSync(filepath)) {
            return parseMdExamples(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (error) {
        console.warn(`[getExamplesForLayer] Не удалось загрузить antiexamples.md:`, error.message);
    }
    return [];
}

/**
 * Загружает все примеры тест-кейсов из .md-файлов
 */
function loadAllExamples ()
{
    /* TODO: раскомментировать после проверки гипотезы с антипримерами
    const allExamples = {};

    Object.entries(LAYER_TO_MD).forEach(([layerName, filename]) =>
    {
        const filepath = path.join(EXAMPLES_MD_DIR, filename);
        try {
            if (fs.existsSync(filepath)) {
                const content = fs.readFileSync(filepath, 'utf8');
                const examples = parseMdExamples(content);
                if (examples.length > 0) {
                    allExamples[layerName] = examples;
                }
            }
        } catch (error) {
            console.warn(`[loadAllExamples] Не удалось загрузить ${filename}:`, error.message);
        }
    });

    return allExamples;
    */

    const filepath = path.join(EXAMPLES_MD_DIR, 'antiexamples.md');
    try {
        if (fs.existsSync(filepath)) {
            return parseMdExamples(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (error) {
        console.warn(`[loadAllExamples] Не удалось загрузить antiexamples.md:`, error.message);
    }
    return [];
}

/**
 * Опциональные антипримеры для AI-анализа тестовой модели (отдельный каталог от test-cases).
 * Файл: `server/config/examples/test-model/antiexamples.md`
 */
export function loadTestModelExamples ()
{
    const filepath = path.join(EXAMPLES_TEST_MODEL_DIR, 'antiexamples.md');
    try {
        if (fs.existsSync(filepath)) {
            return parseMdExamples(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (error) {
        console.warn(`[loadTestModelExamples] Не удалось загрузить ${filepath}:`, error.message);
    }
    return [];
}

/**
 * Объединить примеры для промпта
 */
export function prepareExamplesForPrompt (examples)
{
    if (!examples) return 'Примеры отсутствуют';

    if (Array.isArray(examples)) {
        if (examples.length === 0) return 'Примеры отсутствуют';
        return examples
            .map((ex, idx) => `ПРИМЕР ${idx + 1}:\n${ex}`)
            .join('\n\n---\n\n');
    }

    if (typeof examples === 'object') {
        const layers = Object.keys(examples);
        if (layers.length === 0) return 'Примеры отсутствуют';

        return layers.map(layer =>
        {
            const blocks = examples[layer];
            const formatted = blocks
                .map((ex, idx) => `ПРИМЕР ${idx + 1}:\n${ex}`)
                .join('\n\n---\n\n');
            return `\n=== ПРИМЕРЫ ДЛЯ СЛОЯ: ${layer} ===\n${formatted}`;
        }).join('\n');
    }

    return 'Примеры отсутствуют';
}

/**
 * Создать сообщение для роли developer с примерами
 */
export function createDeveloperContent (examples)
{
    const hasExamples = (Array.isArray(examples) && examples.length > 0) ||
        (typeof examples === 'object' && Object.keys(examples).length > 0);

    if (!hasExamples) return null;

    return `Эти примеры показывают ситуации, в которых рекомендацию создавать НЕ нужно.
Используй их для калибровки границы: нарушение есть vs. нарушения нет.:

${prepareExamplesForPrompt(examples)}`;
}

/**
 * Генерация стайл-гайда с правилами из конфига (static-analysis-rules.yaml)
 */
function generateStyleGuide (projectId)
{
    console.log(`\n[generateStyleGuide] projectId = ${projectId} (${typeof projectId})`);

    let styleGuide = `# НАШ СТАЙЛГАЙД:`;

    if (!projectId) {
        console.warn('[generateStyleGuide] projectId отсутствует');
        return styleGuide;
    }

    try {
        const aiRules = getAIRulesForProject(projectId);
        console.log(`[generateStyleGuide] Получено правил: ${aiRules?.length || 0}`);

        if (aiRules && aiRules.length > 0) {
            aiRules.forEach((rule, index) =>
            {
                styleGuide += `\n${index + 1}. ${rule.ai_prompt}`;
            });
            console.log(`[generateStyleGuide] Добавлено ${aiRules.length} правил`);
        } else {
            console.warn('[generateStyleGuide] Правила не найдены');
        }
    } catch (error) {
        console.error('[generateStyleGuide] Ошибка:', error.message);
    }

    return styleGuide;
}

export function extractStepText (step)
{
    if (typeof step === 'string') return step.trim();

    if (step.body && typeof step.body === 'string') return step.body.trim();
    if (step.description && typeof step.description === 'string') return step.description.trim();
    if (step.bodyJson && typeof step.bodyJson === 'object') {
        if (step.bodyJson.content && Array.isArray(step.bodyJson.content)) {
            return step.bodyJson.content
                .map(paragraph =>
                {
                    if (paragraph.content && Array.isArray(paragraph.content)) {
                        return paragraph.content.map(item => item.text || '').join(' ');
                    }
                    return '';
                })
                .join(' ');
        }
    }
    return '';
}

export async function analyzeTestCaseWithAI (testCase, apiKey = null, jiraIssue = null, projectId = null)
{
    try {
        const testName = testCase.name ? testCase.name : 'Неизвестно';

        const stepsToFormat = testCase.stepsRaw || testCase.steps;
        const formattedStepsForPrompt = formatStepsForPrompt(stepsToFormat);

        const STYLE_GUIDE = generateStyleGuide(projectId);

        const layerName = testCase.layer && testCase.layer.name ? testCase.layer.name : null;
        const examples = layerName ? getExamplesForLayer(layerName) : [];
        const developerContent = createDeveloperContent(examples);

        const systemContentSingle = `Ты — ведущий QA-инженер и наставник в нашей команде. Твоя задача — провести ревью тест-кейса, написанного моим коллегой, и дать ему конструктивную обратную связь.

Проанализируй тест-кейс, основываясь на нашем стайлгайде:

${STYLE_GUIDE}

${developerContent ? '# АНТИПРИМЕРЫ\n' + developerContent + '\n' : ''}
Проведи детальный анализ по следующим пунктам, ссылаясь на наш стайлгайд:
1.  **Анализ Названия:** Насколько оно соответствует правилу №1?
2.  **Анализ Шагов:** Все ли шаги соответствуют правилу №2? Есть ли лишние или недостающие действия? Если это API-тест, все ли данные на месте?
3.  **Анализ Ожидаемого результата:** Соответствует ли он правилу №3? Является ли он однозначным?
4.  **Соответствие типу теста:** Похоже ли описание на атомарный или сценарный тест, и соответствует ли это выбранному слою (правило №4)?
5.  **Общие рекомендации:** Что еще можно улучшить, чтобы тест-кейс стал эталонным? Предложи конкретные переформулировки, если это необходимо.

Твой ответ должен быть структурированным, вежливым и полезным для автора тест-кейса.
`;

        const paramsBlockSingle = formatParametersForPrompt(testCase);
        const userContentSingle = `Теперь, вот данные тест-кейса для анализа:
----------------------------------------------------------
Название теста: ${testName}
Слой: ${testCase.layer && testCase.layer.name ? testCase.layer.name : 'не указан'}
${paramsBlockSingle ? `Параметры:\n${paramsBlockSingle}\n` : ''}Предусловия: ${normalizePreconditionForPrompt(testCase.precondition) || 'не указаны'}
Шаги теста:
${formattedStepsForPrompt || 'не указаны'}

Ожидаемый результат: ${testCase.expectedResult || 'не указан'}
----------------------------------------------------------`;

        console.log('SYSTEM:', systemContentSingle);
        // TODO: раскомментировать после проверки гипотезы с антипримерами: console.log(developerContent ? 'DEVELOPER:' + developerContent : 'DEVELOPER: не передается (примеры отсутствуют)');
        console.log('USER:', userContentSingle);

        ensureAILogsDir();
        const jiraPrefix = jiraIssue ? `${jiraIssue}-` : '';
        const promptFile = path.join(AI_LOGS_DIR, `ai-prompt-single-${jiraPrefix}last.txt`);
        let fullPromptSingleForLog = `=== SYSTEM ===\n${systemContentSingle}`;
        // TODO: раскомментировать после проверки гипотезы с антипримерами:  if (developerContent) fullPromptSingleForLog += `\n\n=== DEVELOPER ===\n${developerContent}`;
        fullPromptSingleForLog += `\n\n=== USER ===\n${userContentSingle}`;
        fs.writeFileSync(promptFile, `${new Date().toISOString()}\n\n${fullPromptSingleForLog}`, 'utf8');
        console.log(`Промпт сохранён в ${promptFile}`);

        const API_TOKEN = config.openRouterAiKey;
        if (!API_TOKEN) throw new Error('Не найден OPENROUTER_API_KEY. Проверьте ваш .env файл.');

        const URL = OPENROUTER_URL;

        const messages = [{ role: 'system', content: systemContentSingle }];
        // TODO: раскомментировать после проверки гипотезы с антипримерами: if (developerContent) messages.push({ role: 'system', content: developerContent });
        messages.push({ role: 'user', content: userContentSingle });

        const data = await callWithCloudRuFallback(URL, messages, apiKey || API_TOKEN, {
            max_tokens: 16000,
            temperature: 0.1,
            reduceTokensOn400: true
        });

        let responseText = '';
        if (data.choices?.[0]?.message?.content) {
            responseText = data.choices[0].message.content.trim();
        } else if (data.text) {
            responseText = data.text.trim();
        }

        if (responseText) {
            const filename = path.join(AI_LOGS_DIR, `ai-response-single-${jiraPrefix}last.txt`);
            fs.writeFileSync(filename, `${new Date().toISOString()}\n\n${responseText}`, 'utf8');
            console.log(`Ответ сохранён в ${filename}`);
            return removeTextBeforeSuggestion(responseText);
        } else {
            throw new Error('Ответ от модели пустой');
        }
    } catch (error) {
        console.error('Ошибка в функции analyzeTestCaseWithAI:', error.message);
        return `Произошла ошибка при анализе: ${error.message}`;
    }
}

function removeTextBeforeSuggestion (inputText)
{
    const regex = /.*(Предложи улучшения для теста\.)/s;
    return inputText.replace(regex, '$1').trim();
}

/**
 * Исправить ошибки в JSONе (md, LaTeX-теги) или обрезать ответ модели при наличии петли
 */
export function repairJsonCommonErrors (jsonText)
{
    if (!jsonText || typeof jsonText !== 'string') return jsonText;

    let result = jsonText;

    const mdMatch = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (mdMatch) result = mdMatch[1];

    try {
        JSON.parse(result);
        return result;
    } catch { /* продолжаем */ }

    // LaTeX-артефакты: \textbraceleft, \textbackslash
    result = result.replace(
        /"(title|recommendation|severity|category)":\s*"([^"]{0,300})((?:\\text\w+|\\?\{)+){10,}[^"]*"/g,
        (_, key, truncated) => `"${key}": "${truncated}[обрезано]"`
    );

    // пробелы/табы
    result = result.replace(
        /"(title|recommendation|severity|category)":\s*"([^"]{0,300})([\t ]{50,})[^"]*"/g,
        (_, key, truncated) => `"${key}": "${truncated}[обрезано]"`
    );

    // контроль длины поля, до 500 символов
    result = result.replace(
        /"(title|recommendation|severity|category)":\s*"([^"]{0,500})[^"]{500,}"/g,
        (_, key, truncated) => `"${key}": "${truncated}[обрезано]"`
    );

    try {
        JSON.parse(result);
        return result;
    } catch { /* продолжаем */ }

    // поиск последнего полного объекта
    const lastValidClose = result.lastIndexOf(']}');
    if (lastValidClose !== -1) {
        const candidate = result.slice(0, lastValidClose + 2);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch { /* продолжаем */ }
    }

    // восстановление структуры
    const aggressive = result
        .replace(/,\s*$/, '')
        .replace(/"[^"]*$/, '"[обрезано]"')
        + ']}}'.repeat(3);

    for (let i = aggressive.length; i > result.length / 2; i--) {
        try {
            JSON.parse(aggressive.slice(0, i));
            return aggressive.slice(0, i);
        } catch { /* продолжаем */ }
    }

    return result;
}

/**
 * Восстановить экранирование {{ и }} в тексте рекомендации после парсинга JSON
 */
function fixRecommendationText (text)
{
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\\+([{}])/g, '$1');
}

/**
 * Извлекает JSON из текста, который может быть обернут в markdown блоки
 */
function extractJSON (responseText)
{
    const markdownMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch) return markdownMatch[1];

    const jsonMatch = responseText.match(/(\{[\s\S]*\})/);
    if (jsonMatch) return jsonMatch[1];

    return responseText;
}

/**
 * Нормализует рекомендации AI к ожидаемому формату
 */
function normalizeRecommendations (rawRecommendations, testCases)
{
    const rawByKey = {};
    for (const [id, rec] of Object.entries(rawRecommendations)) {
        const arr = Array.isArray(rec) ? rec : (rec && rec.recommendation ? [rec] : []);
        arr.forEach(r =>
        {
            if (r?.recommendation) r.recommendation = fixRecommendationText(r.recommendation);
        });
        rawByKey[id] = arr;
    }

    const findRecommendations = (tcId) =>
    {
        const idStr = String(tcId);
        return rawByKey[tcId] ?? rawByKey[idStr] ?? rawByKey[`ID${idStr}`] ?? rawByKey[`ID ${idStr}`];
    };

    const recommendations = {};
    testCases.forEach(tc =>
    {
        const recs = findRecommendations(tc.id);
        if (recs && recs.length > 0) recommendations[tc.id] = recs;
    });

    return { recommendations, rawByKey };
}

/**
 * Извлечение ожидаемого результата из структуры шагов
 */
export function extractExpectedResult (expectedResultId, scenarioSteps)
{
    if (!expectedResultId || !scenarioSteps) return null;

    const expectedResultContainer = scenarioSteps[expectedResultId];
    if (!expectedResultContainer) return null;

    let expectedResultText = '';

    if (expectedResultContainer.children && expectedResultContainer.children.length > 0) {
        const expectedResultTexts = expectedResultContainer.children
            .map(childId => extractStepText(scenarioSteps[childId]))
            .filter(text => text.trim().length > 0);
        expectedResultText = expectedResultTexts.join('\n');
    } else {
        const bodyText = extractStepText(expectedResultContainer);
        const normalizedBodyText = bodyText?.trim().toLowerCase();
        if (bodyText && normalizedBodyText !== 'expected result' && normalizedBodyText !== 'ожидаемый результат') {
            expectedResultText = bodyText;
        }
    }

    return expectedResultText.trim().length > 0 ? expectedResultText : null;
}

/**
 * Убрать лишние переносы строк — артефакт экспорта из ТестОпса
 */
function normalizePreconditionForPrompt (precondition)
{
    if (!precondition || typeof precondition !== 'string') return precondition || '';
    return precondition.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Отформатировать параметры тест-кейса в md
 */
export function formatParametersForPrompt (tc)
{
    const params = tc.parameters || [];
    const examples = tc.examples || [];

    if (!params.length) return '';

    if (Array.isArray(examples) && examples.length > 0) {
        const paramNames = params.map(p => (p.name || p.parameter || '?').trim()).filter(Boolean);
        if (paramNames.length === 0) return '';

        const rows = [];
        for (const ex of examples) {
            const exParams = ex?.parameters || [];
            const row = paramNames.map(name =>
            {
                const p = exParams.find(ep => (ep.name || ep.parameter || '').trim() === name);
                return p?.value != null ? String(p.value).trim() : '—';
            });
            rows.push(row);
        }
        const header = paramNames.join(' | ');
        const separator = paramNames.map(() => '---').join(' | ');
        const body = rows.map(row => row.join(' | ')).join('\n');
        return `${header}\n${separator}\n${body}`;
    }

    const withValues = params.filter(p => Array.isArray(p.values) && p.values.length > 0);
    if (withValues.length > 0) {
        const lines = withValues.map(p =>
        {
            const name = (p.name || p.parameter || '?').trim();
            const vals = p.values.map(v => String(v).trim());
            return `${name} | ${vals.join(', ')}`;
        });
        return 'Параметр | Значения\n--- | ---\n' + lines.join('\n');
    }

    const names = params.map(p => (p.name || p.parameter || '?').trim()).filter(Boolean);
    return names.length ? `Параметры: ${names.join(', ')}` : '';
}

/**
 * Разбить testCases на батчи и вызвать processBatch для каждого.
 */
async function runBatchedAnalysis (testCases, processBatch, logPrefix = 'BATCHING')
{
    const totalBatches = Math.ceil(testCases.length / BATCH_SIZE);
    const allRecommendations = {};
    for (let i = 0; i < testCases.length; i += BATCH_SIZE) {
        const batch = testCases.slice(i, i + BATCH_SIZE);
        const batchIndex = i / BATCH_SIZE;
        const fromIdx = i + 1;
        const toIdx = Math.min(i + BATCH_SIZE, testCases.length);
        if (logPrefix) {
            console.log(`[${logPrefix}] Батч ${batchIndex + 1}/${totalBatches}: тест-кейсы ${fromIdx}–${toIdx} (${batch.length} шт.)`);
        }
        const batchRecs = await processBatch(batch, batchIndex, totalBatches);
        if (logPrefix) {
            console.log(`[${logPrefix}] Батч ${batchIndex + 1}/${totalBatches}: готово, рекомендаций для ${Object.keys(batchRecs).length} тест-кейсов`);
        }
        Object.assign(allRecommendations, batchRecs);
    }
    return allRecommendations;
}

export async function analyzeBulkTestCasesWithAI (testCases, apiKey = null, jiraIssue = null, projectId = null)
{
    try {
        if (!Array.isArray(testCases) || testCases.length === 0) {
            throw new Error('Не найдено тест-кейсов для анализа');
        }

        console.log(`\nОТЛАДКА ID И СЛОЕВ ТЕСТ-КЕЙСОВ:`);
        testCases.forEach((tc, index) =>
        {
            console.log(`   ${index + 1}. ID: "${tc.id}" (тип: ${typeof tc.id}), Layer: ${JSON.stringify(tc.layer)}`);
        });

        const totalBatches = Math.ceil(testCases.length / BATCH_SIZE);
        console.log(`\n[AI-батчинг] Тест-кейсов: ${testCases.length}, батчей: ${totalBatches} (макс. ${BATCH_SIZE} на батч)`);
        const sharedContext = totalBatches > 1 ? buildBulkSharedContext(projectId) : null;
        const processBatch = (batch, batchIndex, totalBatches) =>
            processBulkBatch(batch, apiKey, jiraIssue, projectId, batchIndex, totalBatches, sharedContext);
        const allRecommendations = await runBatchedAnalysis(testCases, processBatch, 'AI-батчинг');
        console.log(`[AI-батчинг] Завершено: всего ${Object.keys(allRecommendations).length} тест-кейсов с рекомендациями`);
        return allRecommendations;
    } catch (error) {
        console.error(`\nОШИБКА В AI-АНАЛИЗЕ:`);
        console.error(`Детали: ${error.message}`);
        console.error(`Стек: ${error.stack}`);
        console.error(`- Количество тест-кейсов: ${testCases?.length ?? 0}`);
        console.error(`- API ключ предоставлен: ${apiKey ? 'Да' : 'Нет'}`);
        console.error(`- Время ошибки: ${new Date().toISOString()}`);

        const errorResponse = {};
        (testCases || []).forEach(tc =>
        {
            errorResponse[tc.id] = [{
                recommendation: `Произошла ошибка при AI-анализе: ${error.message}. Попробуйте запросить индивидуальный анализ этого тест-кейса.`,
                severity: 'error',
                category: 'other'
            }];
        });
        console.log(`\nВозвращаем fallback-рекомендации для ${Object.keys(errorResponse).length} тест-кейсов`);
        return errorResponse;
    }
}

/**
 * Анализ тест-кейсов с проверкой исправления предыдущих замечаний
 */
export async function analyzeRecheckWithAI (testCases, issuesByTestCase, apiKey = null, jiraIssue = null)
{
    if (!Array.isArray(testCases) || testCases.length === 0) return {};

    console.log(`\n[AI-recheck] Запуск проверки исправлений для ${testCases.length} тест-кейсов`);

    const processBatch = (batch, batchIndex, totalBatches) =>
        processRecheckBatch(batch, issuesByTestCase, apiKey, jiraIssue, batchIndex, totalBatches);
    const allRecommendations = await runBatchedAnalysis(testCases, processBatch, 'AI-recheck');

    console.log(`[AI-recheck] Завершено: рекомендаций для ${Object.keys(allRecommendations).length} тест-кейсов`);
    return allRecommendations;
}

/**
 * Обрабатывает один батч при проверке исправлений
 */
async function processRecheckBatch (batch, issuesByTestCase, apiKey, jiraIssue = null, batchIndex = 0, totalBatches = 1)
{
    const casesForPrompt = batch.map(tc =>
    {
        const stepsToFormat = tc.stepsRaw || tc.steps;
        const paramsBlock = sanitizeDataForPrompt(formatParametersForPrompt(tc));
        const issues = issuesByTestCase.get(String(tc.id)) || [];
        const issuesBlock = issues.length > 0
            ? issues.map((iss, idx) => `${idx + 1}. **${iss.title || 'Замечание'}**: ${iss.message}`).join('\n')
            : 'нет';

        return `
## Тест-кейс ID: ${tc.id}

### Текущее содержимое
ID: ${tc.id}
Название: ${sanitizeDataForPrompt(tc.name || 'не указано')}
Слой: ${tc.layer?.name || 'не указан'}
${paramsBlock ? `### Параметры\n${paramsBlock}\n` : ''}### Предусловия
${sanitizeDataForPrompt(normalizePreconditionForPrompt(tc.precondition) || 'не указаны')}
### Шаги
${sanitizeDataForPrompt(formatStepsForPrompt(stepsToFormat))}

### Ожидаемый результат
${sanitizeDataForPrompt(tc.expectedResult || 'не указан')}

### Ранее выданные замечания
${issuesBlock}
---`;
    }).join('\n');

    const systemContent = `Ты — ведущий QA-инженер. Тебе передали исправленные тест-кейсы и ранее выданные замечания.

# ЗАДАЧА
Для каждого пункта из блока 'Ранее выданные замечания' определи: исправлено / не исправлено / частично исправлено.
- Исправлено — не включай в ответ.
- Не исправлено или частично — создай рекомендацию с тем же title и уточнённой формулировкой.
Если все замечания к тест-кейсу исправлены — верни пустой массив для этого ID.

Работай ТОЛЬКО с замечаниями из списка. Не анализируй другие части тест-кейса. Не добавляй новые проблемы.

# ФОРМАТ ОТВЕТА
JSON. Ключи — ID тест-кейсов. Значения — массивы рекомендаций (или []).
{
  "171010": [
    { "title": "Теги в названии", "recommendation": "Уточненная рекомендация...", "severity": "error", "category": "naming" }
  ],
  "171012": []
}`;

    const userContent = `Тест-кейсы для проверки исправлений:\n\n${casesForPrompt}`;

    console.log(`\n[AI-recheck] SYSTEM:\n${systemContent}`);
    console.log(`USER:\n${userContent}`);
    console.log(`Отправляем запрос...`);

    ensureAILogsDir();
    const jiraPrefix = jiraIssue ? `${jiraIssue}-` : '';
    const batchLabel = totalBatches > 1 ? `batch-${batchIndex + 1}` : 'last';
    const promptFile = path.join(AI_LOGS_DIR, `ai-prompt-recheck-${jiraPrefix}${batchLabel}.txt`);
    fs.writeFileSync(promptFile, `${new Date().toISOString()}\n\n=== SYSTEM ===\n${systemContent}\n\n=== USER ===\n${userContent}`, 'utf8');
    console.log(`Промпт сохранён в ${promptFile}`);

    const API_TOKEN = config.openRouterAiKey;
    if (!API_TOKEN) throw new Error('Не найден OPENROUTER_API_KEY');

    const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
    ];

    const response_format = {
        type: 'json_schema',
        json_schema: {
            name: 'recheck_recommendations',
            description: 'Проверка исправлений замечаний',
            strict: true,
            schema: RECOMMENDATION_RESPONSE_SCHEMA
        }
    };

    const data = await callOpenRouterForAnalyze(messages, apiKey || API_TOKEN, {
        max_tokens: 16000,
        temperature: 0.2,
        response_format
    });
    // const data = await callWithCloudRuFallback(URL, messages, apiKey || API_TOKEN, {
    //     max_tokens: 16000,
    //     temperature: 0.2,
    //     reduceTokensOn400: true,
    //     response_format,
    //     useResponseFormatForCloudRu: true
    // });

    let responseText = '';
    if (data.choices?.[0]?.message?.content) {
        responseText = data.choices[0].message.content.trim();
    } else if (data.text) {
        responseText = data.text.trim();
    }

    if (!responseText) throw new Error('Ответ от модели пустой');

    if (responseText.length > MAX_RESPONSE_LENGTH) {
        console.warn(`[AI-recheck] Длина ответа превышает ${MAX_RESPONSE_LENGTH} (${responseText.length} симв.), обрезаем`);
        responseText = responseText.slice(0, MAX_RESPONSE_LENGTH);
    }

    const responseFile = path.join(AI_LOGS_DIR, `ai-response-recheck-${jiraPrefix}${batchLabel}.txt`);
    fs.writeFileSync(responseFile, `${new Date().toISOString()}\n\n${responseText}`, 'utf8');
    console.log(`Ответ сохранён в ${responseFile}`);

    try {
        const jsonText = extractJSON(responseText);
        let rawRecommendations;
        try {
            rawRecommendations = JSON.parse(jsonText);
        } catch (e) {
            rawRecommendations = JSON.parse(repairJsonCommonErrors(jsonText) || jsonText);
        }
        const { recommendations } = normalizeRecommendations(rawRecommendations, batch);
        return recommendations;
    } catch (parseError) {
        console.error('[AI-recheck] Ошибка парсинга:', parseError.message);
        const fallback = {};
        batch.forEach(tc => { fallback[tc.id] = []; });
        return fallback;
    }
}

/**
 * Строит общий контекст для нескольких батчей
 * Вызывается один раз при totalBatches > 1.
 */
function buildBulkSharedContext (projectId)
{
    return {
        styleGuide: generateStyleGuide(projectId),
        developerContent: createDeveloperContent(loadAllExamples())
    };
}

/**
 * Обрабатывает один батч тест-кейсов (до BATCH_SIZE штук).
 */
async function processBulkBatch (batch, apiKey, jiraIssue, projectId, batchIndex = 0, totalBatches = 1, sharedContext = null)
{
    const STYLE_GUIDE = sharedContext ? sharedContext.styleGuide : generateStyleGuide(projectId);
    const developerContent = sharedContext ? sharedContext.developerContent : createDeveloperContent(loadAllExamples());
    const casesForPrompt = batch.map(tc =>
    {
        const stepsToFormat = tc.stepsRaw || tc.steps;
        const paramsBlock = sanitizeDataForPrompt(formatParametersForPrompt(tc));
        const safeName = sanitizeDataForPrompt(tc.name || 'не указано');
        const safePrecondition = sanitizeDataForPrompt(normalizePreconditionForPrompt(tc.precondition) || 'не указаны');
        const safeSteps = sanitizeDataForPrompt(formatStepsForPrompt(stepsToFormat));
        const safeExpectedResult = sanitizeDataForPrompt(tc.expectedResult || 'не указан');

        return `
ID: ${tc.id}
Название: ${safeName}
Слой: ${tc.layer?.name || 'не указан'}
${paramsBlock ? `### Параметры\n${paramsBlock}\n` : ''}### Предусловия
${safePrecondition}
### Шаги
${safeSteps}

### Ожидаемый результат
${safeExpectedResult}
---`;
    }).join('\n');

    const systemContent = `

# ЗАДАЧА:
Проведи ревью тест-кейсов и проверь соответствие каждого тест-кейса стайлгайду.
Ты не оцениваешь полноту покрытия, не предлагаешь добавить проверки, которых нет в стайлгайде, и не используешь знания о предметной области для оценки ОР.
Для каждого тест-кейса найди:
1. Нарушения стайлгайда;
2. Потенциальные улучшения, которые повысят воспроизводимость или проверяемость теста.

Правила анализа:
- Оценивай предусловие, шаги и ОР в связке — не изолированно;
- Анализируй только то, что явно написано в тест-кейсе; не предполагай внешний контекст;
- Одна рекомендация — одна проблема. Если у тест-кейса несколько нарушений — создай отдельную запись для каждого;
- Если тест полностью соответствует стайлгайду — верни пустой массив для его ID;
- Создавай рекомендацию только если нарушено правило стайлгайда, ИЛИ тест невоспроизводим / непроверяем / логически некорректен;
- Не создавай рекомендацию, если она завершается выводом «Нарушений стайлгайда не обнаружено»;
- Не создавай рекомендации о том, как технически реализовать проверку (инструменты, конкретные команды и т.д.);

Проверь каждый тест-кейс по следующим точкам:
- Тест-кейс атомарный и независимый;
- Один логический ожидаемый результат (может состоять из нескольких пунктов);
- Шаги запускают проверяемое поведение;
- Предусловия описывают состояние системы;
- Слой тестирования соответствует проверке;

Перед тем как создать рекомендацию, ВЫПОЛНИ ВНУТРЕННЮЮ ПРОВЕРКУ: процитируй точный фрагмент текста тест-кейса, который нарушает правило, назови правило, которое нарушено, если все пункты выполнены — создай рекомендацию.
Если не можешь процитировать конкретный фрагмент — рекомендацию НЕ СОЗДАВАЙ.

# ПРИОРИТЕТ
Сначала нарушения, которые делают тест невоспроизводимым или непроверяемым. Если правило применимо неоднозначно — не создавай рекомендацию уровня error.

# SEVERITY
- error: формальные нарушения, без правки которых тест нельзя использовать (нет ОР, неверный слой, шаги не запускают проверку)
- warning: если влияет на воспроизводимость, однозначность или структуру теста. Не используй warning для чисто стилистических или вкусовых замечаний.

# ФОРМАТ ВХОДНЫХ ДАННЫХ
Шаги тест-кейса отформатированы по следующим правилам:
- Основные шаги: нумерованный список (1. 2. 3.)
- Подшаги и шаги внутри общего шага: маркированный список с отступом (   - текст)
- Шаг с пометкой "(общий шаг)" — это ссылка на переиспользуемый блок.
  Его подшаги (строки с отступом и "-") уже атомарны по определению.
- Ожидаемый результат (ОР) шага — всегда блок под шагом:
    Ожидаемый результат:
      - пункт 1
      - пункт 2
- Итоговый ОР тест-кейса — секция "### Ожидаемый результат" в конце
- {{имя}} в предусловиях, шагах или ОР = ссылка на столбец в "###Параметры".  Найди такой столбец и анализируй тест-кейс с учетом его значений;

${STYLE_GUIDE}

# ВАЛИДНЫЕ ПРАКТИКИ — не создавай рекомендацию если:
- Шаг помечен «(общий шаг)» — его подшаги атомарны по определению, не анализируй их как самостоятельные шаги;
- В тексте шага есть GET, POST, PUT, DELETE, PATCH — HTTP-метод указан, рекомендация «нет метода» не нужна;
- {{X}} в шаге, ОР или предусловии — найди столбец X в таблице параметров; если столбец есть и содержит конкретные значения — тест воспроизводим;
- Несколько пунктов в ОР относятся к одному экрану — не требуй разбивки на отдельные тест-кейсы;
- В предусловии есть моки или подмена запросов — допустимо на любом слое включая E2E;
- ОР описывает видимое состояние UI («отображается лоадер», «кнопка задизейблена») — детализация до DOM, CSS-селекторов и координат не требуется;
 - Объединение вариаций сценария (разные кнопки, разные тексты) в одном тест-кейсе через "### Параметры"

${developerContent ? '# АНТИПРИМЕРЫ\n' + developerContent + '\n' : ''}
# CATEGORY
- required_fields — отсутствуют обязательные поля
- naming — проблемы с названием (теги, не отражает суть, начинается с глагола)
- expected_result — отсутствует, непроверяем, субъективен, содержит условия
- steps — неатомарность, условия, проверки внутри шага, не начинается с глагола
- parameters — параметры избыточны или сгруппированы не по Pairwise
- test_scope — нарушение границ слоя
- other — прочее (потенциальные улучшения)

# ФОРМАТ ОТВЕТА:
Верни JSON. Ключи: числовые ID тест-кейсов без префиксов.
Значения: массивы рекомендаций (или [], если рекомендаций нет).
Поле title: краткое название проблемы (2-5 слов).
Поле recommendation: сначала кратко перескажи нарушенное правило, затем предложи конкретное исправление.
Для цитирования параметров пиши «параметр X» или «столбец X из таблицы параметров», не {{X}} — иначе JSON может повредиться.
{
  "171010": [
    {
      "title": "Теги в названии",
      "recommendation": "Удали теги [M] [PWA] из названия — они должны быть в метаданных. Переформулируй: 'Значение поля «Платёж для беспроцентного периода» при задолженности в текущем месяце'",
      "severity": "error",
      "category": "naming"
    }
  ],
  "171012": []
}
`;

    const userContent = `Тест-кейсы для анализа:\n\n${casesForPrompt}`;

    const batchSuffix = totalBatches > 1 ? `-batch-${batchIndex + 1}` : '';
    console.log(`\nМАССОВЫЙ AI-АНАЛИЗ${batchSuffix ? ` (батч ${batchIndex + 1}/${totalBatches})` : ''}:`);
    console.log(`Количество тест-кейсов: ${batch.length}`);
    console.log(`\nДАННЫЕ ДЛЯ AI:\n${casesForPrompt}`);
    console.log(`\nSYSTEM:\n${systemContent}`);
    // TODO: раскомментировать после проверки гипотезы с антипримерами: console.log(developerContent ? `\nDEVELOPER:\n${developerContent}` : '\nDEVELOPER: не передается (примеры отсутствуют)');
    console.log(`\nUSER:\n${userContent}\n\nОтправляем запрос...`);

    ensureAILogsDir();
    const jiraPrefix = jiraIssue ? `${jiraIssue}-` : '';
    const batchLabel = totalBatches > 1 ? `batch-${batchIndex + 1}` : 'last';
    const promptFile = path.join(AI_LOGS_DIR, `ai-prompt-bulk-${jiraPrefix}${batchLabel}.txt`);
    let fullPromptForLog = `=== SYSTEM ===\n${systemContent}`;
    // TODO: раскомментировать после проверки гипотезы с антипримерами: if (developerContent) fullPromptForLog += `\n\n=== DEVELOPER ===\n${developerContent}`;
    fullPromptForLog += `\n\n=== USER ===\n${userContent}`;
    fs.writeFileSync(promptFile, `${new Date().toISOString()}\n\n${fullPromptForLog}`, 'utf8');
    console.log(`Промпт сохранён в ${promptFile}`);

    const API_TOKEN = config.openRouterAiKey;
    if (!API_TOKEN) throw new Error('Не найден OPENROUTER_API_KEY');

    const messages = [{ role: 'system', content: systemContent }];
    // TODO: раскомментировать после проверки гипотезы с антипримерами: if (developerContent) messages.push({ role: 'system', content: developerContent });
    messages.push({ role: 'user', content: userContent });

    const response_format = {
        type: 'json_schema',
        json_schema: {
            name: 'test_case_recommendations',
            description: 'Объект: ключи — ID тест-кейсов, значения — массивы рекомендаций',
            strict: true,
            schema: RECOMMENDATION_RESPONSE_SCHEMA
        }
    };

    const data = await callOpenRouterForAnalyze(messages, apiKey || API_TOKEN, {
        max_tokens: 16000,
        temperature: 0.25,
        response_format
    });
    // const data = await callWithCloudRuFallback(URL, messages, apiKey || API_TOKEN, {
    //     max_tokens: 16000,
    //     temperature: 0.25,
    //     reduceTokensOn400: true,
    //     response_format,
    //     useResponseFormatForCloudRu: true
    // });

    let responseText = '';
    if (data.choices?.[0]?.message?.content) {
        responseText = data.choices[0].message.content.trim();
    } else if (data.text) {
        responseText = data.text.trim();
    }

    if (!responseText) throw new Error('Ответ от модели пустой');

    if (responseText.length > MAX_RESPONSE_LENGTH) {
        console.warn(`[AI-батчинг] Длина ответа превышает ${MAX_RESPONSE_LENGTH} (${responseText.length} симв.), обрезаем`);
        responseText = responseText.slice(0, MAX_RESPONSE_LENGTH);
    }

    const responseFile = path.join(AI_LOGS_DIR, `ai-response-bulk-${jiraPrefix}${batchLabel}.txt`);
    fs.writeFileSync(responseFile, `${new Date().toISOString()}\n\n${responseText}`, 'utf8');
    console.log(`Ответ сохранён в ${responseFile}\n\nОтвет AI:\n${responseText}`);

    try {
        let jsonText = extractJSON(responseText);
        let rawRecommendations;
        try {
            rawRecommendations = JSON.parse(jsonText);
        } catch (firstError) {
            const repaired = repairJsonCommonErrors(jsonText);
            if (repaired !== jsonText) {
                rawRecommendations = JSON.parse(repaired);
            } else {
                throw firstError;
            }
        }
        const { recommendations, rawByKey } = normalizeRecommendations(rawRecommendations, batch);

        console.log(`\nУспешно получены AI-рекомендации для ${Object.keys(recommendations).length} тест-кейсов`);
        console.log(`Ключи в ответе AI: ${Object.keys(rawByKey).map(k => `"${k}" (${typeof k})`).join(', ')}`);
        Object.entries(recommendations).forEach(([id, recs]) =>
        {
            recs.forEach((r, i) =>
            {
                const sev = r.severity === 'error' ? '[ERROR]' : '[WARN]';
                console.log(`  ${id}[${i}]: ${sev} ${(r.recommendation || '').substring(0, 80)}...`);
            });
        });

        console.log(`\nПроверка совпадения ID:`);
        batch.forEach(tc =>
        {
            const tcIdStr = String(tc.id);
            const hasRec = recommendations.hasOwnProperty(tcIdStr) || recommendations.hasOwnProperty(tc.id);
            console.log(`   Тест-кейс "${tcIdStr}" -> Рекомендация: ${hasRec ? '✅' : '❌'}`);
            if (!hasRec) {
                console.log(`      Возможные варианты: ${Object.keys(rawByKey).filter(k => String(k).includes(tcIdStr) || tcIdStr.includes(String(k).replace(/^ID\s*/i, ''))).join(', ')}`);
            }
        });

        return recommendations;

    } catch (parseError) {
        console.error(`\nОшибка парсинга JSON: ${parseError.message}`);
        console.log(`Исходный ответ от AI:\n${responseText}`);

        const errorResponse = {};
        batch.forEach(tc =>
        {
            errorResponse[tc.id] = [{
                recommendation: `Ошибка парсинга AI ответа: ${parseError.message}`,
                severity: 'error',
                category: 'other'
            }];
        });
        return errorResponse;
    }
}

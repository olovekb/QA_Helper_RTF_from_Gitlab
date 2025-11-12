import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import JSON5 from 'json5';
import knex from 'knex';
import { v4 as uuidv4 } from 'uuid';
import compression from 'compression';


/**
 * Обработка больших запросов для OpenRouter через разделение на чанки
 * @param {Array} messages - Исходные сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Объединенный результат
 */
async function processLargeOpenRouterRequest(messages, opts, apiKey) {
    const { model, models, temperature, max_tokens, response_format } = opts;

    // Находим самое большое сообщение (обычно user content)
    let largestMessage = null;
    let largestIndex = -1;
    let maxSize = 0;

    messages.forEach((msg, index) => {
        const size = JSON.stringify(msg.content).length;
        if (size > maxSize) {
            maxSize = size;
            largestMessage = msg;
            largestIndex = index;
        }
    });

    if (!largestMessage || largestIndex === -1) {
        throw new Error('Could not find largest message to split');
    }

    console.log(`[callWithBackoff] Splitting message ${largestIndex} (${maxSize} chars) into chunks...`);

    // Разбиваем большое сообщение на чанки
    const content = largestMessage.content;
    const chunkSize = 80000; // Размер чанка в символах (примерно 20,000 токенов)
    const chunks = [];

    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }

    console.log(`[callWithBackoff] Created ${chunks.length} chunks`);

    // Обрабатываем каждый чанк
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`[callWithBackoff] Processing chunk ${i + 1}/${chunks.length}...`);

        // Создаем копию сообщений с текущим чанком
        const chunkMessages = [...messages];
        chunkMessages[largestIndex] = {
            ...largestMessage,
            content: chunks[i]
        };

        // Добавляем инструкцию для чанка
        if (chunks.length > 1) {
            chunkMessages[largestIndex].content = `ЧАСТЬ ${i + 1} ИЗ ${chunks.length}:\n\n${chunks[i]}`;
        }

        try {
            // Используем прямую отправку без проверки размера
            const chunkResult = await makeDirectOpenRouterCall(chunkMessages, apiKey, {
                model,
                models,
                temperature,
                max_tokens: Math.min(max_tokens, 4000), // Ограничиваем размер ответа
                response_format
            });

            results.push(chunkResult.choices?.[0]?.message?.content || '');
            console.log(`[callWithBackoff] Chunk ${i + 1} processed successfully`);

        } catch (error) {
            console.error(`[callWithBackoff] Chunk ${i + 1} failed:`, error.message);
            results.push(''); // Добавляем пустую строку для неудачного чанка
        }
    }

    // Объединяем результаты
    const combinedContent = results.filter(r => r.trim()).join('\n\n');

    console.log(`[callWithBackoff] Combined ${results.length} chunks into final result (${combinedContent.length} chars)`);

    // Возвращаем результат в формате, ожидаемом вызывающим кодом
    return {
        choices: [{
            message: {
                content: combinedContent
            }
        }],
        usage: {
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil(combinedContent.length / 4),
            total_tokens: Math.ceil((JSON.stringify(messages).length + combinedContent.length) / 4)
        },
        model: model
    };
}

/**
 * Прямой вызов OpenRouter API без проверки размера
 * @param {Array} messages - Сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Результат API
 */
async function makeDirectOpenRouterCall(messages, apiKey, opts) {
    const { model, models, temperature, max_tokens, response_format } = opts;

    const modelQueue = Array.isArray(models) && models.length
        ? models
        : [model, 'qwen/qwen3-235b-a22b:free'];

    const payload = {
        model: modelQueue[0],
        messages,
        temperature,
        max_tokens,
        ...(response_format && { response_format })
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey || config.openRouterAiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://test-inspector.abanking.ru',
            'X-Title': 'Allure Test Inspector'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    return await response.json();
}

import {
    getAllureDefectById,
    getSharedStepsList,
    getStepsForDefect,
    analyzeBugWithAI,
    getAllureDefects,
    linkIssueToAllureDefect,
    getAllTestCases,
    getTestCaseOverview,
    getTestCaseExpectedResult,
    getTestCaseLayer,
    getCaseIssue,
    getCaseTags,
    getTestCasePrecondition,
    getTestCaseStatus,
    getTestCaseSteps,
    getTestCaseCustomFields,
    createTestCaseAllure,
    setTestCaseCustomFieldValues,
    updateTestCase,
    addStepToTestCase,
    linkIssueToTestCase,
    setTestCaseLayer,
    suggestTestLayers,
    getProjectCustomFieldSchema,
    fetchWithAuth,
    suggestTags,
    createTag,
    addParameterToTestCase,
    createTestCaseExamples,
    generatePairwiseExamples
} from './http-service.mjs';
import { spinningLoader } from './spinning-loader.mjs';
import pLimit from 'p-limit';
import { formatTestCase } from './format-testcase.mjs';
import { formatTestCaseAsJson } from './generate-json.mjs';
import { staticAnalysis } from './static-analysis.mjs';
import { exportStructureAllure, exportStructureAllureNocode } from './xmind-parce/export-structure-allure.mjs';
import { analyzeTestCaseWithAI } from './ai-testcase.mjs';
import { fetchConfluencePage } from './confluenceFetcher.mjs';
import { analyzeRequirementWithAI } from './analyzeRequirementWithAI.mjs';
import { Buffer } from 'buffer';
import multer from 'multer';
import axios from 'axios';
import config from './config.json' assert { type: 'json'};
import http from 'http';
import https from 'https';
import { prepareContextWithAI } from './contextRefiner.mjs';
import { callWithCloudRuFallback } from './cloudruClient.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const app = express();
const PORT = 5002;

// Добавляем gzip сжатие для всех ответов
app.use(compression({
    threshold: 1024, // Сжимать файлы больше 1KB
    level: 6, // Уровень сжатия (1-9, 6 оптимальный)
    memLevel: 8, // Использование памяти
    filter: (req, res) => {
        // Сжимаем только JSON ответы
        if (req.path.includes('/api/') && res.get('Content-Type')?.includes('application/json')) {
            return compression.filter(req, res);
        }
        return false;
    }
}));

const db = knex({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: {
        min: 2,
        max: 10
    }
});
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 20 }
});


const corsOptions = {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-OpenRouter-Key'],
    credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.options('*', cors(corsOptions));
const limit = pLimit(100);



// Универсальный рефайнер требований: подтягивает Confluence, сжимает глоссарий/контекст через prepareContextWithAI,
// возвращает совместимый интерфейс: { refinedArray, refinedText }
async function contextRefiner({
    requirements,            // string | string[] | undefined
    text,                    // string | undefined
    pageId,                  // string|number | undefined
    glossary,                // string | undefined
    glossaryPageId,          // string|number | undefined
    context,                 // string | string[] | undefined
    contextPageIds,          // string|string[]|number[] | undefined
    contextInstruction,      // string | undefined
    bearerToken,             // string | undefined
    maxGlossary = 25,        // можно прокидывать из тела запроса
    maxContext = 16         // можно прокидывать из тела запроса
}) {
    const normIds = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map(String).filter(Boolean);
        return String(v).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    };

    // 0) База требований: массив/строка/Confluence pageId
    let baseList = Array.isArray(requirements)
        ? requirements.map(String)
        : [];

    let baseText = String(text || '').trim();

    if (!baseList.length && !baseText && pageId) {
        if (!bearerToken) throw new Error('Для загрузки требования из Confluence нужен bearerToken');
        const { markdown } = await fetchConfluencePage(bearerToken, pageId, { inlineTextAttachments: true });
        baseText = markdown || '';
    }

    if (!baseList.length && baseText) {
        baseList = [baseText];
    }

    // 1) Глоссарий: строка + (опц.) страница
    let glossaryText = glossary || '';
    if (glossaryPageId) {
        if (!bearerToken) throw new Error('Для загрузки глоссария из Confluence нужен bearerToken');
        const { markdown } = await fetchConfluencePage(bearerToken, glossaryPageId, { inlineTextAttachments: true });
        glossaryText = [glossaryText, markdown].filter(Boolean).join('\n\n---\n\n');
    }

    // 2) Доп. контекст: строка ИЛИ массив строк + (опц.) список страниц
    let contextText = normalizeContextInput(context);
    const ctxIds = normIds(contextPageIds);

    if (ctxIds.length) {
        if (!bearerToken) throw new Error('Для загрузки доп. контекста из Confluence нужен bearerToken');
        const blocks = [];
        if (contextInstruction?.trim()) {
            blocks.push(`**Инструкция к доп. контексту:** ${contextInstruction.trim()}\n`);
        }
        for (const cid of ctxIds) {
            try {
                const { markdown } = await fetchConfluencePage(bearerToken, cid, { inlineTextAttachments: true });
                blocks.push(`\n---\n### Доп. контекст: Confluence pageId=${cid}\n\n${markdown}`);
            } catch (e) {
                blocks.push(`\n---\n### Доп. контекст: Confluence pageId=${cid}\n\n(Не удалось загрузить: ${e.message})`);
            }
        }
        contextText = [contextText, blocks.join('\n')].filter(Boolean).join('\n\n');
    }

    // 3) Сжать глоссарий/контекст через prepareContextWithAI (требования — без изменений по смыслу)
    const reqJoined = baseList.length ? baseList.join('\n\n---\n\n') : (baseText || '');
    const { requirements_md, mini_glossary_md, context_md } = await prepareContextWithAI({
        requirements: reqJoined || '',
        glossary: glossaryText || '',
        context: contextText || '',
        contextHint: contextInstruction || '—',
        maxGlossary,
        maxContext
    });

    // 4) Сформировать "шапку" и вернуть в старом формате
    const header = [
        mini_glossary_md && mini_glossary_md.trim() && `# Глоссарий\n${mini_glossary_md.trim()}`,
        context_md && context_md.trim() && `# Контекст\n${context_md.trim()}`
    ].filter(Boolean).join('\n\n');

    const refinedArray = (baseList.length ? baseList : [requirements_md || reqJoined || ''])
        .map(r => [header, r].filter(Boolean).join('\n\n'));

    const refinedText = [header, (requirements_md || reqJoined || '')]
        .filter(Boolean)
        .join('\n\n');

    return { refinedArray, refinedText };
}




// ✅ ВОССТАНОВЛЕНО: функция normalizeModelStructure критически важна для стабильной структуры
function normalizeModelStructure(model) {
    const walk = (arr, depth = 1) => (arr || []).map(item => {
        const out = { ...item };
        if (depth === 1 && Array.isArray(out.stories)) {
            out.stories = walk(out.stories, 2);
        }
        if (depth === 2 && Array.isArray(out.scenarios)) {
            out.scenarios = walk(out.scenarios, 3);
        }
        if (depth === 3) {
            const raw = Array.isArray(out.codes) ? out.codes
                : Array.isArray(out.code) ? out.code
                    : [];
            out.codes = walk(raw, 4);
            if ('code' in out) delete out.code;
        }
        return out;
    });

    // Merge nodes with identical text on the same level (Feature→Story→Scenario→Code)
    const dedupeByText = (features) => {
        const dedupedFeatures = (features || []).map(feature => {
            const stories = feature.stories || [];
            const storyMap = new Map();
            for (const st of stories) {
                const key = String(st.text || '').trim();
                if (!storyMap.has(key)) {
                    storyMap.set(key, { ...st, scenarios: [...(st.scenarios || [])] });
                } else {
                    const slot = storyMap.get(key);
                    // merge scenarios
                    slot.scenarios = [...(slot.scenarios || []), ...(st.scenarios || [])];
                }
            }

            // dedupe scenarios inside each story by text
            const mergedStories = [...storyMap.values()].map(st => {
                const scenMap = new Map();
                for (const sc of (st.scenarios || [])) {
                    const k = String(sc.text || '').trim();
                    if (!scenMap.has(k)) {
                        scenMap.set(k, { ...sc, codes: [...(sc.codes || [])] });
                    } else {
                        const slot = scenMap.get(k);
                        slot.codes = [...(slot.codes || []), ...(sc.codes || [])];
                    }
                }

                // dedupe codes by text
                const mergedScenarios = [...scenMap.values()].map(sc => {
                    const codeMap = new Map();
                    for (const cd of (sc.codes || [])) {
                        const ck = String(cd.text || '').trim();
                        if (!codeMap.has(ck)) {
                            codeMap.set(ck, { ...cd });
                        }
                        // if duplicate code with same text appears, drop it (no extra merge fields expected)
                    }
                    return { ...sc, codes: [...codeMap.values()] };
                });

                return { ...st, scenarios: mergedScenarios };
            });

            return { ...feature, stories: mergedStories };
        });

        return dedupedFeatures;
    };

    const normalized = Array.isArray(model) ? walk(model, 1) : walk([model], 1);
    return dedupeByText(normalized);
}

// Выделение релевантных секций из markdown страницы по ключам из цитаты
function extractRelevantSections(markdown, mentionText, { maxSections = 6, maxChars = 50000 } = {}) {
    const md = String(markdown || '');
    const mention = String(mentionText || '').toLowerCase();
    const tokens = new Set(
        mention
            .replace(/[^a-zA-Zа-яА-Я0-9\s_-]+/g, ' ')
            .split(/\s+/)
            .filter(w => w && w.length > 2)
            .map(w => w.toLowerCase())
    );
    // Разбиваем по секциям заголовков второго уровня и ниже
    const sections = md.split(/\n(?=##+\s)/).map(s => s.trim()).filter(Boolean);
    const scoreSection = (s) => {
        const text = s.toLowerCase();
        let score = 0;
        tokens.forEach(t => { if (text.includes(t)) score += 1; });
        // бонус за точные фразы из кавычек в цитате
        const quoted = Array.from(mention.matchAll(/"([^"]{3,})"/g)).map(m => m[1].toLowerCase());
        quoted.forEach(q => { if (q && text.includes(q)) score += 3; });
        return score;
    };
    const ranked = sections
        .map(s => ({ s, score: scoreSection(s) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSections)
        .map(x => x.s);
    let out = ranked.join('\n\n---\n\n');
    if (out.length > maxChars) out = out.slice(0, maxChars);
    // если ранжирование пустое (нет совпадений) — вернём первые существенные 1-2 секции
    if (!out.trim()) out = sections.slice(0, Math.min(2, sections.length)).join('\n\n---\n\n');
    return out || md.slice(0, Math.min(maxChars, md.length));
}


async function fetchJiraMeta(pat, projectKey) {
    const { data } = await axios.post(
        `${config.serverUrl}/api/jira/meta`,
        { pat, projectKey }
    );
    // data.options = { Severity: [...], Platform: [...], Symptom: [...] }
    return data.options;
}

/**
 * Определяет список кодов платформ по правилу:
 * 1) Если в summary есть префикс "<код> | ..." — берём именно эти коды
 * 2) Иначе смотрим на текст окружения (env) и ищем ключевые слова
 * 3) Иначе — Desktop по умолчанию
 *
 * Коды: 
 *  D    — Desktop/Web
 *  A    — Adaptive
 *  M    — Mobile (iOS/Android)
 *  S    — Backend
 *  PWA  — Progressive Web App
 */
function detectPlatforms(summary, env) {
    const result = [];

    // 1) Парсим префикс из summary: "КОД | остальное"
    if (typeof summary === 'string') {
        const m = summary.trim().match(/^([A-Za-z]{1,3})\s*\|/);
        if (m) {
            const code = m[1].toUpperCase();
            // если PWA — целиком
            if (code === 'PWA') {
                return ['PWA'];
            }
            // иначе разбиваем на символы и фильтруем по допустимым
            for (const ch of code.split('')) {
                if (['D', 'A', 'M', 'S'].includes(ch) && !result.includes(ch)) {
                    result.push(ch);
                }
            }
            if (result.length) {
                return result;
            }
        }
    }

    // 2) Если не нашли в теме — смотрим env
    if (typeof env === 'string') {
        const txt = env.toLowerCase();
        if ((/android|ios/).test(txt)) {
            result.push('M');
        }
        if ((/chrome|firefox|edge|safari|desktop|web/).test(txt)) {
            result.push('D');
        }
        if (txt.includes('adaptive')) {
            result.push('A');
        }
        if (txt.includes('pwa')) {
            result.push('PWA');
        }
        if ((/backend|api/).test(txt)) {
            result.push('S');
        }
        // убираем дубли
        if (result.length) {
            return Array.from(new Set(result));
        }
    }

    // 3) Иначе — Desktop по умолчанию
    return ['D'];
}

function buildFillJiraFieldsTool({ sevOptions, platOptions, sympOptions }) {
    const sevEnum = sevOptions.map(o => o.name);
    const platEnum = platOptions.map(o => o.name);
    const sympEnum = sympOptions.map(o => o.name);

    return {
        type: "function",
        function: {
            name: "fill_jira_fields",
            description: "Верни подобранные значения и тексты для баг-репорта",
            parameters: {
                type: "object",
                properties: {
                    actual: { type: "string", description: "Фактический результат (лаконично, по сути)" },
                    expected: { type: "string", description: "Ожидаемый результат (лаконично, по сути)" },
                    severity: { type: "string", enum: sevEnum },
                    platform: { type: "array", items: { type: "string", enum: platEnum } },
                    symptom: { type: "array", items: { type: "string", enum: sympEnum } }
                },
                required: ["actual", "expected", "severity", "platform", "symptom"],
                additionalProperties: false
            }
        }
    };
}



function extractJsonArray(text) {
    // 1) fenced ```json``` — самый честный путь
    const fence = text.match(/```json\s*([\s\S]*?)```/i);
    if (fence) return fence[1].trim();

    // 2) Собираем все кандидаты «сбалансированных» массивов
    const candidates = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '[') continue;
        let depth = 0, inString = false, esc = false;
        for (let j = i; j < text.length; j++) {
            const ch = text[j];
            if (inString) {
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === '"') { inString = false; continue; }
            } else {
                if (ch === '"') { inString = true; continue; }
                if (ch === '[') depth++;
                if (ch === ']') {
                    depth--;
                    if (depth === 0) {
                        const chunk = text.slice(i, j + 1);
                        candidates.push(chunk);
                        break;
                    }
                }
            }
        }
    }

    // 3) Если найдено несколько массивов, объединяем их
    if (candidates.length > 1) {
        console.log(`[extractJsonArray] Найдено ${candidates.length} JSON массивов, объединяем их`);
        try {
            const allArrays = [];
            for (const candidate of candidates) {
                try {
                    const parsed = JSON5.parse(candidate);
                    if (Array.isArray(parsed)) {
                        allArrays.push(...parsed);
                    }
                } catch (e) {
                    console.warn(`[extractJsonArray] Ошибка парсинга кандидата: ${e.message}`);
                }
            }
            if (allArrays.length > 0) {
                console.log(`[extractJsonArray] Объединено ${allArrays.length} тест-кейсов из ${candidates.length} массивов`);
                return JSON.stringify(allArrays);
            }
        } catch (e) {
            console.warn(`[extractJsonArray] Ошибка объединения массивов: ${e.message}`);
        }
    }

    // 4) Сортируем по «похожести на наши кейсы»
    const score = s =>
        (s.length > 500 ? 3 : 0) +
        (s.includes('{') ? 3 : 0) +
        (/"feature"\s*:/.test(s) ? 2 : 0) +
        (/"story"\s*:/.test(s) ? 1 : 0);

    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0] || null;
}

function cleanupJsonText(s) {
    // Подчистить наиболее частые артефакты
    let t = s;

    // убрать висячие запятые перед } или ]
    t = t.replace(/,\s*(?=[}\]])/g, '');

    // ключи без кавычек → в кавычки
    t = t.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');

    // убрать markdown-комменты // и строки-«пули» в начале строки
    t = t.replace(/^\s*\/\/.*$/gm, '');
    t = t.replace(/^\s*-\s+.*$/gm, '');

    // вырезать мусор до первой '[' и после последней ']'
    const first = t.indexOf('[');
    if (first > 0) t = t.slice(first);
    const last = t.lastIndexOf(']');
    if (last >= 0) t = t.slice(0, last + 1);

    return t.trim();
}


function buildPlatformMap(platOptions) {
    const m = {};
    platOptions.forEach(o => {
        const n = o.name.toLowerCase();
        if (n.includes('desktop') || n.includes('web')) m['D'] = o.id;
        else if (n.includes('adaptive')) m['A'] = o.id;
        else if (n.includes('ios') || n.includes('android')) m['M'] = o.id;
        else if (n.includes('pwa')) m['PWA'] = o.id;
        else if (n.includes('backend')) m['S'] = o.id;
    });
    return m;
}

// Функция фильтрации тест-кейсов
async function filterCases(allCases, jiraIssue, projectId) {
    console.log(`filterCases принял: ${jiraIssue} ${projectId}`)
    const filteredCases = [];

    const promises = allCases.map((testCase) =>
        limit(async () => {
            const { id, name } = testCase;

            // Условие: Связь с Jira
            const issue = await getCaseIssue(id);
            if (!issue.some(issue => issue.name === `${jiraIssue}`)) {
                return; // Пропускаем этот тест-кейс
            }

            // Запускаем запросы параллельно
            const [tags, steps, expectedResult, status, layer, precondition, customFields] = await Promise.all([
                getCaseTags(id),
                getTestCaseSteps(id),
                getTestCaseExpectedResult(id),
                getTestCaseStatus(id),
                getTestCaseLayer(id),
                getTestCasePrecondition(id),
                getTestCaseCustomFields(id, projectId)
            ]);
            filteredCases.push({ id, name, issue, tags, steps, expectedResult, layer, status, precondition, customFields });
        })
    );

    // Ждем завершения всех промисов
    await Promise.all(promises);

    return filteredCases.filter(caseItem => caseItem !== undefined);
}

// API для анализа тест-кейсов
app.post('/api/analyze', async (req, res) => {
    const { projectId, jiraIssue } = req.body;
    console.log(`Запрос /api/analyze получил: ${JSON.stringify(req.body)}`)

    try {
        let spinnerInterval = spinningLoader('Получение всех тест-кейсов проекта...');
        const allCases = await getAllTestCases(projectId);
        clearInterval(spinnerInterval);
        console.log(`Всего кейсов в проекте: ${allCases.length}`);

        // Запускаем анимацию перед фильтрацией
        spinnerInterval = spinningLoader(`Фильтрация тест-кейсов по задаче ${jiraIssue}...`);
        const filteredCases = await filterCases(allCases, jiraIssue, projectId);
        clearInterval(spinnerInterval);
        console.log(`Отсортированные тест-кейсы по выбранной задаче Jira: ${filteredCases.length}`);

        // Форматируем и сохраняем результаты
        let result = '';
        let jsonResult = [];

        for (const caseItem of filteredCases) {
            result += await formatTestCase(caseItem);
            jsonResult.push(await formatTestCaseAsJson(caseItem)); // Ждём результат от каждой функции
        }

        // Вывод результатов
        console.log(result);
        const htmlReport = await staticAnalysis(jsonResult, projectId); // Генерация анализа

        // Возвращаем форматированный результат в ответе
        res.json(htmlReport);

    } catch (error) {
        console.error(`Ошибка: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Запрос на экспорт тестовой модели
app.post('/api/export', async (req, res) => {
    console.log('Вошли в експорт')
    const { allureData, projectId } = req.body; // Получаем JSON с клиента

    console.log({ allureData, projectId })

    if (!allureData || !projectId) {
        return res.status(400).send('Отсутствуют данные для экспорта. Или Id проекта');
    }

    try {
        // Если проект - "Nocode 2.0", то делаем экспорт по новой структуре
        if (projectId === '307') {
            console.log('Экспортируем по новой структуре для НОУКОДА')
            await exportStructureAllureNocode(allureData, projectId);
        } else {
            console.log('Экспортируем НЕ для НОУКОДА')
            await exportStructureAllure(allureData, projectId);
        }

        res.status(200).send('Экспорт успешно завершён.');
    } catch (error) {
        console.error('Ошибка экспорта:', error.message);

        res.status(500).send('Ошибка при экспорте.');
    }
});

app.post('/api/ai-recommendation', async (req, res) => {
    try {
        // Получаем OpenRouter API Key из header (с фоллбэком на config)
        const apiKey = req.headers['x-openrouter-key']?.trim() || config.openRouterAiKey;

        let testCase = req.body;

        if (!testCase.id) {
            throw new Error('Отсутствует id тест-кейса');
        }
        if (!testCase.projectId) {
            throw new Error('Отсутствует projectId');
        }

        console.log('Запрос рекомендации для тест-кейса:', testCase.id);

        // Если некоторые поля отсутствуют, дополняем их
        if (!testCase.steps || !testCase.expectedResult) {
            const id = testCase.id;
            const projectId = testCase.projectId;
            const [
                tags,
                steps,
                expectedResult,
                status,
                layer,
                precondition,
                customFields,
                issue
            ] = await Promise.all([
                getCaseTags(id),
                getTestCaseSteps(id),
                getTestCaseExpectedResult(id),
                getTestCaseStatus(id),
                getTestCaseLayer(id),
                getTestCasePrecondition(id),
                getTestCaseCustomFields(id, projectId),
                getCaseIssue(id)
            ]);
            // Обновляем объект, сохраняя все поля, что пришли от клиента и дополняем недостающие.
            testCase = {
                ...testCase,
                tags,
                steps,
                expectedResult,
                status,
                layer,
                precondition,
                customFields,
                issue,
                projectId
            };
        }

        // Если поле name отсутствует, делаем запрос на overview и извлекаем name
        if (!testCase.name) {
            try {
                const overviewData = await getTestCaseOverview(testCase.id);
                // Предполагаем, что overviewData содержит поле name
                testCase.name = overviewData.name || "Неизвестно";
            } catch (error) {
                console.error('Ошибка при получении overview тест-кейса:', error.message);
                testCase.name = "Неизвестно";
            }
        }

        // Вызываем функцию анализа тест-кейса с использованием ИИ
        const recommendation = await analyzeTestCaseWithAI(testCase, apiKey);
        res.json({ recommendation });
    } catch (error) {
        console.error('Ошибка в /ai-recommendation:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/** Строка/массив -> массив pageId */
function normalizePageIds(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    return String(v)
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

/** Строка или массив строк -> единый markdown-блок с разделителями */
function normalizeContextInput(v) {
    if (!v) return '';
    if (Array.isArray(v)) {
        return v
            .map(s => String(s || '').trim())
            .filter(Boolean)
            .join('\n\n---\n\n');
    }
    return String(v);
}


/**
 * POST /api/analyze/solution
 * Тело: { text?: string, pageId?: string|number, context?: string, project?: string,
 *         glossary?: string, bearerToken?: string,
 *         glossaryPageId?: string|number,
 *         contextPageIds?: string|string[]|number[],
 *         contextInstruction?: string }
 */
app.post('/api/analyze/solution', async (req, res) => {
    try {
        const {
            text, pageId, context, project, glossary, bearerToken,
            glossaryPageId,
            contextPageIds,
            contextInstruction
        } = req.body;

        // Получаем OpenRouter API Key из header (с фоллбэком на config)
        const apiKey = req.headers['x-openrouter-key']?.trim() || config.openRouterAiKey;

        if (!text && !pageId) {
            return res.status(400).json({ success: false, error: 'Параметр text или pageId обязателен.' });
        }

        // 1) Основное требование
        let requirementText = text;
        let collectedAttachments = [];

        if (pageId) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для получения страницы Confluence требуется bearerToken' });
            }
            const { markdown, attachments } = await fetchConfluencePage(bearerToken, pageId);
            requirementText = markdown;
            collectedAttachments = attachments || [];
            // AUTO-CONTEXT: извлечь ссылки вида ...pageId=123456 из основной статьи и подтянуть их как дополнительный контекст (без рекурсии)
            try {
                const linkedIds = new Set(
                    Array.from(String(markdown || '').matchAll(/pageId=(\d{4,})/g)).map(m => m[1])
                );
                // не включаем саму страницу
                linkedIds.delete(String(pageId));
                if (linkedIds.size) {
                    // подготовим список markdown‑блоков для contextPages
                    const autoCtx = [];
                    const autoIds = new Set();
                    for (const lid of linkedIds) {
                        try {
                            const { markdown: md } = await fetchConfluencePage(bearerToken, lid, { inlineTextAttachments: true });
                            if (autoIds.has(String(lid))) continue;
                            // найдём строку(и) в основной статье, где эта ссылка упомянута, чтобы сохранить семантику отсылки
                            const lines = String(markdown || '').split(/\n/);
                            const refIdx = lines.findIndex(l => l.includes(`pageId=${lid}`));
                            let mention = '';
                            if (refIdx !== -1) {
                                const start = Math.max(0, refIdx - 2);
                                const end = Math.min(lines.length, refIdx + 3);
                                mention = lines.slice(start, end).join('\n').trim();
                            }
                            autoCtx.push([
                                `### Контекст по ссылке из основной статьи (pageId=${lid})`,
                                mention ? `> Упоминание в основной статье:\n> ${mention.replace(/\n/g, '\n> ')}` : `> Упоминание в основной статье: не найдено (pageId=${lid})`,
                                '',
                                md
                            ].join('\n'));
                            autoIds.add(String(lid));
                        } catch (e) {
                            autoCtx.push(`### Контекст: ссылка из основной статьи (pageId=${lid})\n\n(Не удалось загрузить: ${e.message})`);
                        }
                    }
                    // временно положим в специальное поле, далее сольём с user contextPages ниже
                    req._autoExtractedContextPages = autoCtx;
                    req._autoExtractedContextIds = Array.from(autoIds);
                }
            } catch (e) {
                console.warn('Auto-context extraction failed:', e.message);
            }
        }

        // 2) Глоссарий
        let glossaryText = glossary || '';
        if (glossaryPageId) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для загрузки глоссария из Confluence требуется bearerToken' });
            }
            try {
                const { markdown } = await fetchConfluencePage(bearerToken, glossaryPageId, { inlineTextAttachments: true });
                glossaryText = markdown;
            } catch (e) {

                throw new Error(`Не удалось получить глоссарий из Confluence (pageId=${glossaryPageId}): ${e.message}`);
            }
        }

        let contextText = normalizeContextInput(context);
        const ctxIds = normalizePageIds(contextPageIds);
        const contextPages = [];

        if (ctxIds.length) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для загрузки доп. контекста из Confluence требуется bearerToken' });
            }

            const skipIds = new Set((req._autoExtractedContextIds || []).map(String));
            for (const raw of ctxIds) {
                const cid = String(raw);
                if (skipIds.has(cid)) continue;
                try {
                    const { markdown } = await fetchConfluencePage(bearerToken, cid, { inlineTextAttachments: true });

                    contextPages.push(markdown);
                } catch (e) {

                    contextPages.push(`Confluence pageId=${cid}\n\n(Не удалось загрузить: ${e.message})`);
                }
            }
        }

        // 4) Анализ (с префильтром)
        // Подсказка для AI: поясняем, что contextPages получены из ссылок исходного требования
        const extraHint = (Array.isArray(req._autoExtractedContextPages) && req._autoExtractedContextPages.length)
            ? 'Контекстные страницы ниже получены по ссылкам из исходного требования. Используй из них только факты, непосредственно разъясняющие ссылки в тексте требования (без домыслов и расширений).'
            : '';

        const aiResponse = await analyzeRequirementWithAI(
            requirementText,
            // более глубокий контекст: склеим user context + релевантные страницы
            [contextText, (req._autoExtractedContextPages || []).join('\n\n')].filter(Boolean).join('\n\n'),
            project,
            glossaryText,
            {
                prefilter: true,
                contextHint: [contextInstruction || '—', extraHint].filter(Boolean).join(' '),
                contextPages
            },
            apiKey // передаём пользовательский API ключ
        );

        const result = {
            ai: { success: true, response: aiResponse },
            attachments: collectedAttachments.length ? collectedAttachments : undefined
        };

        return res.json({ success: true, data: result });

    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});


app.post('/api/jira/create-issue', async (req, res) => {
    const { pat, payload } = req.body;

    if (!pat || !payload) {
        return res.status(400).json({ error: 'PAT и payload обязательны' });
    }

    // Логируем входящий payload
    console.log('Входящий payload:', JSON.stringify(payload, null, 2));

    // Проверка обязательных полей в payload
    const requiredFields = ['project', 'issuetype', 'summary', 'description'];
    const missingFields = requiredFields.filter(field => !payload.fields || !payload.fields[field]);
    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Отсутствуют обязательные поля: ${missingFields.join(', ')}` });
    }

    const jiraBaseUrl = 'https://jira.abanking.ru';
    try {
        // Логируем тело запроса перед отправкой
        console.log('Отправляемый payload в Jira:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${jiraBaseUrl}/rest/api/2/issue`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pat}`,
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('Ответ от Jira:', JSON.stringify(data, null, 2));
            throw new Error(
                data.errorMessages?.join(', ') ||
                Object.keys(data.errors || {})
                    .map(key => `${key}: ${data.errors[key]}`)
                    .join(', ') ||
                'Неизвестная ошибка'
            );
        }
        res.json({ success: true, key: data.key });
    } catch (err) {
        console.error('Ошибка при создании задачи в Jira:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// Эндпоинт для получения метаданных проекта (поля, пользователи, версии)
app.post('/api/jira/meta', async (req, res) => {
    const jiraBase = 'https://jira.abanking.ru';
    const issueKey = 'NPP-15541';               // берём из вашего CURL
    const { pat, projectKey } = req.body;     // передаёте с фронта

    if (!pat || !projectKey) {
        return res.status(400).json({ error: 'PAT и projectKey обязательны' });
    }

    const headers = {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json'
    };

    try {
        // 1) Получаем метаданные полей для указанного issueKey
        const editRes = await fetch(
            `${jiraBase}/rest/api/2/issue/${encodeURIComponent(issueKey)}/editmeta`,
            { headers }
        );
        if (!editRes.ok) {
            throw new Error(`editmeta вернул ${editRes.status}`);
        }
        const { fields } = await editRes.json();

        // сопоставление UI-ключа → имя поля в Jira
        const customFieldNames = {
            Severity: 'Серьезность ошибки',
            Symptom: 'Симптом',
            Platform: 'Платформа',
            ProdBug: 'Баг с прода',
            'Epic Link': 'Epic Link',
            'Основной исполнитель': 'Основной исполнитель',
            'Ревьюеры': 'Ревьюеры'
        };

        const options = {};
        const fieldIds = {};

        // 2) Извлекаем id полей и их опции
        for (const [key, jiraName] of Object.entries(customFieldNames)) {
            const entry = Object.entries(fields)
                .find(([_, meta]) => meta.name === jiraName);

            if (!entry) {
                console.warn(`[META] Поле "${jiraName}" не найдено в editmeta`);
                options[key] = [];
                continue;
            }

            const [fieldId, meta] = entry;
            fieldIds[key] = fieldId;
            options[key] = (meta.allowedValues || []).map(o => ({
                id: String(o.id),
                name: o.value ?? o.name
            }));
        }
        // return res.json({ options, fieldIds, users, versions });
        return res.json({ options, fieldIds })
    }
    catch (err) {
        console.error('Ошибка /jira/meta:', err);
        return res.status(500).json({ error: err.message });
    }
});


// 1. Поиск assignable пользователей
app.get('/api/jira/users', async (req, res) => {
    const { projectKey, pat, query = '', startAt = 0, maxResults = 50 } = req.query;
    const jiraBase = 'https://jira.abanking.ru';
    const headers = {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json'
    };

    const url = `${jiraBase}/rest/api/2/user/assignable/search`
        + `?project=${encodeURIComponent(projectKey)}`
        + `&username=${encodeURIComponent(query)}`
        + `&startAt=${startAt}`
        + `&maxResults=${maxResults}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) return res.status(resp.status).end();
    const users = await resp.json();
    return res.json(users);
});

// 2. Поиск версий (фильтрация по имени)
app.get('/api/jira/versions', async (req, res) => {
    const { projectKey, pat, query = '' } = req.query;
    const jiraBase = 'https://jira.abanking.ru';
    const headers = {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json'
    };

    // Получаем все версии разом (они обычно меньше 1000)...
    const all = await fetch(
        `${jiraBase}/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`,
        { headers }
    ).then(r => r.ok ? r.json() : []);

    // ...а потом фильтруем по подстроке и отдаем первые 50
    const filtered = all
        .filter(v => v.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 50);

    return res.json(filtered);
});

// GET /jira/transitions?issueKey=JMT-123
app.get('/api/jira/transitions', async (req, res) => {
    const { pat, issueKey } = req.query;
    if (!pat || !issueKey) {
        return res.status(400).json({ error: 'Нужны pat и issueKey' });
    }
    try {
        const response = await fetch(
            `https://jira.abanking.ru/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
            {
                headers: {
                    'Authorization': `Bearer ${pat}`,
                    'Accept': 'application/json'
                }
            }
        );
        if (!response.ok) throw new Error(`Jira вернула ${response.status}`);
        const { transitions } = await response.json();
        // вернём только id + name для селекта
        const ops = transitions.map(t => ({ id: t.id, name: t.name }));
        res.json(ops);
    } catch (err) {
        console.error('Ошибка /jira/transitions:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/jira/transition-issues', async (req, res) => {
    let { pat, issueKeys, issueKey, transitionId } = req.body;

    // если пришёл одиночный issueKey, упакуем его в массив
    if (!issueKeys && issueKey) {
        issueKeys = [issueKey];
    }

    if (!pat || !Array.isArray(issueKeys) || !transitionId) {
        return res
            .status(400)
            .json({ error: 'Нужны pat, issueKeys и transitionId' });
    }

    const results = [];
    for (const key of issueKeys) {
        try {
            const r = await fetch(
                `https://jira.abanking.ru/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${pat}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ transition: { id: transitionId } })
                }
            );
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.errorMessages?.join(', ') || r.statusText);
            }
            results.push({ key, success: true });
        } catch (err) {
            console.error(`Transition ${key}:`, err);
            results.push({ key, success: false, error: err.message });
        }
    }

    res.json(results);
});

// GET /allure/defects
app.get('/api/allure/defects', async (req, res) => {
    try {
        const { projectId, query, page, size } = req.query;
        const defects = await getAllureDefects(projectId, query, page, size);
        res.json(defects);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST /allure/defect/:defectId/issue
app.post('/api/allure/defect/:defectId/issue', async (req, res) => {
    const { defectId } = req.params;
    const { integrationId, name } = req.body;
    if (!defectId || !integrationId || !name) {
        return res.status(400).json({ error: 'Нужны defectId, integrationId и name' });
    }
    try {
        const result = await linkIssueToAllureDefect(defectId, integrationId, name);
        res.json(result);
    } catch (err) {
        console.error('Allure POST link issue failed:', err);
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/bug/ai-review', async (req, res) => {
    const task = req.body.task || req.body.testCase;
    if (!task || typeof task !== 'object') {
        return res.status(400).json({ error: 'Нужен объект task' });
    }

    // Получаем OpenRouter API Key из header (с фоллбэком на config)
    const apiKey = req.headers['x-openrouter-key']?.trim() || config.openRouterAiKey;

    try {
        const feedback = await analyzeBugWithAI(task, apiKey);
        return res.json(feedback);
    } catch (err) {
        console.error('AI-review error:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/allure/defect/:defectId/details', async (req, res) => {
    try {
        const defectId = req.params.defectId;
        if (!defectId) return res.status(400).json({ error: 'Нужен defectId' });

        const defect = await getAllureDefectById(defectId);
        const steps = await getStepsForDefect(defectId);

        // возвращаем описание дефекта в поле description и шаги
        res.json({
            name: defect.name || '',
            description: defect.description || '',
            steps
        });
    } catch (err) {
        console.error('Error /allure/defect/:id/details:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/jira/issue/picker', async (req, res) => {
    const { pat, query } = req.query;
    if (!pat) {
        return res.status(400).json({ error: 'pat is required' });
    }

    try {
        // Собираем URL с query-параметром
        const url = new URL('https://jira.abanking.ru/rest/api/2/issue/picker');
        if (query) {
            url.searchParams.set('query', query);
        }

        // Делаем запрос в Jira
        const response = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${pat}`,
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            // Если Jira вернула ошибку — отдаём её клиенту
            const errBody = await response.json().catch(() => ({}));
            const msg = errBody.errorMessages?.join(',') || response.statusText;
            return res.status(response.status).json({ error: msg });
        }

        // Парсим результат
        const data = await response.json();
        const issues = (data.sections || [])
            .flatMap(section => section.issues || [])
            .map(i => ({
                key: i.key,
                name: i.name,
                summary: i.summary
            }));

        return res.json(issues);
    }
    catch (err) {
        console.error('Error fetching issue picker:', err);
        return res
            .status(500)
            .json({ error: err.message || 'Unknown error' });
    }
});

// GET /api/jira/issueLinkTypes — вернуть все типы связей из Jira
app.get('/api/jira/issueLinkTypes', async (req, res) => {
    const { pat } = req.query;
    if (!pat) {
        return res.status(400).json({ error: 'pat is required' });
    }
    try {
        const response = await fetch(
            `https://jira.abanking.ru/rest/api/2/issueLinkType`,
            { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' } }
        );
        if (!response.ok) throw new Error(`Jira returned ${response.status}`);
        const data = await response.json();
        res.json(data.issueLinkTypes);
    } catch (err) {
        console.error('Ошибка /api/jira/issueLinkTypes:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/jira/issueLink — связать две задачи
app.post('/api/jira/issueLink', async (req, res) => {
    const { pat, typeName, inwardIssueKey, outwardIssueKey } = req.body;
    if (!pat || !typeName || !inwardIssueKey || !outwardIssueKey) {
        return res.status(400).json({
            error: 'pat, typeName, inwardIssueKey and outwardIssueKey are required'
        });
    }
    try {
        const response = await fetch(
            `https://jira.abanking.ru/rest/api/2/issueLink`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${pat}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: { name: typeName },
                    inwardIssue: { key: inwardIssueKey },
                    outwardIssue: { key: outwardIssueKey }
                })
            }
        );
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.errorMessages?.join(',') || response.statusText);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/jira/issueLink:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post(
    '/api/jira/issue/:issueKey/attachments',
    upload.array('file'),
    async (req, res) => {
        const auth = req.headers.authorization;
        const { issueKey } = req.params;
        const form = new (await import('form-data')).default();

        for (const file of req.files) {

            const correctName = Buffer
                .from(file.originalname, 'latin1')
                .toString('utf8');

            form.append('file', file.buffer, {
                filename: correctName,
                contentType: file.mimetype
            });
        }

        try {
            const headers = {
                ...form.getHeaders(),
                'X-Atlassian-Token': 'no-check',
                Authorization: auth
            };
            const jiraRes = await axios.post(
                `https://jira.abanking.ru/rest/api/2/issue/${encodeURIComponent(issueKey)}/attachments`,
                form,
                { headers }
            );
            return res.json(jiraRes.data);
        } catch (err) {
            console.error('Jira attachments error:', err);
            return res
                .status(err.response?.status || 500)
                .json({ error: err.response?.data || err.message });
        }
    }
);

// Обновление полей задачи (например, description с маркерами !file.png!)
app.put('/api/jira/issue/:issueKey', async (req, res) => {
    const { issueKey } = req.params;
    const { pat, payload } = req.body;   // payload ожидаем вида { fields: { description: desc, ... } }

    if (!pat) {
        return res.status(400).json({ error: 'PAT is required' });
    }
    if (!payload || typeof payload !== 'object' || !payload.fields) {
        return res.status(400).json({ error: 'payload.fields is required' });
    }

    const jiraBaseUrl = 'https://jira.abanking.ru';
    try {
        // Проксируем PUT в Jira
        const response = await fetch(
            `${jiraBaseUrl}/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${pat}`,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const msg =
                errBody.errorMessages?.join(',') ||
                JSON.stringify(errBody) ||
                response.statusText;
            return res.status(response.status).json({ error: msg });
        }

        // PUT возвращает 204 No Content, но мы можем отдать успех:
        return res.json({ success: true });
    } catch (err) {
        console.error(`Error updating issue ${issueKey}:`, err);
        return res.status(500).json({ error: err.message });
    }
});


app.post('/api/jira/ai-fill-fields', async (req, res) => {
    try {
        const { summary, description, steps, stand, env, pat, projectKey } = req.body;
        if (!pat || !projectKey) {
            return res.status(400).json({ error: 'pat и projectKey обязательны' });
        }
        const stepsStr = Array.isArray(steps) ? steps.join('\n- ') : (steps ?? '');
        // 1) Метаданные JIRA
        const options = await fetchJiraMeta(pat, projectKey);
        const { Severity: sevOptions, Platform: platOptions, Symptom: sympOptions } = options;

        // 2) Хелперы маппинга → id
        const nameToId = (arr, name) =>
            (arr || []).find(o => o.name.toLowerCase() === String(name || '').toLowerCase())?.id || null;
        const namesToIds = (arr, names) => {
            const set = new Set((names || []).map(n => String(n || '').toLowerCase()));
            return (arr || [])
                .filter(o => set.has(String(o.name).toLowerCase()))
                .map(o => o.id);
        };

        // 3) Базовый эвристический fallback платформ (как у тебя было)
        const platMap = buildPlatformMap(platOptions);
        const detectedCodes = detectPlatforms(summary, env);
        let detectedPlatformIds = [];
        if (detectedCodes.length === 1 && detectedCodes[0] === 'M') {
            const txt = (env || '').toLowerCase();
            let opt = null;
            if (txt.includes('android')) {
                opt = platOptions.find(o => o.name.toLowerCase().includes('native-android'));
            } else if (txt.includes('ios')) {
                opt = platOptions.find(o => o.name.toLowerCase().includes('native-ios'));
            }
            if (!opt) {
                opt = platOptions.find(o => o.name.toLowerCase().includes('native-android'));
            }
            if (opt) detectedPlatformIds = [opt.id];
        } else {
            detectedPlatformIds = detectedCodes.map(c => platMap[c]).filter(Boolean);
        }

        // 4) Промпт
        const prompt = `
Ты — эксперт по баг-репортам. На основе входных данных выбери severity, platform и symptom строго из переданных списков (ничего своего не выдумывай), а также сгенерируй короткие, точные actual/expected.

Критерии:
- severity: оцени реальное влияние (см. справку ниже), выбирай один вариант.
- platform/symptom: выбери 1..N из справочника, если применимо.
- actual/expected: лаконично, без воды, по сути — 1–3 предложения.

Справка по Severity:
- Критическая — блокировка ключевого функционала, потеря/утечка данных.
- Высокая — ощутимые неудобства многим пользователям.
- Средняя — слабое влияние, есть обходные пути.
- Низкая — не влияет на основные сценарии.

Доступные значения:
- severity: ${sevOptions.map(x => x.name).join(', ')}
- platform: ${platOptions.map(x => x.name).join(', ')}
- symptom: ${sympOptions.map(x => x.name).join(', ')}

Входные данные:
SUMMARY: ${summary}
DESCRIPTION: ${description}
STEPS: ${stepsStr}
STAND: ${stand}
ENV: ${env}
`.trim();

        // 5) Вызов модели с tool-calling
        const tools = [buildFillJiraFieldsTool({ sevOptions, platOptions, sympOptions })];
        const ai = await callWithCloudRuFallback(
            OPENROUTER_URL,
            [
                { role: 'system', content: 'Ты возвращаешь строго структурированный ответ через function call.' },
                { role: 'user', content: prompt }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "fill_jira_fields" } },
                temperature: 0,
                top_p: 0.95,
                extra: { transforms: 'middle-out' }
            }
        );

        // 6) Извлекаем tool args; если нет — фолбэк на текст
        let args = extractToolArgs(ai, "fill_jira_fields");
        if (!args) {
            const content = ai.choices?.[0]?.message?.content || '';
            const m = content.match(/\{[\s\S]*\}/);
            if (!m) throw new Error('AI не вернул JSON/ToolCall');
            args = JSON5.parse(m[0]);
        }

        // 7) Приводим к ID
        const severityId = nameToId(sevOptions, args.severity);
        const platformIdsByName = namesToIds(platOptions, args.platform);
        const symptomIds = namesToIds(sympOptions, args.symptom);

        // 8) Платформы: если AI не выбрал ничего валидного — берём fallback
        const platform = platformIdsByName.length ? platformIdsByName : detectedPlatformIds;

        // 9) Ответ
        return res.json({
            actual: args.actual,
            expected: args.expected,
            severity: severityId,  // одно значение (id)
            platform,              // массив id
            symptom: symptomIds    // массив id
        });

    } catch (e) {
        console.error('AI fill error:', e);
        return res.status(500).json({ error: e.message });
    }
});



function extractToolArgs(aiResponse, preferredFnName) {
    try {
        console.log(`[extractToolArgs] 🔍 Начинаем извлечение args для функции: ${preferredFnName}`);

        // СНАЧАЛА проверяем tool_calls (для Cloud.ru и OpenRouter)
        const toolCalls = aiResponse.choices?.[0]?.message?.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
            console.log(`[extractToolArgs] Найдено ${toolCalls.length} tool_calls`);

            // Ищем нужный tool по имени
            const targetTool = toolCalls.find(tc => tc.function?.name === preferredFnName);

            if (targetTool) {
                console.log(`[extractToolArgs] Найден tool: ${preferredFnName}`);

                try {
                    const args = JSON.parse(targetTool.function.arguments);
                    console.log(`[extractToolArgs] ✅ Успешно распарсены аргументы, ключи:`, Object.keys(args));
                    return args;
                } catch (parseErr) {
                    console.error(`[extractToolArgs] ❌ Ошибка парсинга arguments:`, parseErr.message);
                    console.error(`[extractToolArgs] Raw arguments:`, targetTool.function.arguments);

                    // Попробуем JSON5
                    try {
                        const args = JSON5.parse(targetTool.function.arguments);
                        console.log(`[extractToolArgs] ✅ Успешно распарсены аргументы через JSON5, ключи:`, Object.keys(args));
                        return args;
                    } catch (json5Err) {
                        console.error(`[extractToolArgs] ❌ JSON5 тоже не сработал:`, json5Err.message);
                        return null;
                    }
                }
            } else {
                console.warn(`[extractToolArgs] ⚠️ Tool "${preferredFnName}" не найден среди:`,
                    toolCalls.map(tc => tc.function?.name));

                // Возьмем первый доступный tool
                const firstTool = toolCalls[0];
                console.log(`[extractToolArgs] Используем первый доступный tool: ${firstTool.function?.name}`);

                try {
                    const args = JSON.parse(firstTool.function.arguments);
                    console.log(`[extractToolArgs] ✅ Успешно распарсены аргументы первого tool, ключи:`, Object.keys(args));
                    return args;
                } catch (parseErr) {
                    console.error(`[extractToolArgs] ❌ Ошибка парсинга arguments первого tool:`, parseErr.message);
                    return null;
                }
            }
        }

        // ЗАТЕМ проверяем content (fallback для моделей без tool_calls)
        const content = aiResponse.choices?.[0]?.message?.content;

        if (content) {
            console.log(`[extractToolArgs] tool_calls не найдены, пробуем парсить content (${content.length} символов)`);

            // ✅ УЛУЧШЕННЫЙ парсинг JSON с обработкой ошибок
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                content.match(/```\s*([\s\S]*?)\s*```/) ||
                content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                let jsonText = jsonMatch[1] || jsonMatch[0];

                // ✅ ИСПРАВЛЕНИЕ: Очистка и валидация JSON
                jsonText = jsonText.trim();

                // Попытка исправить распространенные ошибки JSON
                try {
                    // Убираем лишние символы в конце
                    jsonText = jsonText.replace(/,\s*\]\s*$/, ']');
                    jsonText = jsonText.replace(/,\s*\}\s*$/, '}');

                    const parsed = JSON.parse(jsonText);
                    console.log(`[extractToolArgs] ✅ Успешно распарсен JSON из content`);
                    return parsed;
                } catch (parseErr) {
                    console.error(`[extractToolArgs] ❌ Ошибка парсинга JSON из content:`, parseErr.message);

                    // ✅ АГРЕССИВНАЯ ОЧИСТКА: Попытка исправить JSON
                    try {
                        console.log(`[extractToolArgs] 🔧 Попытка исправить JSON (${jsonText.length} символов)...`);

                        // 1) Если JSON слишком большой (>100KB), обрезаем его
                        if (jsonText.length > 100000) {
                            console.log(`[extractToolArgs] 🔧 JSON слишком большой (${jsonText.length} символов), обрезаем до 100KB`);
                            jsonText = jsonText.substring(0, 100000);

                            // Находим последний полный объект/массив
                            const lastCompleteBrace = jsonText.lastIndexOf('}');
                            const lastCompleteBracket = jsonText.lastIndexOf(']');
                            const cutPos = Math.max(lastCompleteBrace, lastCompleteBracket);

                            if (cutPos > 0) {
                                jsonText = jsonText.substring(0, cutPos + 1);
                                console.log(`[extractToolArgs] 🔧 Обрезано до позиции ${cutPos + 1}`);
                            }
                        }

                        // 2) Убираем все после последней закрывающей скобки/кавычки
                        const lastBrace = jsonText.lastIndexOf('}');
                        const lastBracket = jsonText.lastIndexOf(']');
                        const lastQuote = jsonText.lastIndexOf('"');

                        const cutPos = Math.max(lastBrace, lastBracket, lastQuote);
                        if (cutPos > 0) {
                            jsonText = jsonText.substring(0, cutPos + 1);
                            console.log(`[extractToolArgs] 🔧 Обрезано до позиции ${cutPos + 1}`);
                        }

                        // 2) Убираем trailing commas
                        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

                        // 3) Попытка найти и исправить незакрытые массивы/объекты
                        let openBraces = (jsonText.match(/\{/g) || []).length;
                        let closeBraces = (jsonText.match(/\}/g) || []).length;
                        let openBrackets = (jsonText.match(/\[/g) || []).length;
                        let closeBrackets = (jsonText.match(/\]/g) || []).length;

                        // Добавляем недостающие закрывающие скобки
                        while (openBraces > closeBraces) {
                            jsonText += '}';
                            closeBraces++;
                        }
                        while (openBrackets > closeBrackets) {
                            jsonText += ']';
                            closeBrackets++;
                        }

                        console.log(`[extractToolArgs] 🔧 Исправлено: {${openBraces}/${closeBraces}}, [${openBrackets}/${closeBrackets}]`);

                        const cleanedParsed = JSON.parse(jsonText);
                        console.log(`[extractToolArgs] ✅ Успешно исправлен и распарсен JSON`);
                        return cleanedParsed;
                    } catch (cleanErr) {
                        console.error(`[extractToolArgs] ❌ Не удалось исправить JSON:`, cleanErr.message);

                        // ✅ ПОСЛЕДНЯЯ ПОПЫТКА: Извлекаем только валидную часть
                        try {
                            // Ищем последний валидный объект в массиве
                            const arrayMatch = jsonText.match(/\[[\s\S]*$/);
                            if (arrayMatch) {
                                const arrayContent = arrayMatch[0];
                                // Ищем все валидные объекты до ошибки
                                const validObjects = [];
                                let currentPos = 1; // после '['

                                while (currentPos < arrayContent.length) {
                                    const nextComma = arrayContent.indexOf(',', currentPos);
                                    const nextBrace = arrayContent.indexOf('}', currentPos);

                                    if (nextBrace === -1) break;

                                    const objEnd = nextComma !== -1 && nextComma < nextBrace ? nextComma : nextBrace;
                                    const objText = arrayContent.substring(currentPos, objEnd + 1).trim();

                                    if (objText.startsWith('{') && objText.endsWith('}')) {
                                        try {
                                            const obj = JSON.parse(objText);
                                            validObjects.push(obj);
                                            console.log(`[extractToolArgs] 🔧 Извлечен валидный объект: ${obj.text?.substring(0, 50)}...`);
                                        } catch (e) {
                                            console.log(`[extractToolArgs] 🔧 Пропущен невалидный объект`);
                                        }
                                    }

                                    currentPos = objEnd + 1;
                                }

                                if (validObjects.length > 0) {
                                    console.log(`[extractToolArgs] ✅ Извлечено ${validObjects.length} валидных объектов`);
                                    return validObjects;
                                }
                            }
                        } catch (extractErr) {
                            console.error(`[extractToolArgs] ❌ Не удалось извлечь валидные объекты:`, extractErr.message);
                        }
                    }
                }
            }
        }

        // ✅ ПОСЛЕДНИЙ FALLBACK: Попробуем извлечь хотя бы один тест-кейс из обрезанного JSON
        if (content && content.length > 1000) {
            console.log(`[extractToolArgs] 🔧 Последний fallback: пытаемся извлечь частичные данные из ${content.length} символов`);

            try {
                // Ищем первый валидный объект тест-кейса
                const firstCaseMatch = content.match(/\{\s*"feature"[\s\S]*?\}/);
                if (firstCaseMatch) {
                    const firstCase = JSON5.parse(firstCaseMatch[0]);
                    console.log(`[extractToolArgs] ✅ Fallback: извлечен 1 тест-кейс`);
                    return { cases: [firstCase] };
                }
            } catch (e) {
                console.warn(`[extractToolArgs] Fallback не сработал: ${e.message}`);
            }
        }

        console.error(`[extractToolArgs] ❌ Не удалось извлечь args: нет ни tool_calls, ни валидного JSON в content`);
        return null;

    } catch (error) {
        console.error(`[extractToolArgs] 💥 Критическая ошибка:`, error.message);
        return null;
    }
}



//
// Универсальная функция для повторных попыток при 5xx,
// принимающая либо строку prompt, либо массив сообщений {role, content}
//
export async function callWithBackoff(url, promptOrMessages, apiKey, opts = {}) {
    const {
        // Основная free‑модель и массив fallback‑моделей
        model = 'deepseek/deepseek-chat-v3.1:free',
        models,
        tools,
        tool_choice,
        response_format,
        temperature = 0,
        top_p = 0.9,
        extra = {},
        max_tokens = 8192,
        maxAttempts = 8,          // больше попыток: учитываем очереди у провайдера
        minWaitMs = 1500,         // минимальный бэкофф
        maxWaitMs = 120000,       // верхняя граница ожидания между ретраями
        logRateLimit = true,      // логировать лимит-хедеры для диагностики
        reduceTokensOn400 = false // понижать max_tokens при 400 Bad Request (для больших запросов)
    } = opts;

    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

    // Проверка размера запроса для OpenRouter
    const requestSize = JSON.stringify(messages).length;
    const estimatedTokens = Math.ceil(requestSize / 4);
    const MAX_TOKENS_OPENROUTER = 100000; // Лимит для OpenRouter (примерно)

    console.log(`[callWithBackoff] Request size: ${requestSize} chars, estimated tokens: ${estimatedTokens}`);

    if (estimatedTokens > MAX_TOKENS_OPENROUTER) {
        console.log(`[callWithBackoff] Request too large (${estimatedTokens} tokens > ${MAX_TOKENS_OPENROUTER}), splitting into chunks...`);
        return await processLargeOpenRouterRequest(messages, opts, apiKey);
    }

    // экспоненциальный бэкофф с небольшим джиттером
    const backoff = (attemptIdx) => {
        const base = Math.min(minWaitMs * Math.pow(2, attemptIdx - 1), maxWaitMs);
        const jitter = 1 + Math.random() * 0.2; // +0..20%
        return Math.floor(base * jitter);
    };

    let attempt = 0;
    let currentMaxTokens = max_tokens; // для динамического понижения при 400

    // Очередь моделей: основная + фолбэк
    const modelQueue = Array.isArray(models) && models.length
        ? models
        : [model, 'qwen/qwen3-235b-a22b:free'];
    let modelIdx = 0;

    while (attempt < maxAttempts) {
        attempt++;

        const payload = {
            model: modelQueue[modelIdx] || modelQueue[0],
            messages,
            temperature,
            top_p,
            max_tokens: currentMaxTokens,
            ...extra
        };
        if (tools) payload.tools = tools;
        if (tool_choice) payload.tool_choice = tool_choice;
        if (response_format) payload.response_format = response_format;

        if (logRateLimit && attempt === 1 && modelIdx === 0) {
            console.log(`[callWithBackoff] Запрос к модели: ${payload.model}`);
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // Успешно — парсим и проверяем
        if (resp.ok) {
            const text = await resp.text();
            if (!text || !/[{\[]/.test(text)) {
                throw new Error(`Empty or invalid JSON response from AI: "${text}"`);
            }
            let data;
            try {
                data = JSON.parse(text);
            } catch {

                data = JSON5.parse(text);
            }

            // Проверяем ошибки в теле ответа (429 может прийти в теле при 200 OK)
            if (data?.error) {
                const bodyCode = data.error.code || data.error.status;
                const bodyMsg = data.error.message || '';

                // Ошибочные коды: 4xx и 5xx
                if (bodyCode >= 400) {
                    if (logRateLimit) {
                        console.warn(`[callWithBackoff] Ошибка в теле (HTTP ${resp.status}): код ${bodyCode} - ${bodyMsg}`);
                    }
                    resp.status = bodyCode; // подменяем для обработки ниже
                }
                // Код есть, но успешный (2xx, 3xx) - возвращаем с предупреждением
                else if (bodyCode) {
                    if (logRateLimit) {
                        console.warn(`[callWithBackoff] Предупреждение в теле: код ${bodyCode} - ${bodyMsg}`);
                    }
                    return data;
                }
                // Нет кода - непонятная ошибка
                else {
                    if (logRateLimit) {
                        console.warn(`[callWithBackoff] Ошибка без кода в теле:`, data.error);
                    }
                    throw new Error(`API error без кода: ${bodyMsg || JSON.stringify(data.error)}`);
                }
            } else {
                return data;
            }
        }

        // ==== 429/404/400: попробовать понизить токены или переключить модель ====
        if (resp.status === 429 || resp.status === 404 || resp.status === 400) {
            // Для 400: сначала пробуем понизить токены (если включено)
            if (resp.status === 400 && reduceTokensOn400 && currentMaxTokens > 1800) {
                currentMaxTokens = Math.max(1800, Math.floor(currentMaxTokens * 0.6));
                if (logRateLimit) {
                    console.warn(`[callWithBackoff] 400 Bad Request. Понижаю max_tokens до ${currentMaxTokens}`);
                }
                attempt--; // не сжигаем попытку
                continue;
            }

            // Пробуем переключиться на следующую модель
            if (modelIdx < modelQueue.length - 1) {
                modelIdx++;
                if (logRateLimit) {
                    console.warn(`[callWithBackoff] HTTP ${resp.status}. Переключаюсь на модель: ${modelQueue[modelIdx]}`);
                }
                attempt--; // не сжигаем попытку
                continue;
            }
        }

        // ==== 429: ожидание если все модели заняты ====
        if (resp.status === 429) {

            // Ожидание, если все модели закончились
            // Собираем все подсказки по времени ожидания
            const h = (name) => resp.headers.get(name);
            const ra = parseFloat(h('retry-after') || '0'); // секунды
            const rMain = parseFloat(h('x-ratelimit-reset') || '0');
            const rReq = parseFloat(h('x-ratelimit-reset-requests') || '0');
            const rTok = parseFloat(h('x-ratelimit-reset-tokens') || '0');
            const remaining = h('x-ratelimit-remaining') || h('x-ratelimit-remaining-requests') || h('x-ratelimit-remaining-tokens');

            let waitMs = 0;

            // Retry-After — самый надёжный
            if (ra && !Number.isNaN(ra)) {
                waitMs = Math.max(waitMs, Math.round(ra * 1000));
            }

            // Иногда приходит timestamp (в сек/мс) или "через N секунд"
            const now = Date.now();
            for (const v of [rMain, rReq, rTok]) {
                if (!v || Number.isNaN(v)) continue;
                // Если значение похоже на timestamp в мс — просто разница,
                // если похоже на секунды — умножаем на 1000.
                const ms = v > 1e12 ? (v - now) : Math.round(v * 1000);
                if (ms > 0) waitMs = Math.max(waitMs, ms);
            }

            // Фолбэк — экспоненциальный бэкофф
            if (!waitMs || waitMs < 1000) waitMs = backoff(attempt);

            if (logRateLimit) {
                console.warn('[callWithBackoff] 429 rate limit (все модели заняты). Waiting ms:', waitMs, {
                    retryAfter: h('retry-after'),
                    xRateReset: h('x-ratelimit-reset'),
                    xRateResetReq: h('x-ratelimit-reset-requests'),
                    xRateResetTok: h('x-ratelimit-reset-tokens'),
                    remaining
                });
            }

            await new Promise(r => setTimeout(r, Math.min(waitMs, maxWaitMs)));
            modelIdx = 0; // сбрасываем на первую модель после ожидания
            // и пробуем снова
            continue;
        }

        // 5xx: подождать и повторить
        if (resp.status >= 500 && resp.status < 600) {
            const waitMs = backoff(attempt);
            if (logRateLimit) {
                console.warn(`[callWithBackoff] ${resp.status} from upstream. Retry in ${waitMs}ms`);
            }
            await new Promise(r => setTimeout(r, waitMs));
            continue;
        }

        // Остальные ошибки — читаем тело и бросаем
        const errText = await resp.text().catch(() => '');
        throw new Error(`OpenRouter ${resp.status}: ${errText || resp.statusText}`);
    }

    throw new Error('OpenRouter: превышено число попыток (после 429/5xx)');
}

function buildSubmitModelTool() {
    return {
        type: "function",
        function: {
            name: "submit_test_model",
            description: "Верни иерархическую тест-модель (Feature→Story→Scenario→Code) строго в массиве model",
            parameters: {
                type: "object",
                properties: {
                    model: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                text: { type: "string" },                 // Feature name
                                stories: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            text: { type: "string" },           // Story name
                                            scenarios: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        text: { type: "string" },     // Scenario text
                                                        codes: {
                                                            type: "array",
                                                            items: {
                                                                type: "object",
                                                                properties: {
                                                                    text: { type: "string" } // Code action
                                                                },
                                                                required: ["text"],
                                                                additionalProperties: false
                                                            }
                                                        }
                                                    },
                                                    required: ["text"],
                                                    additionalProperties: false
                                                }
                                            }
                                        },
                                        required: ["text", "scenarios"],
                                        additionalProperties: false
                                    }
                                }
                            },
                            required: ["text", "stories"],
                            additionalProperties: false
                        }
                    }
                },
                required: ["model"],
                additionalProperties: false
            }
        }
    };
}


const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
/**
 * GET /api/jira/search
 * Query params:
 *   - pat:      Jira Personal Access Token (обязательный)
 *   - jql:      JQL‑запрос (обязательный)
 *   - maxResults: сколько возвращать записей (необязательно, дефолт 50)
 *   - startAt:    с какой записи начинать (необязательно, дефолт 0)
 */
app.get('/api/jira/search', async (req, res) => {
    const { pat, jql, maxResults = 50 } = req.query;
    if (!pat || !jql) return res.status(400).json({ error: 'pat и jql обязательны' });

    try {
        const { data } = await axios.get(
            'https://jira.abanking.ru/rest/api/2/search',
            {
                params: {
                    jql,
                    maxResults,
                    fields: 'summary'         //  только summary
                },
                headers: {
                    Authorization: `Bearer ${pat}`,
                    Accept: 'application/json'
                },
                httpAgent,
                httpsAgent,
                timeout: 10_000            // таймаут 10 сек
            }
        );
        res.json(data);
    } catch (err) {
        console.error('Ошибка /api/jira/search:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});


// Асинхронная генерация тестовой модели
async function generateTestModelAsync(taskId, inputData) {
    try {
        await db('generation_tasks').where('id', taskId).update({
            status: 'processing',
            progress: 0,
            updated_at: new Date()
        });

        const {
            requirements,
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
        } = inputData;

        if (!requirements && !text && !pageId) {
            throw new Error('Нужно передать requirements (строка/массив), либо text, либо pageId');
        }

        // 0) Если pageId передан — подтягиваем основную страницу и прямые ссылки
        let autoPages = [];
        let baseRequirement = '';
        if (pageId) {
            if (!bearerToken) {
                throw new Error('bearerToken обязателен для загрузки страницы Confluence');
            }
            
            // Проверяем формат bearerToken
            if (typeof bearerToken !== 'string' || !bearerToken.trim()) {
                throw new Error('bearerToken должен быть непустой строкой');
            }
            
            console.log(`[generate-test-model-async] Загружаем страницу Confluence pageId=${pageId}...`);
            console.log(`[generate-test-model-async] bearerToken длина: ${bearerToken.length}, первые 20 символов: ${bearerToken.substring(0, 20)}...`);
            
            try {
                const { markdown } = await fetchConfluencePage(bearerToken.trim(), pageId, { inlineTextAttachments: true });
                baseRequirement = markdown || '';
                console.log(`[generate-test-model-async] ✅ Страница загружена, размер: ${baseRequirement.length} символов`);
                
                if (!baseRequirement || !baseRequirement.trim()) {
                    throw new Error(`Страница Confluence pageId=${pageId} загружена, но содержимое пустое`);
                }
                
                // Логируем первые 200 символов для проверки
                console.log(`[generate-test-model-async] Первые 200 символов контента: ${baseRequirement.substring(0, 200)}...`);
                
                // Извлекаем ссылки на другие страницы
                const ids = new Set(Array.from(String(markdown || '').matchAll(/pageId=(\d{4,})/g)).map(m => m[1]));
                ids.delete(String(pageId));
                console.log(`[generate-test-model-async] Найдено ${ids.size} ссылок на другие страницы`);
                
                for (const lid of ids) {
                    try {
                        const { markdown: md } = await fetchConfluencePage(bearerToken, lid, { inlineTextAttachments: true });
                        const lines = String(markdown || '').split(/\n/);
                        const refIdx = lines.findIndex(l => l.includes(`pageId=${lid}`));
                        let mention = '';
                        if (refIdx !== -1) {
                            const start = Math.max(0, refIdx - 2);
                            const end = Math.min(lines.length, refIdx + 3);
                            mention = lines.slice(start, end).join('\n').trim();
                        }
                        const relevant = extractRelevantSections(md, mention, { maxSections: 8, maxChars: 50000 });
                        autoPages.push([
                            `### Контекст по ссылке из основной статьи (pageId=${lid})`,
                            mention ? `> Упоминание в основной статье:\n> ${mention.replace(/\n/g, '\n> ')}` : `> Упоминание в основной статье: не найдено (pageId=${lid})`,
                            '',
                            relevant
                        ].join('\n'));
                    } catch (linkErr) {
                        console.warn(`[generate-test-model-async] Не удалось загрузить связанную страницу pageId=${lid}:`, linkErr.message);
                    }
                }
            } catch (e) {
                console.error(`[generate-test-model-async] ❌ КРИТИЧЕСКАЯ ОШИБКА при загрузке страницы Confluence:`, e.message);
                throw new Error(`Не удалось загрузить страницу Confluence pageId=${pageId}: ${e.message}. Проверьте bearerToken и доступ к странице.`);
            }
        }

        // Приводим к строке требований, предварительно прогнав через contextRefiner
        let reqStringForModel = '';
        
        // Если pageId был передан, но загрузка не удалась - выбрасываем ошибку
        if (pageId && !baseRequirement) {
            throw new Error(`Не удалось загрузить страницу Confluence pageId=${pageId}. Проверьте bearerToken и доступ к странице.`);
        }
        
        // Если requirements пустой массив, но есть pageId - используем загруженный контент
        const requirementsToUse = (Array.isArray(requirements) && requirements.length > 0) 
            ? requirements 
            : (requirements ? [requirements] : undefined);
        
        try {
            const { refinedText, refinedArray } = await contextRefiner({
                requirements: requirementsToUse,
                text: baseRequirement || text,
                glossary,
                context,
                contextInstruction,
                contextPageIds: undefined,
                glossaryPageId: undefined,
                bearerToken: bearerToken, // ✅ ИСПРАВЛЕНО: передаем bearerToken
                contextPages: autoPages
            });
            reqStringForModel = refinedText || (refinedArray?.join('\n\n') ?? '');
        } catch (e) {
            console.warn('[generate-test-model-async] contextRefiner warning:', e.message);
            // Fallback: используем загруженный контент или переданный text
            reqStringForModel = baseRequirement || (typeof requirements === 'string' ? requirements : (Array.isArray(requirements) && requirements.length > 0 ? requirements.join('\n\n') : (text || '')));
        }
        
        // Если после всех попыток reqStringForModel пустой - это ошибка
        if (!reqStringForModel || !reqStringForModel.trim()) {
            throw new Error('Не удалось получить текст требований. Проверьте параметры: pageId, requirements, text.');
        }
        
        // Логируем размер и начало требований для проверки
        console.log(`[generate-test-model-async] ✅ Требования подготовлены, размер: ${reqStringForModel.length} символов`);
        console.log(`[generate-test-model-async] Первые 500 символов требований: ${reqStringForModel.substring(0, 500)}...`);
        
        // Проверяем, что требования не содержат только примеры из промпта
        if (reqStringForModel.length < 100) {
            console.warn(`[generate-test-model-async] ⚠️ ВНИМАНИЕ: Требования очень короткие (${reqStringForModel.length} символов). Возможно, контент не загружен.`);
        }

        // Функция чанкования больших требований
        function chunkTextBySize(text, maxChars = 120000) {
            if (!text || text.length <= maxChars) return [text];

            const chunks = [];
            const paragraphs = text.split(/\n\n+/);
            let currentChunk = '';

            for (const para of paragraphs) {
                if (currentChunk.length + para.length > maxChars && currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = para;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + para;
                }
            }

            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }

            return chunks.length > 0 ? chunks : [text];
        }

        // УДАЛЕНО: функция mergeTestModels больше не нужна - используем простое объединение массивов
        /*
        function mergeTestModels(models) {
            if (!models || models.length === 0) return [];
            if (models.length === 1) return models[0];
            
            const featureMap = new Map();
            
            // Функция для нормализации названий (убирает множественное число и лишние слова)
            function normalizeName(name) {
                return name.toLowerCase().trim()
                    .replace(/\s+/g, ' ') // убираем лишние пробелы
                    .replace(/[ыи]$/g, '') // убираем множественное число
                    .replace(/пользователя?/g, '') // убираем "пользователя/пользователь"
                    .replace(/пользовательский?/g, '') // убираем "пользовательский/пользовательская"
                    .replace(/\s+/g, ' ') // убираем лишние пробелы снова
                    .trim();
            }
            
            for (const model of models) {
                if (!Array.isArray(model)) continue;
                
                for (const feature of model) {
                    if (!feature?.text) continue;
                    
                    const fKey = normalizeName(feature.text);
                    
                    if (!featureMap.has(fKey)) {
                        featureMap.set(fKey, {
                            text: feature.text,
                            stories: []
                        });
                    }
                    
                    const existingFeature = featureMap.get(fKey);
                    const storyMap = new Map();
                    
                    for (const story of (existingFeature.stories || [])) {
                        if (story?.text) {
                            storyMap.set(normalizeName(story.text), story);
                        }
                    }
                    
                    for (const story of (feature.stories || [])) {
                        if (!story?.text) continue;
                        
                        const sKey = normalizeName(story.text);
                        
                        if (!storyMap.has(sKey)) {
                            storyMap.set(sKey, {
                                text: story.text,
                                scenarios: story.scenarios || []
                            });
                        } else {
                            const existingStory = storyMap.get(sKey);
                            const scenarioMap = new Map();
                            
                            for (const sc of (existingStory.scenarios || [])) {
                                if (sc?.text) {
                                    scenarioMap.set(normalizeName(sc.text), sc);
                                }
                            }
                            
                            for (const sc of (story.scenarios || [])) {
                                if (!sc?.text) continue;
                                
                                const scKey = normalizeName(sc.text);
                                
                                if (!scenarioMap.has(scKey)) {
                                    scenarioMap.set(scKey, {
                                        text: sc.text,
                                        codes: sc.codes || []
                                    });
                                } else {
                                    const existingScenario = scenarioMap.get(scKey);
                                    const codeMap = new Map();
                                    
                                    for (const code of (existingScenario.codes || [])) {
                                        if (code?.text) {
                                            codeMap.set(normalizeName(code.text), code);
                                        }
                                    }
                                    
                                    for (const code of (sc.codes || [])) {
                                        if (code?.text) {
                                            const cKey = normalizeName(code.text);
                                            if (!codeMap.has(cKey)) {
                                                codeMap.set(cKey, code);
                                            }
                                        }
                                    }
                                    
                                    existingScenario.codes = Array.from(codeMap.values());
                                }
                            }
                            
                            existingStory.scenarios = Array.from(scenarioMap.values());
                        }
                    }
                    
                    existingFeature.stories = Array.from(storyMap.values());
                }
            }
            
            return Array.from(featureMap.values());
        }
        */

        const SYSTEM_PROMPT = `
🚨 КРИТИЧЕСКИ ВАЖНО: ПОЛНОЕ ПОКРЫТИЕ ПОЛЬЗОВАТЕЛЬСКИХ ПУТЕЙ! 🚨
Ты создаёшь тестовую модель на основе требований, но ОБЯЗАТЕЛЬНО покрываешь ВСЕ пользовательские пути.
ОБЯЗАТЕЛЬНО: создавать элементы модели для ВСЕХ функций, упомянутых в требованиях.
ОБЯЗАТЕЛЬНО: покрывать все способы выполнения операций (если упоминается "несколько способов").
ОБЯЗАТЕЛЬНО: включать все условия и ветвления (если есть "если... то...").
ОБЯЗАТЕЛЬНО: создавать отдельные элементы для каждого варианта пользовательского действия.
ЗАПРЕЩЕНО: пропускать функции из требований только потому, что они не детально описаны.
ЗАПРЕЩЕНО: объединять разные способы/варианты в один элемент модели.
        

🚨 КРИТИЧЕСКИ ВАЖНО: УНИКАЛЬНЫЕ ID ДЛЯ КАЖДОГО ЭЛЕМЕНТА! 🚨
ОБЯЗАТЕЛЬНО: каждому элементу модели (feature, story, scenario, code) присваивай уникальный ID в формате UUID v4.
ОБЯЗАТЕЛЬНО: используй поле "id" для каждого элемента модели.
ОБЯЗАТЕЛЬНО: сохраняй структуру с ID для стабильности модели.
Формат ID — UUID v4. Примеры 's1…', 'sc…' запрещены.
ЗАПРЕЩЕНО: создавать элементы без уникального ID!
        

🚨 КРИТИЧЕСКИ ВАЖНО: ГЕНЕРАЦИЯ UUID v4! 🚨
ИСПОЛЬЗУЙ ТОЛЬКО ВАЛИДНЫЕ UUID v4 в формате: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
Где x — любая hex цифра (0-9, a-f), y — одна из цифр 8, 9, a, b.
ПРИМЕРЫ ПРАВИЛЬНЫХ UUID: "550e8400-e29b-41d4-a716-446655440000", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
ПРИМЕРЫ НЕПРАВИЛЬНЫХ UUID: "g7h8i9...", "s1...", "sc1..." - ЗАПРЕЩЕНО!

        
        🚨 КРИТИЧЕСКИ ВАЖНО: СОЗДАВАЙ STORIES ДЛЯ ВСЕХ РАЗДЕЛОВ! 🚨
ОБЯЗАТЕЛЬНО: Просканируй ВСЕ требования и создай Story для КАЖДОГО найденного раздела!
ЗАПРЕЩЕНО: Останавливаться на одной Story - создавай Story для ВСЕХ разделов!
ЗАПРЕЩЕНО: Объединять разные разделы в одну Story!

ПРАВИЛО: Каждый раздел требований = отдельная Story!
ПРАВИЛО: Если в требованиях есть несколько разделов (например, X.X.1, X.X.2, X.X.3) - создай Story для КАЖДОГО!

🚨 КРИТИЧЕСКИ ВАЖНО: ЗАПРЕТ НА BACKEND API КАК STORIES! 🚨
СТРОГО ЗАПРЕЩЕНО создавать Stories для:
- Разделов с названиями "Получение...", "Смена...", "Запрос...", "API..."
- Backend API-методов (GET/POST/PUT/DELETE /rest/...)
- Технических операций без пользовательского контекста
- Операций с данными без UI-действия пользователя

ПРАВИЛО: Backend API = это Code внутри UI Story!
ПРИМЕРЫ НЕПРАВИЛЬНОГО (НЕ ДЕЛАТЬ):
❌ Story: "Получение настроек отображения продуктов" (requirement: 6.1)
❌ Story: "Получение списка кредитов" (requirement: 6.2)
❌ Story: "Смена наименования продукта" (requirement: 6.3)

ПРИМЕРЫ ПРАВИЛЬНОГО:
✅ Story: "Отображение кредита на главной странице" → Code: "GET /rest/stateful/corp/credit?sync_credits=true"
✅ Story: "Редактирование названия кредита" → Code: "PUT /rest/stateful/corp/product/change_alias"
✅ Story: "Просмотр графика платежей" → Code: "GET /rest/stateful/corp/payment_schedule?account_id={credit.id}"

АЛГОРИТМ ПРОВЕРКИ:
1. Если раздел описывает API-метод БЕЗ пользовательского действия → это Code, НЕ Story!
2. Если раздел начинается с "Получение", "Запрос", "Смена" (без "Пользователь получает") → это Code!
3. Если раздел описывает UI-функцию с пользовательским действием → это Story!

🚨 ПРИМЕР: Если в требованиях есть разделы 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7, 2.2.8 - создай Story для КАЖДОГО! 🚨

ПРИМЕРЫ ОБЯЗАТЕЛЬНОГО ПОЛЯ requirement:
Feature: { text: "Название фичи", requirement: "X.X" }
Story: { text: "Название функции 1", requirement: "X.X.1" }
Story: { text: "Название функции 2", requirement: "X.X.2" }
Story: { text: "Название функции 3", requirement: "X.X.3" }
Story: { text: "Название функции 4", requirement: "X.X.4" }
Story: { text: "Название функции 5", requirement: "X.X.5" }
Story: { text: "Название функции 6", requirement: "X.X.6" }
Story: { text: "Название функции 7", requirement: "X.X.7" }
Story: { text: "Название функции 8", requirement: "X.X.8" }
Scenario: { text: "Конкретный сценарий", requirement: "X.X.1" }
Code: { text: "Системная реакция", requirement: "X.X.1" }

ЗАПРЕЩЕНО: Создавать элементы БЕЗ поля requirement!
ЗАПРЕЩЕНО: Использовать некорректные форматы requirement!
ЗАПРЕЩЕНО: Создавать только одну Story для всего документа!
ЗАПРЕЩЕНО: Останавливаться на первом найденном разделе!
        
        ПРАВИЛО ИЗВЛЕЧЕНИЯ ТРЕБОВАНИЙ:
        1. Ищи нумерованные разделы в формате X.X, X.X.X, X.X.X.X (например, 2.2, 2.2.7, 3.1.4)
        2. Заголовок раздела = название Story
        3. Номер раздела = значение поля "requirement"
        4. Содержимое раздела = основа для Scenarios и Codes
        
        ПРИМЕРЫ ПРАВИЛЬНОГО ИЗВЛЕЧЕНИЯ:
        Если в требованиях:
          "### X.X.X Название функции"
        Создавай:
          Story: {
            text: "Название функции",
            requirement: "X.X.X",
            scenarios: [...]
          }
        
        Если в требованиях:
          "## X.X Валидация полей
           Система должна проверять..."
        Создавай:
          Story: {
            text: "Валидация полей формы", 
            requirement: "4.3",
            scenarios: [...]
          }
        
        Если в требованиях:
          "**3.2.1** Обработка ошибок"
        Создавай:
          Story: {
            text: "Обработка ошибок",
            requirement: "3.2.1",
            scenarios: [...]
          }
        
        ФОРМАТЫ НУМЕРАЦИИ В ТРЕБОВАНИЯХ:
        - "### 2.2.7 Название" → requirement: "2.2.7"
        - "**3.4.1** Название" → requirement: "3.4.1"
        - "4.5 Название раздела" → requirement: "4.5"
        - "п. 2.2.7 Название" → requirement: "2.2.7"
        - "Раздел 2.2.8: Название" → requirement: "2.2.8"
        
        Каждый узел (Feature/Story/Scenario/Code) обязан иметь requirement; если в требовании указан точный подпункт — использовать его.
ЗАПРЕЩЕНО: создавать элементы модели без привязки к требованиям!
        ЗАПРЕЩЕНО: использовать случайные ID типа "req-12345" - только реальные номера требований из документа!
        ЗАПРЕЩЕНО: пропускать разделы требований!
        
        
        🚨 КРИТИЧЕСКИ ВАЖНО: ПОЛНОЕ ПОКРЫТИЕ ВСЕХ РАЗДЕЛОВ ТРЕБОВАНИЙ! 🚨
        ОБЯЗАТЕЛЬНО: Создать Story для КАЖДОГО нумерованного раздела требований!
        ОБЯЗАТЕЛЬНО: Проверить что ни один раздел не пропущен!
        
        АЛГОРИТМ ПРОВЕРКИ ПОЛНОТЫ:
        1. Просканируй ВСЕ требования от начала до конца
        2. Найди ВСЕ нумерованные разделы (X.X, X.X.X, X.X.X.X)
        3. Для КАЖДОГО раздела создай соответствующую Story с полем requirement
        4. Если раздел содержит "несколько способов" → создай отдельные Scenarios для каждого
        5. Если раздел содержит условия "если... то..." → создай Scenarios для всех вариантов
        6. Если упоминаются различные doc_type или типы операций → создай отдельные Scenarios для каждого
        
        РАЗДЕЛЫ, КОТОРЫЕ ЧАСТО ПРОПУСКАЮТ (ОБРАТИ ОСОБОЕ ВНИМАНИЕ!):
        - Разделы про "повтор операций" (обычно в конце документа)
        - Разделы про "обработку ошибок"
        - Разделы про "edge cases"
        - Разделы про "производительность"
        - Разделы с многочисленными вариантами (doc_type, типы операций)
        
        ПРОВЕРКА ПЕРЕД ЗАВЕРШЕНИЕМ:
        Перед отправкой модели задай себе вопрос:
        "Покрыл ли я ВСЕ нумерованные разделы из требований?"
        "Создал ли я отдельные Scenarios для каждого варианта/способа/типа?"
        Если нет → ВЕРНИСЬ и создай недостающие Stories и Scenarios!
        
        
        🚨 КРИТИЧЕСКИ ВАЖНО: СТРОГОЕ СООТВЕТСТВИЕ СЛОЕВ ТЕСТИРОВАНИЯ! 🚨
        ВАЖНО: Это соответствие применяется ТОЛЬКО при генерации тест-кейсов, НЕ при генерации модели!
        При генерации тестовой модели НЕ нужно указывать layer - это делается автоматически при генерации тест-кейсов.
        
        СПРАВОЧНАЯ ИНФОРМАЦИЯ (для понимания, но не для генерации модели):
        - Story уровень → layer: "E2E Tests" (полные пользовательские сценарии)
        - Scenario уровень → layer: "Integration frontend/backend Tests" (взаимодействие компонентов)
        - Code уровень → layer: "Unit frontend/backend Tests" (отдельные функции)
        

🚨 КРИТИЧЕСКИ ВАЖНО: ИЗБЕГАНИЕ ДУБЛИРОВАНИЯ! 🚨
ЗАПРЕЩЕНО: создавать дублирующиеся элементы модели с похожими названиями!
ЗАПРЕЩЕНО: создавать элементы с разными формулировками одного и того же действия!
ПРИМЕРЫ ДУБЛИРОВАНИЯ (НЕ ДЕЛАТЬ):
- "Платежи по реквизитам" и "Платеж по реквизитам"
- "Переводы" и "Перевод"
- "Платежи по QR-коду" и "Платеж по QR-коду"
- "Авторизация" и "Авторизация пользователя" (если это одно и то же)
ОБЯЗАТЕЛЬНО: использовать единообразные формулировки для одинаковых функций!
ОБЯЗАТЕЛЬНО: проверять что элемент с похожим названием уже не создан!
        

Ты — выдающийся QA-архитектор с исключительным талантом к синтезу и декомпозиции. Твоя главная сила — видеть за разрозненными требованиями целостную картину и ценность для пользователя.
        

## 1. Цель
Создать иерархическую тестовую модель (Feature → Story → Scenario → Code) на основе предоставленных требований.

Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. Если требование явно про UI — интерпретируй как Angular; если про API/сервер — как .NET. Ничего не выдумывай сверх текста.
        

## 2. Ключевой принцип декомпозиции (САМОЕ ВАЖНОЕ!)
- **Сначала Синтез, потом Анализ.** Прочитай ВСЕ требования. Твоя первая задача — определить **ВСЕ пользовательские потоки (Story)**, которые упомянуты в требованиях.
        
        ## 2.1 Полное покрытие всех функций
- Если в требованиях **упоминается любая функция** — **обязательно создавай** соответствующий элемент модели.
- Если упоминается **"несколько способов"** — создавай **отдельные элементы** для каждого способа.
- Если есть **условия "если... то..."** — создавай элементы для **всех вариантов**.
- Если упоминается **API-метод** — создавай соответствующий элемент модели.
        - Если упоминаются **различные типы операций** (doc_type, типы документов, категории) — создавай отдельные Scenarios для каждого типа.
- Модель должна отражать **ВСЕ** функции из требований, даже если они описаны кратко.


## 3. Структура дерева (строго соблюдать)
— **Feature (Фича):** Большой независимый блок продукта.
        — **Story:** **Единый бизнес-поток/раздел требований (например, X.X.X Авторизация, X.X.X Повтор операций).**
        — **Scenario:** **Конкретный способ выполнения в рамках Story (логин/пароль, PIN, FaceID, конкретный doc_type и т.д.).** Для каждого способа — отдельный Scenario.
        — **Code:** **Системные реакции (включая HTTP-запросы), упорядоченные по таймингу.** **Не использовать** слово «Проверка».
        

🚨 КРИТИЧЕСКИ ВАЖНО: РАЗДЕЛЕНИЕ ПОЛЬЗОВАТЕЛЬСКИХ ДЕЙСТВИЙ И СИСТЕМНЫХ РЕАКЦИЙ! 🚨
— **Scenario = ТОЛЬКО действия пользователя:** "Ввести данные", "Нажать кнопку", "Выбрать опцию", "Открыть страницу", "Перейти", "Сканировать", "Сфокусироваться", "Снять фокус", "Загрузить файл"
— **Code = ТОЛЬКО реакции системы:** "Рассчитать ставку", "Отобразить поля", "Сохранить данные", "Вызвать метод", "Инициализировать", "Не вызывать", "POST /api/endpoint", "GET /api/endpoint"
— **ЗАПРЕЩЕНО:** В Scenario писать системные реакции ("Рассчитать", "Отобразить", "Сохранить", "Вызвать метод")
— **ЗАПРЕЩЕНО:** В Code писать пользовательские действия ("Ввести", "Нажать", "Выбрать", "Открыть", "Перейти")
        

🚨 КРИТИЧЕСКИ ВАЖНО: ПРАВИЛЬНАЯ СТРУКТУРА SCENARIO → CODE! 🚨
Если в Code.text есть пользовательские действия (Ввести, Нажать, Открыть, Перейти) — ВЫНЕСИ их в отдельные Scenario!
Каждый пользовательский шаг должен быть отдельным Scenario с соответствующими Code (системными реакциями).
        
ПРИМЕР ПРАВИЛЬНОЙ СТРУКТУРЫ:
- Scenario: "Ввести платёжные реквизиты" → Code: "Вызвать метод getReport()"
- Scenario: "Нажать кнопку «Продолжить»" → Code: "POST /rest/stateful/.../create/sdk"
        
        НЕПРАВИЛЬНО: 
        - Code: "Ввести БИК, Р/С, ИНН" (это Scenario!)
        - Code: "Нажать кнопку «Продолжить»" (это Scenario!)
        

🚨 КРИТИЧЕСКИ ВАЖНО: ФОРМАЛЬНЫЕ ВЕРБ-ГЕЙТЫ! 🚨
**ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ДЛЯ КАЖДОЙ ГЕНЕРАЦИИ:**
        * Scenario.text **начинается** с: Открыть|Перейти|Выбрать|Ввести|Нажать|Сканировать|Сфокусироваться|Снять фокус|Загрузить|Повторить
        * Code.text **запрещено** начинать этими глаголами; допустимо: Инициализировать|Отобразить|Рассчитать|Сохранить|Вызвать метод|Получить ответ|Не вызывать|Передать данные
**Если правило не выполняется — ПЕРЕРАЗЛОЖИТЬ** (перенести текст либо в Scenario, либо в Code).
        

🚨 КРИТИЧЕСКИ ВАЖНО: ТАЙМИНГ И ПОРЯДОК РЕАКЦИЙ! 🚨
Соблюдай тайминг из требований. Если сказано «сбор начинается после вызова запроса, а отправка — после ответа 200/202», то в узлах Code отрази это в указанном порядке: выполнить запрос → запустить сбор → отправить после требуемого статуса.

Если требования предписывают follow-up запрос перед отчётом, добавь отдельный Code для follow-up запроса и гейт 'передачу/getReport()' на его успешный статус.

Примеры ПРАВИЛЬНОГО разделения:
— **Scenario:** "Ввести параметры кредита" → **Code:** "Рассчитать процентную ставку"
— **Scenario:** "Нажать кнопку 'Продолжить'" → **Code:** "Отобразить поля залогового обеспечения"
— **Scenario:** "Выбрать тип залога" → **Code:** "Автоматически заполнить данные залогодателей"
        

🚨 КРИТИЧЕСКИ ВАЖНО: АНАЛИЗ ТРЕБОВАНИЙ НА ПРЕДМЕТ РАЗДЕЛЕНИЯ! 🚨
При анализе требований ОБЯЗАТЕЛЬНО разделяй:
1. **Что делает ПОЛЬЗОВАТЕЛЬ** (вводит, нажимает, выбирает) → это Scenario
2. **Что делает СИСТЕМА** (рассчитывает, отображает, сохраняет) → это Code

Если в требованиях написано "Система отображает поля" → это Code, НЕ Scenario!
Если в требованиях написано "Пользователь вводит данные" → это Scenario, НЕ Code!

Примеры анализа требований:
❌ НЕПРАВИЛЬНО: "Рассчитать процентную ставку на основе параметров" → Scenario
✅ ПРАВИЛЬНО: "Рассчитать процентную ставку на основе параметров" → Code

❌ НЕПРАВИЛЬНО: "Отобразить чекбоксы обеспечения" → Scenario  
✅ ПРАВИЛЬНО: "Отобразить чекбоксы обеспечения" → Code

❌ НЕПРАВИЛЬНО: "Автоматически проставить отметку о залоговом обеспечении" → Scenario
✅ ПРАВИЛЬНО: "Автоматически проставить отметку о залоговом обеспечении" → Code

✅ ПРАВИЛЬНО: "Ввести параметры кредита" → Scenario
✅ ПРАВИЛЬНО: "Нажать кнопку 'Продолжить'" → Scenario
✅ ПРАВИЛЬНО: "Выбрать тип залога" → Scenario
        

## 3.1. Правила Детализации (ПРИОРИТЕТ!)
- **Если в требованиях есть раздел "Пользовательские сценарии" (или похожий по смыслу), используй его как главный источник для декомпозиции.**
        - **Каждый пронумерованный шаг пользователя из этих сценариев должен стать отдельным Scenario в тестовой модели.**
        - **Описание реакции системы на действие пользователя — это Code.**
- **ОБЯЗАТЕЛЬНО: Если в требованиях упоминается "несколько способов" — создавай отдельные Scenario для каждого способа.**
- **ОБЯЗАТЕЛЬНО: Если есть условия "если... то..." — создавай отдельные Scenario для каждого варианта.**
- **ОБЯЗАТЕЛЬНО: Если упоминается API-метод — создавай соответствующий Code (НЕ Story!).**
        - **ОБЯЗАТЕЛЬНО: Если упоминаются различные типы операций (doc_type, категории, типы документов) — создавай отдельные Scenario для КАЖДОГО типа.**
- **ОБЯЗАТЕЛЬНО: Покрывать ВСЕ функции из требований, даже если они описаны кратко.**
- **ОБЯЗАТЕЛЬНО: Если в требованиях упоминается обработка ошибок, пустых данных, null-значений, условия "если...то..." — создавай отдельные Scenarios для КАЖДОГО случая!**

🚨 КРИТИЧЕСКИ ВАЖНО: НЕГАТИВНЫЕ СЦЕНАРИИ И УСЛОВИЯ! 🚨
ОБЯЗАТЕЛЬНО: Если в требованиях есть условия "если...то...", обработка ошибок, пустых данных, null-значений — создавай отдельные Scenarios для КАЖДОГО варианта!

ПРИМЕРЫ УСЛОВИЙ ИЗ ТРЕБОВАНИЙ:
- "Если errorCode присутствует → отобразить ошибку" → Scenario: "Обработать ошибку при загрузке данных"
- "Если массив кредитов пустой [] → скрыть блок" → Scenario: "Обработать отсутствие кредитов"
- "Если поля null → не отображать" → Scenario: "Обработать отсутствие данных в поле"
- "Если doc_type=payment → вызвать метод X" → Scenario: "Повторить платеж с doc_type=payment"
- "Если doc_type=payment_counter → вызвать метод Y" → Scenario: "Повторить платеж с doc_type=payment_counter"

ЗАПРЕЩЕНО: Пропускать негативные сценарии и условия из требований!
ОБЯЗАТЕЛЬНО: Для каждого условия создавай отдельный Scenario!
        

## 3.2. Обязательные Stories для полного покрытия
        - **Story создаётся для каждого раздела требований/бизнес-потока (напр., 2.2.1, 2.2.2, 2.2.7, 2.2.8…).**
- **Каждый способ в рамках потока — отдельный Scenario, а не отдельная Story.**
        - **ОБЯЗАТЕЛЬНО создавай Story для каждого нумерованного раздела требований**
- **ОБЯЗАТЕЛЬНО создавай Story для каждого типа операций** (авторизация, платежи, переводы, QR-коды, повтор операций, разворот из трея)
- **ОБЯЗАТЕЛЬНО создавай Story для каждого условия** (если есть разные условия — создавай отдельные Stories)
        

## 3.3. Чек-лист полноты модели (ОБЯЗАТЕЛЬНО ПРОВЕРИТЬ!)
Перед завершением генерации модели ОБЯЗАТЕЛЬНО проверь:
        - ✅ Создана ли Story для каждого нумерованного раздела требований?
- ✅ Создана ли Story для каждого типа операций (авторизация, платежи, переводы, QR-коды, повтор операций, разворот из трея)?
        - ✅ Создан ли Scenario для каждого способа выполнения операций?
        - ✅ Создан ли Scenario для каждого типа документа/операции (если упоминаются doc_type)?
        - ✅ Создан ли Scenario для каждого условия или ветвления?
- ✅ Покрыты ли все упомянутые в требованиях функции?
- ✅ Созданы ли отдельные Scenario для каждого способа/варианта?
- ✅ Созданы ли Code для всех API-методов?
        - ✅ Нет ли пропущенных функций из требований?

        
        ## 3.4. Принцип Абстракции Данных и Реализации (ВЫСШИЙ ПРИОРИТЕТ!)
- **Не вставляй конкретные данные из примеров** (значения, названия, тексты ошибок) в итоговую модель.
- **Не вставляй детали технической реализации.**
- Твоя задача — распознать КОНКРЕТНЫЕ ПРИМЕРЫ в требованиях, но в итоговой модели заменить их на **АБСТРАКТНЫЕ ОПИСАНИЯ ДЕЙСТВИЙ И РЕАКЦИЙ.**
- Сосредоточься на связке **"действие пользователя (Scenario) -> видимая реакция системы (Code)"**. Модель должна быть независима от конкретной технологии.

🚨 КРИТИЧЕСКИ ВАЖНО: АБСТРАКЦИЯ ОТОБРАЖЕНИЯ ПОЛЕЙ UI! 🚨
ЗАПРЕЩЕНО: Создавать отдельные Codes для каждого отображаемого поля UI!
ПРАВИЛЬНО: Объединять отображение полей в один Code "Отобразить [название блока/компонента]"

ПРИМЕРЫ НЕПРАВИЛЬНОГО (НЕ ДЕЛАТЬ):
❌ Code: "Отобразить пользовательское наименование кредита из параметра credit.alias"
❌ Code: "Отобразить номер кредитного договора из параметра credit.creditInformation.contractNum"
❌ Code: "Отобразить дату кредитного договора из параметра credit.creditInformation.contractDate"
❌ Code: "Отобразить сумму кредита из параметра credit.creditInformation.amount"

ПРИМЕРЫ ПРАВИЛЬНОГО:
✅ Code: "Отобразить информацию о кредите на карточке"
✅ Code: "Отобразить блок 'Основное' с данными договора"
✅ Code: "Отобразить блок 'Очередной платёж' с суммой и датой"

ПРАВИЛО: Один UI-блок = один Code, НЕ несколько Codes для каждого поля!

        
        ## 3.5. При недостатке информации — минимализм
- Если информации в требованиях недостаточно для создания подробного сценария, создай максимально общий и абстрактный элемент.
- Не расширяй модель за счёт непроверенных деталей.
- Предпочти короче и точнее, чем длиннее и с выдумками.

- **Примеры абстракции данных:**
  - НЕПРАВИЛЬНО: "Выбрать программу '27 LADA FREE'"
  - **ПРАВИЛЬНО:** "Выбрать значение, соответствующее условию зависимости"

- **Примеры абстракции реализации:**
          - НЕПРАВИЛЬНО (деталь): Scenario: "Отправить GET-запрос на /api/users"
          - **ПРАВИЛЬНО (действие):** Scenario: "Запросить список пользователей"
  
          - НЕПРАВИЛЬНО (деталь): Code: "Загрузить данные из кэша"
          - **ПРАВИЛЬНО (реакция):** Code: "Отобразить список пользователей"
        

## 4. Формат вывода (обязательно)
Выход — **ТОЛЬКО** чистый JSON-массив без комментариев и markdown.
        ВАЖНО: Каждый элемент модели ОБЯЗАТЕЛЬНО должен содержать уникальный ID в формате UUID v4!
        ВАЖНО: Каждый элемент модели ОБЯЗАТЕЛЬНО должен содержать requirement для связи с требованиями!

\`\`\`json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
            "text": "Отправка отчёта при использовании SDK Bi_Zone",
            "requirement": "2.2",
    "stories": [
      {
        "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
                "text": "Отправка отчёта при открытии страницы платежа по реквизитам",
                "requirement": "2.2.5",
        "scenarios": [
          {
            "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                    "text": "Ввести платёжные реквизиты на статичной форме",
                    "requirement": "2.2.5",
            "codes": [
              { 
                "id": "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
                        "text": "Вызвать метод getReport()",
                        "requirement": "2.2.5"
              }
            ]
          },
          {
            "id": "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
            "text": "Нажать кнопку «Продолжить»",
                    "requirement": "2.2.5",
            "codes": [
              { 
                "id": "6ba7b813-9dad-11d1-80b4-00c04fd430c8",
                "text": "Передать собранные данные через POST /rest/stateful/personal/kuban/client/create/sdk",
                        "requirement": "2.2.5"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "7ca7b810-9dad-11d1-80b4-00c04fd430c9",
                "text": "Повтор платежей из истории/шаблона/финального экрана",
                "requirement": "2.2.7",
                "scenarios": [
                  {
                    "id": "8da7b810-9dad-11d1-80b4-00c04fd430d0",
                    "text": "Повторить платеж с doc_type=payment",
                    "requirement": "2.2.7",
                    "codes": [
                      { 
                        "id": "9ea7b811-9dad-11d1-80b4-00c04fd430d1",
                        "text": "Вызвать метод getReport()",
                        "requirement": "2.2.7"
                      }
                    ]
                  },
                  {
                    "id": "afa7b812-9dad-11d1-80b4-00c04fd430d2",
                    "text": "Повторить платеж с doc_type=payment_counter",
                    "requirement": "2.2.7",
                    "codes": [
                      { 
                        "id": "bga7b813-9dad-11d1-80b4-00c04fd430d3",
                        "text": "Вызвать метод getReport()",
                        "requirement": "2.2.7"
              }
            ]
          }
        ]
      }
    ]
  }
]
\`\`\`
        

## 5. Входные данные: Требования к продукту
${reqStringForModel}
        

## 6. Задание

🚨 ПЕРЕД ГЕНЕРАЦИЕЙ МОДЕЛИ - ВЫПОЛНИ ОБЯЗАТЕЛЬНЫЙ АНАЛИЗ! 🚨

ШАГ 1: АНАЛИЗ ТРЕБОВАНИЙ
1. Выпиши ВСЕ нумерованные разделы из требований (X, X.X, X.X.X, X.X.X.X)
2. Для каждого раздела определи: это UI-функция или Backend API?
3. Если Backend API (начинается с "Получение", "Запрос", "Смена", содержит GET/POST/PUT/DELETE) → НЕ создавай Story, добавь как Code в соответствующую UI Story
4. Выпиши все условия "если...то...", обработку ошибок, пустых данных, null-значений
5. Для каждого условия создай отдельный Scenario

ШАГ 2: ГЕНЕРАЦИЯ МОДЕЛИ
Основываясь на **принципах декомпозиции (п.2), детализации (п.3.1) и абстракции (п.3.4)**, проанализируй требования и сгенерируй тестовую модель в формате JSON. 

КРИТИЧЕСКИ ВАЖНО:
1. Извлеки ВСЕ нумерованные разделы из требований
2. Для КАЖДОГО UI-раздела создай Story с соответствующим полем requirement
3. НЕ создавай Stories для Backend API - это должны быть Codes!
4. Если в разделе упоминаются различные типы/способы/варианты - создай отдельные Scenarios для каждого
5. Для каждого условия "если...то..." создай отдельный Scenario
6. Объединяй отображение полей UI в один Code, НЕ создавай отдельные Codes для каждого поля
7. Убедись что ни один раздел не пропущен!

🚨 ПОСЛЕ ГЕНЕРАЦИИ - ОБЯЗАТЕЛЬНАЯ ВАЛИДАЦИЯ! 🚨

ПРОВЕРЬ ПЕРЕД ОТПРАВКОЙ:
1. ✅ Проверь что ВСЕ разделы из требований покрыты Stories (кроме Backend API)
2. ✅ Проверь что НЕТ Stories для Backend API (это должны быть Codes!)
3. ✅ Проверь что есть Scenarios для негативных случаев (ошибки, пустые данные, null)
4. ✅ Проверь что есть Scenarios для всех условий "если...то..."
5. ✅ Проверь что НЕТ избыточной детализации Codes (один Code для UI-блока, не для каждого поля)
6. ✅ Проверь что НЕТ дублирования (одинаковые Stories с разными requirement)
7. ✅ Проверь что все элементы имеют UUID v4 и поле requirement

ЕСЛИ ХОТЬ ОДИН ПУНКТ НЕ ВЫПОЛНЕН - ПЕРЕДЕЛАЙ МОДЕЛЬ!

Ответ — **только** чистый JSON. Обязательно тестовая модель только на русском языке.

        СТРОГОЕ ПРАВИЛО ДЛЯ HTTP-ЭНДПОИНТОВ: узлы Code, описывающие HTTP‑запросы (GET|POST|PUT|PATCH|DELETE "/..."), добавляй ТОЛЬКО если метод и путь явно указаны в тексте требований. Если в требованиях нет однозначного упоминания такого запроса — не добавляй его и не придумывай.
`.trim();


        // === ЧАНКОВАНИЕ БОЛЬШИХ ТРЕБОВАНИЙ ===
        const reqChunks = chunkTextBySize(reqStringForModel, 120000);
        const totalSize = reqStringForModel.length;
        
        console.log(`[generate-test-model-async] Требования разбиты на ${reqChunks.length} чанк(ов), общий размер: ${totalSize} символов`);

        const partialModels = [];

        // === ГЕНЕРАЦИЯ ДЛЯ КАЖДОГО ЧАНКА ===
        for (let chunkIdx = 0; chunkIdx < reqChunks.length; chunkIdx++) {
            const reqChunk = reqChunks[chunkIdx];
            const progress = Math.round(((chunkIdx + 1) / reqChunks.length) * 100);

            // Батчим обновления прогресса (каждые 10%)
            if (progress % 10 === 0) {
                await db('generation_tasks').where('id', taskId).update({
                    progress,
                    updated_at: new Date()
                });
            }

            if (reqChunks.length > 1) {
                console.log(`[generate-test-model-async] Обработка чанка ${chunkIdx + 1}/${reqChunks.length}...`);
            }

            // Модифицируем промпт для чанков
            let userPrompt = reqChunk;
            if (reqChunks.length > 1) {
                userPrompt = `ВНИМАНИЕ: Это часть ${chunkIdx + 1} из ${reqChunks.length} от общего документа требований.

                🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ РАБОТЫ С ЧАНКАМИ! 🚨
                
                ТЫ ВИДИШЬ ТОЛЬКО ЧАСТЬ ДОКУМЕНТА, поэтому:
                
                1. **ИЗВЛЕКАЙ ВСЕ РАЗДЕЛЫ**: Найди ВСЕ нумерованные разделы в ЭТОЙ части (формат X.X, X.X.X)
                2. **СОЗДАВАЙ STORIES**: Для КАЖДОГО найденного раздела создай Story с полем requirement = "номер раздела"
                3. **НЕ ПРОПУСКАЙ**: Даже если раздел кажется неполным или обрывается на середине - всё равно создай Story
                4. **НЕПОЛНЫЕ SCENARIOS**: Если видишь действия пользователя без реакций системы → создай Scenario с пустым массивом codes
                5. **НЕПОЛНЫЕ CODES**: Если видишь описания системных реакций без контекста → создай Code в том Scenario, который есть
                
                ПРИМЕРЫ ИЗВЛЕЧЕНИЯ requirement ИЗ ЭТОГО ЧАНКА:
                - Если видишь "### X.X.X Название функции" → Story { text: "Название функции", requirement: "X.X.X" }
                - Если видишь "**X.X** Валидация" → Story { text: "Валидация", requirement: "X.X" }
                - Если видишь "X.X Название раздела" → Story { text: "Название раздела", requirement: "X.X" }
                - Если видишь "п. X.X.X" или "Раздел X.X.X:" → извлеки номер и создай Story
                - Если видишь "## X.X.X.X Подраздел" → Story { text: "Подраздел", requirement: "X.X.X.X" }
                - Если раздел обрывается на середине → всё равно создай Story с requirement и той информацией, что есть
                
                ВАЖНО: Все чанки будут объединены автоматически, поэтому:
                - НЕ беспокойся о дублях - они будут удалены
                - НЕ пытайся угадать что в других чанках - работай только с тем, что видишь
                - ГЛАВНОЕ - не пропусти ни одного нумерованного раздела в ЭТОЙ части!
                
                ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ:
                Просканировал ли ты ВЕСЬ этот чанк от начала до конца?
                Нашел ли ты ВСЕ нумерованные разделы (X.X, X.X.X)?
                Создал ли ты Story с requirement для КАЖДОГО раздела?

${reqChunk}`;

            } else {
                // Для одного чанка - явно просим генерировать ПОЛНУЮ модель
                userPrompt = `🚨 КРИТИЧЕСКИ ВАЖНО: ГЕНЕРИРУЙ ПОЛНУЮ ТЕСТОВУЮ МОДЕЛЬ! 🚨

ОБЯЗАТЕЛЬНО: Проанализируй ВСЕ требования и создай ПОЛНУЮ тестовую модель со ВСЕМИ функциями!

ПРАВИЛА ГЕНЕРАЦИИ ПОЛНОЙ МОДЕЛИ:
1. **НАЙДИ ВСЕ РАЗДЕЛЫ**: Просканируй весь документ и найди ВСЕ нумерованные разделы (X.X, X.X.X, X.X.X.X)
2. **СОЗДАЙ STORIES ДЛЯ КАЖДОГО**: Для КАЖДОГО найденного раздела создай отдельную Story с requirement = "номер раздела"
3. **НЕ ОСТАНАВЛИВАЙСЯ**: НЕ создавай только одну Story - создавай Story для КАЖДОГО раздела!
4. **НЕ ОБЪЕДИНЯЙ**: Не объединяй разные разделы в одну Story - каждый раздел = отдельная Story
5. **ПОКРОЙ ВСЕ ФУНКЦИИ**: Если в требованиях упоминается несколько функций - создай Stories для ВСЕХ
6. **ДЕТАЛИЗИРУЙ**: Для каждой Story создай Scenarios и Codes согласно содержимому раздела

🚨 ПРИМЕР: Если в требованиях есть разделы 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7, 2.2.8 - создай Story для КАЖДОГО! 🚨

ПРИМЕРЫ ИЗВЛЕЧЕНИЯ requirement:
- "### X.X.1 Название функции" → Story { text: "Название функции", requirement: "X.X.1" }
- "## X.X Валидация полей" → Story { text: "Валидация полей", requirement: "X.X" }
- "X.X.2 Повтор операций" → Story { text: "Повтор операций", requirement: "X.X.2" }
- "### X.X.3 Платежи" → Story { text: "Платежи", requirement: "X.X.3" }
- "### X.X.4 Переводы" → Story { text: "Переводы", requirement: "X.X.4" }
- "### X.X.5 Авторизация" → Story { text: "Авторизация", requirement: "X.X.5" }
- "### X.X.6 Валидация" → Story { text: "Валидация", requirement: "X.X.6" }
- "### X.X.7 Повтор платежей" → Story { text: "Повтор платежей", requirement: "X.X.7" }
- "### X.X.8 Повтор переводов" → Story { text: "Повтор переводов", requirement: "X.X.8" }

🚨 ВАЖНО: НЕ ОСТАНАВЛИВАЙСЯ НА ОДНОЙ STORY! 🚨
Если в требованиях есть несколько разделов - создай Story для КАЖДОГО!

ЗАПРЕЩЕНО: Создавать только одну Story для всего документа!
ОБЯЗАТЕЛЬНО: Создавать отдельные Stories для каждого раздела требований!
ОБЯЗАТЕЛЬНО: Продолжать создавать Stories пока не покроешь ВСЕ разделы!
ЗАПРЕЩЕНО: Останавливаться на первом найденном разделе!

ТРЕБОВАНИЯ ДЛЯ АНАЛИЗА:
${reqChunk}`;
            }

            const tools = [buildSubmitModelTool()];
            const ai = await callWithCloudRuFallback(
                OPENROUTER_URL,
                [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt }
                ],
                config.openRouterAiKey,
                {
                    tools,
                    // tool_choice убран для Cloud.ru совместимости
                    temperature: 0,
                    top_p: 0.9,
                    max_tokens: 80000,
                    extra: { transforms: 'middle-out' }
                }
            );

            // 1) Пытаемся забрать tool-call
            let args = extractToolArgs(ai, "submit_test_model");
            let partialModel;

            if (args && Array.isArray(args.model)) {
                partialModel = args.model;
            } else {
                // 2) Фолбэк: из content вырезаем массив
                let content = ai.choices?.[0]?.message?.content?.trim();
                if (!content) {
                    console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}: AI не вернул результата`);
                    continue;
                }

                const firstBracket = content.indexOf('[');
                const lastBracket = content.lastIndexOf(']');
                if (firstBracket === -1 || lastBracket === -1) {
                    console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}: Не найден JSON-массив`);
                    continue;
                }
                let jsonText = content.slice(firstBracket, lastBracket + 1);
                jsonText = jsonText.replace(/"(\s*)"code":/g, '", "code":');

                try {
                    let parsed = JSON5.parse(jsonText);
                    // если плоская структура — поднимем
                    const isFlat = parsed.length > 0 && parsed[0].hasOwnProperty('Feature');
                    partialModel = isFlat ? transformToHierarchy(parsed) : parsed;
                } catch (parseErr) {
                    console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}: Ошибка парсинга JSON:`, parseErr.message);
                    continue;
                }
            }

            if (partialModel && Array.isArray(partialModel) && partialModel.length > 0) {
                partialModels.push(partialModel);

                // Подробная статистика по чанку
                let totalStories = 0, totalScenarios = 0, totalCodes = 0;
                let scenariosWithoutCodes = 0;

                for (const feature of partialModel) {
                    // Убрано детальное логирование структуры чанков
                }
                // Убрано избыточное логирование статистики чанков
            }
        }

        // Объединяем все частичные модели
        if (partialModels.length === 0) {
            console.error('[generate-test-model-async] Не удалось получить валидные модели ни из одного чанка');
            console.error('[generate-test-model-async] Попробуем создать базовую модель...');

            // Создаем базовую модель как fallback с уникальными ID
            const fallbackModel = [{
                id: uuidv4(),
                text: "Основная функциональность",
                stories: [{
                    id: uuidv4(),
                    text: "Базовый сценарий",
                    scenarios: [{
                        id: uuidv4(),
                        text: "Основной тест",
                        codes: [{
                            id: uuidv4(),
                            text: "Проверить основную функциональность"
                        }]
                    }]
                }]
            }];

            partialModels.push(fallbackModel);
            console.log('[generate-test-model-async] Создана fallback модель');
        }

        // Просто объединяем массивы моделей без слияния по тексту
        // Каждый элемент теперь имеет уникальный ID
        let mergedModel = [];
        for (const partialModel of partialModels) {
            mergedModel = mergedModel.concat(partialModel);
        }

        // Подробная статистика по слиянию
        if (partialModels.length > 1) {
            const totalFeatures = mergedModel.length;
            const totalStories = mergedModel.reduce((sum, f) => sum + (f.stories || []).length, 0);
            const totalScenarios = mergedModel.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);
            const totalCodes = mergedModel.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) =>
                    s + (st.scenarios || []).reduce((sc, scn) => sc + (scn.codes?.length || 0), 0), 0), 0);

            // Подсчитываем scenarios без codes ПОСЛЕ слияния
            let scenariosWithoutCodesAfterMerge = 0;
            for (const feature of mergedModel) {
                for (const story of (feature.stories || [])) {
                    for (const scenario of (story.scenarios || [])) {
                        if ((scenario.codes || []).length === 0) {
                            scenariosWithoutCodesAfterMerge++;
                            console.warn(`⚠️ [generate-test-model-async] ПОСЛЕ СЛИЯНИЯ: Scenario БЕЗ codes в "${feature.text}" → "${story.text}" → "${scenario.text}"`);
                        }
                    }
                }
            }

            console.log(`[generate-test-model-async] MERGED: ${partialModels.length} чанков → ${totalFeatures} Features, ${totalStories} Stories, ${totalScenarios} Scenarios (БЕЗ codes: ${scenariosWithoutCodesAfterMerge}), ${totalCodes} Codes`);
        }

        // Добавляем уникальные ID к каждому элементу модели
        const addUniqueIds = (model) => {
            return (model || []).map(feature => ({
                id: feature.id || uuidv4(),
                text: feature.text,
                requirement: feature.requirement || extractRequirementFromText(feature.text),
                stories: (feature.stories || []).map(story => ({
                    id: story.id || uuidv4(),
                    text: story.text,
                    requirement: story.requirement || extractRequirementFromText(story.text),
                    scenarios: (story.scenarios || []).map(scenario => ({
                        id: scenario.id || uuidv4(),
                        text: scenario.text,
                        requirement: scenario.requirement || extractRequirementFromText(scenario.text),
                        codes: (scenario.codes || []).map(code => ({
                            id: code.id || uuidv4(),
                            text: code.text,
                            requirement: code.requirement || extractRequirementFromText(code.text)
                        }))
                    }))
                }))
            }));
        };

        // Функция извлечения requirement из текста элемента
        function extractRequirementFromText(text) {
            if (!text) return null;

            // Ищем паттерны типа "2.2.7", "4.3", "1.2.3.4" в тексте
            const requirementPattern = /\b(\d+(?:\.\d+)+)\b/g;
            const matches = text.match(requirementPattern);

            if (matches && matches.length > 0) {
                // Возвращаем первое найденное требование
                return matches[0];
            }

            return null;
        }

        const finalModel = addUniqueIds(mergedModel);

        // === ВАЛИДАЦИЯ ПОСЛЕ ГЕНЕРАЦИИ МОДЕЛИ ===
        console.log(`[generate-test-model-async] Валидация сгенерированной модели...`);

        // Проверка наличия requirement у всех элементов
        const elementsWithoutRequirement = [];
        const elementsWithInvalidRequirement = [];

        // Паттерн для валидного requirement: X.X, X.X.X, X.X.X.X и т.д.
        const validRequirementPattern = /^\d+(\.\d+)+$/;

        finalModel.forEach(feature => {
            if (!feature.requirement) {
                elementsWithoutRequirement.push(`Feature: ${feature.text}`);
            } else if (!validRequirementPattern.test(feature.requirement)) {
                elementsWithInvalidRequirement.push(`Feature: ${feature.text} (${feature.requirement}) - неверный формат, ожидается X.X или X.X.X`);
            }

            (feature.stories || []).forEach(story => {
                if (!story.requirement) {
                    elementsWithoutRequirement.push(`Story: ${story.text}`);
                } else if (!validRequirementPattern.test(story.requirement)) {
                    elementsWithInvalidRequirement.push(`Story: ${story.text} (${story.requirement}) - неверный формат, ожидается X.X или X.X.X`);
                }

                (story.scenarios || []).forEach(scenario => {
                    if (!scenario.requirement) {
                        elementsWithoutRequirement.push(`Scenario: ${scenario.text}`);
                    } else if (!validRequirementPattern.test(scenario.requirement)) {
                        elementsWithInvalidRequirement.push(`Scenario: ${scenario.text} (${scenario.requirement}) - неверный формат, ожидается X.X или X.X.X`);
                    }

                    (scenario.codes || []).forEach(code => {
                        if (!code.requirement) {
                            elementsWithoutRequirement.push(`Code: ${code.text}`);
                        } else if (!validRequirementPattern.test(code.requirement)) {
                            elementsWithInvalidRequirement.push(`Code: ${code.text} (${code.requirement}) - неверный формат, ожидается X.X или X.X.X`);
                        }
                    });
                });
            });
        });

        // Убрано избыточное логирование валидации

        // Проверка покрытия критических требований
        const criticalRequirements = ['2.2.7', '2.2.8'];
        const coveredRequirements = new Set();

        finalModel.forEach(feature => {
            if (feature.requirement && criticalRequirements.includes(feature.requirement)) {
                coveredRequirements.add(feature.requirement);
            }
            (feature.stories || []).forEach(story => {
                if (story.requirement && criticalRequirements.includes(story.requirement)) {
                    coveredRequirements.add(story.requirement);
                }
            });
        });

        const missingCriticalRequirements = criticalRequirements.filter(req => !coveredRequirements.has(req));
        // Убрано логирование критических требований

        await db('generation_tasks').where('id', taskId).update({
            status: 'completed',
            progress: 100,
            result: { testModel: finalModel },
            completed_at: new Date(),
            updated_at: new Date()
        });

        console.log(`[generate-test-model-async] Задача ${taskId} завершена успешно`);

    } catch (error) {
        console.error('Ошибка асинхронной генерации тестовой модели:', error);
        await db('generation_tasks').where('id', taskId).update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date()
        });
    }
}

app.post('/api/generate-test-model-async', async (req, res) => {
    try {
        const taskId = uuidv4();

        // ОЧИЩАЕМ КЭШ ПЕРЕД НОВОЙ ГЕНЕРАЦИЕЙ ТЕСТОВОЙ МОДЕЛИ
        console.log(`[generate-test-model-async] Очищаем кэш перед генерацией тестовой модели taskId: ${taskId}`);
        for (const [key, value] of taskStatusCache.entries()) {
            if (key.includes('status_') || key.includes('model_status_')) {
                taskStatusCache.delete(key);
            }
        }

        await db('generation_tasks').insert({
            id: taskId,
            type: 'test_model',
            status: 'processing',
            progress: 0,
            input_data: req.body,
            created_at: new Date(),
            updated_at: new Date()
        });

        generateTestModelAsync(taskId, req.body);

        res.json({ taskId, status: 'started' });
    } catch (error) {
        console.error('Ошибка создания задачи генерации тестовой модели:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/generate-test-model-status/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const cacheKey = `model_status_${taskId}`;

        // Проверяем кэш
        const cached = taskStatusCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5000) {
            return res.json(cached.data);
        }

        const task = await db('generation_tasks').where('id', taskId).first();

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const responseData = {
            id: task.id,
            status: task.status,
            progress: task.progress,
            result: task.result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        };

        // Кэшируем результат
        taskStatusCache.set(cacheKey, {
            data: responseData,
            timestamp: Date.now()
        });

        res.json(responseData);
    } catch (error) {
        console.error('Ошибка получения статуса генерации тестовой модели:', error);
        res.status(500).json({ error: error.message });
    }
});



/**
 * GET /api/shared-steps
 * Query:
 *   - projectId (обязательный)
 *   - page      (опционально, default=0)
 *   - size      (опционально, default=20)
 *   - archived  (опционально, default=false)
 *   - search    (опционально) — подстрока для фильтрации по имени шага
 */
app.get('/api/shared-steps', async (req, res) => {
    try {
        const {
            projectId,
            page = '0',
            size = '20',
            archived = 'false',
            search = ''
        } = req.query;

        if (!projectId) {
            return res.status(400).json({ error: 'projectId is required' });
        }

        const data = await getSharedStepsList({
            projectId,
            page: Number(page),
            size: Number(size),
            archived: archived === 'true',
            search: String(search)
        });

        res.json(data);
    } catch (err) {
        console.error('Ошибка в /api/shared-steps:', err);
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/create-test-cases', async (req, res) => {
    const { projectId, cases } = req.body;
    if (!projectId || !Array.isArray(cases)) {
        return res.status(400).json({ error: 'projectId и массив cases обязательны' });
    }

    try {
        // 1) Загрузили словарь слоёв
        const layers = await suggestTestLayers();
        const layerMap = Object.fromEntries(layers.map(l => [l.name, l.id]));

        // 2) Схема кастомных полей
        const schema = await getProjectCustomFieldSchema(projectId);
        const cfMap = {};
        for (const e of schema) {
            const id = e?.customField?.id;
            const key = e?.key;
            const name = e?.customField?.name;
            if (id && key) cfMap[String(key).toLowerCase()] = id;
            if (id && name) cfMap[String(name).toLowerCase()] = id;
        }

        // 3) Подгружаем существующие проектные теги (чтобы потом создавать новые, если их нет)
        const projectTags = await suggestTags(projectId);

        const created = [];
        for (const c of cases) {
            // 4) Создаём TC
            const tc = await createTestCaseAllure({ projectId, name: c.title });
            const testCaseId = tc.id;

            // 5) Обновляем precondition и expectedResult
            await updateTestCase(testCaseId, {
                precondition: c.precondition,
                expectedResult: c.expected,
            });

            // 6) Добавляем шаги
            let lastStepId;
            for (const step of c.steps || []) {
                const params = { testCaseId };
                if (typeof step === 'object' && step.sharedStepId) {
                    params.sharedStepId = step.sharedStepId;
                } else {
                    params.body = typeof step === 'string' ? step : step.text;
                }
                if (lastStepId) params.afterId = lastStepId;
                const added = await addStepToTestCase(testCaseId, params);
                lastStepId = added.id;
            }

            // 7) Теги — делаем единый PATCH c полем tags
            if (Array.isArray(c.tags) && c.tags.length) {
                // 7.1) Убедиться, что все имена тегов существуют в проекте
                for (const tagName of c.tags) {
                    if (!projectTags.some(t => t.name === tagName)) {
                        const newTag = await createTag(tagName);
                        projectTags.push(newTag);
                    }
                }
                // 7.2) Собираем payload для PATCH
                const tagsPayload = c.tags.map(name => ({ name }));
                await fetchWithAuth(
                    `${config.baseUrl}/testcase/${testCaseId}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tags: tagsPayload })
                    }
                );
            }

            // 8) Ссылки — как раньше
            if (Array.isArray(c.links) && c.links.length) {
                const existing = (await fetchWithAuth(
                    `${config.baseUrl}/testcase/${testCaseId}`
                ).then(r => r.json())).links || [];
                const toAdd = c.links.map(l => ({
                    name: l.text,
                    url: l.url,
                    ...(l.type ? { type: l.type } : {})
                }));
                await fetchWithAuth(
                    `${config.baseUrl}/testcase/${testCaseId}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ links: existing.concat(toAdd) })
                    }
                );
            }

            // 9) Jira Issue
            const jiraKey = c?.jiraIssueOption?.value || c?.jiraIssue;
            if (jiraKey) {
                const integrationId = c?.jiraIssueOption?.integrationId || config.defaultJiraIntegrationId;
                await linkIssueToTestCase(testCaseId, integrationId, jiraKey);
            }

            // 10) Слой
            if (c.layer && layerMap[c.layer] != null) {
                await setTestCaseLayer(testCaseId, layerMap[c.layer]);
            }

            // 11) Кастомные поля
            const cfvById = new Map();

            const putCF = (fieldNameOrKey, raw) => {
                if (raw == null) return;
                const val = String(raw).trim();
                if (!val) return;                      // не шлём пустые значения
                const id = cfMap[String(fieldNameOrKey).toLowerCase()];
                if (!id) return;                       // такого CF нет в проекте
                // Последняя запись побеждает, без дублей по одному ID
                cfvById.set(id, { customField: { id }, name: val });
            };

            // стандартные поля из кейса
            putCF('Feature', c.feature);
            putCF('Story', c.story);
            putCF('Scenario', c.scenario);
            putCF('Version', c.version);
            putCF('Priority', c.priority);

            // поддержка Code:
            // 1) если бэкенд когда-то получит c.code — возьмём его
            // 2) фронт сейчас шлёт codeNode
            // 3) а ещё может прийти из customFields
            putCF('Code', c.code || c.codeNode);

            // добираем то, что пришло в cases[].customFields (если фронт их шлёт)
            if (Array.isArray(c.customFields)) {
                for (const { name, value } of c.customFields) {
                    if (!name) continue;
                    putCF(name, value);
                }
            }

            const cfv = Array.from(cfvById.values());
            if (cfv.length) {
                await setTestCaseCustomFieldValues(testCaseId, cfv);
            }

            // 12) Параметры и примеры (если есть)
            if (Array.isArray(c.parameters) && c.parameters.length > 0) {
                // В Allure параметры определяются через массив "parameters" в тест-кейсе
                // Но для добавления нужно использовать PATCH с полем parameters
                try {
                    // Получаем текущий тест-кейс
                    const currentTC = await fetchWithAuth(`${config.baseUrl}/testcase/${testCaseId}`).then(r => r.json());
                    
                    // Формируем массив параметров (только имена, без значений)
                    const parametersForApi = c.parameters
                        .filter(p => p.name && p.name.trim())
                        .map(p => ({ name: p.name.trim() }));
                    
                    if (parametersForApi.length > 0) {
                        // Обновляем тест-кейс с параметрами
                        await fetchWithAuth(
                            `${config.baseUrl}/testcase/${testCaseId}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ parameters: parametersForApi })
                            }
                        );
                        console.log(`[create-test-cases] Добавлено ${parametersForApi.length} параметров для ТК ${testCaseId}`);
                    }
                } catch (err) {
                    console.warn(`[create-test-cases] Не удалось добавить параметры для ТК ${testCaseId}:`, err.message);
                }

                // Добавляем примеры (конкретные комбинации параметров)
                if (Array.isArray(c.examples) && c.examples.length > 0) {
                    try {
                        // Преобразуем examples в формат Allure API
                        // Allure ожидает: Array<Array<{name: string, value: string}>>
                        // То есть массив массивов параметров, а не массив объектов с полем parameters
                        const examplesForApi = c.examples
                            .filter(ex => ex.parameters && Array.isArray(ex.parameters))
                            .map(example => 
                                example.parameters
                                    .filter(p => p.name && p.value !== undefined && p.value !== '')
                                    .map(p => ({
                                        name: String(p.name).trim(),
                                        value: String(p.value).trim()
                                    }))
                            )
                            .filter(exParams => exParams.length > 0);
                        
                        if (examplesForApi.length > 0) {
                            await createTestCaseExamples(testCaseId, examplesForApi);
                            console.log(`[create-test-cases] Добавлено ${examplesForApi.length} примеров для ТК ${testCaseId}`);
                        }
                    } catch (err) {
                        console.warn(`[create-test-cases] Не удалось добавить примеры для ТК ${testCaseId}:`, err.message);
                    }
                } else if (c.parameters && c.parameters.length > 0) {
                    // Если примеров нет, но есть параметры - можно сгенерировать pairwise
                    // Но это опционально, так как может быть слишком много комбинаций
                    console.log(`[create-test-cases] ТК ${testCaseId} имеет параметры, но нет примеров. Можно сгенерировать pairwise вручную.`);
                }
            }

            created.push({ id: testCaseId });
        }

        res.json({ success: true, created });
    } catch (err) {
        console.error('Ошибка при массовом создании ТК:', err);
        res.status(500).json({ error: err.message });
    }
});




async function generateTestCasesAsync(taskId, inputData) {
    // Объявляем переменную в начале функции
    let finalTestCases = [];

    try {
        await db('generation_tasks').where('id', taskId).update({
            status: 'processing',
            progress: 0,
            updated_at: new Date()
        });

        // === Вспомогательные функции ===
        function buildModelIndex(model) {
            const scenarioSet = new Set();
            const codeTo = new Map();              // "код шага" → { scenario, story, feature }
            const scenarioToParent = new Map();    // "сценарий" → { story, feature }
            const storyToFeature = new Map();

            for (const f of (model || [])) {
                for (const st of (f.stories || [])) {
                    if (st?.text?.trim()) storyToFeature.set(st.text.trim(), f.text?.trim() || '');
                    for (const sc of (st.scenarios || [])) {
                        scenarioSet.add(sc.text);
                        scenarioToParent.set(sc.text, { story: st.text, feature: f.text });
                        for (const cd of (sc.codes || [])) {
                            codeTo.set(cd.text, { scenario: sc.text, story: st.text, feature: f.text });
                        }
                    }
                }
            }
            return { scenarioSet, codeTo, scenarioToParent, storyToFeature };
        }

        // УНИВЕРСАЛЬНАЯ функция проверки покрытия требований
        // ✅ УНИВЕРСАЛЬНАЯ функция поиска похожих требований
        function findSimilarRequirements(requiredIds, missingIds) {
            const similar = [];

            for (const missing of missingIds) {
                // Проверяем есть ли "соседние" требования (2.2.7 и 2.2.8)
                const parts = missing.split('.');
                if (parts.length >= 2) {
                    const baseNumber = parseInt(parts[parts.length - 1]);

                    // Ищем соседей (N-1, N+1)
                    for (const offset of [-1, 1]) {
                        const neighborNumber = baseNumber + offset;
                        const neighborReq = [...parts.slice(0, -1), neighborNumber].join('.');

                        if (requiredIds.has(neighborReq) && !missingIds.includes(neighborReq)) {
                            similar.push([missing, neighborReq]);
                        }
                    }
                }
            }

            return similar;
        }

        function checkRequirementsCoverage(testCases, requirements) {
            console.log(`[checkRequirementsCoverage] Проверка покрытия требований по requirementId...`);

            // Собираем все requirementId из требований (извлекаем разделы)
            const requiredIds = new Set();
            // Улучшенный regex для парсинга требований из любого места в тексте
            const sectionPattern = /(?:^#{1,3}\s*|^|\b)(\d+\.\d+(?:\.\d+)*?)(?:\s|$|\.|,)/gm;

            if (requirements && typeof requirements === 'string') {
                let match;
                while ((match = sectionPattern.exec(requirements)) !== null) {
                    requiredIds.add(match[1]);
                }
            }

            // Если не нашли разделы в требованиях - попробуем альтернативный парсинг
            if (requiredIds.size === 0) {
                console.log(`[checkRequirementsCoverage] Попытка альтернативного парсинга требований...`);
                const altPattern = /\b(\d+\.\d+(?:\.\d+)*)\b/g;
                let match;
                while ((match = altPattern.exec(requirements)) !== null) {
                    requiredIds.add(match[1]);
                }

                // Если всё ещё ничего не нашли - используем простую проверку
                if (requiredIds.size === 0) {
                    return {
                        coveragePercentage: 100,
                        covered: 1,
                        total: 1,
                        missingRequirementIds: []
                    };
                }
            }

            // Собираем все requirement из тест-кейсов
            const coveredIds = new Set();
            for (const tc of testCases) {
                if (tc.requirement) {
                    coveredIds.add(tc.requirement);

                    // ✅ ДОБАВЛЕНО: Также покрываем родительские разделы
                    // Если requirement = "2.2.1", то покрываем также "2.2"
                    const parts = tc.requirement.split('.');
                    for (let i = 1; i < parts.length; i++) {
                        const parentReq = parts.slice(0, i).join('.');
                        if (parentReq) coveredIds.add(parentReq);
                    }
                }
            }

            console.log(`[checkRequirementsCoverage] Покрытые требования (с родительскими):`,
                Array.from(coveredIds).sort());

            // Находим недостающие requirementId
            const missingRequirementIds = [];
            for (const reqId of requiredIds) {
                if (!coveredIds.has(reqId)) {
                    missingRequirementIds.push(reqId);
                }
            }

            const total = requiredIds.size;
            const covered = total - missingRequirementIds.length;
            const coveragePercentage = total > 0 ? Math.round((covered / total) * 100) : 100;

            console.log(`[checkRequirementsCoverage] Покрытие: ${covered}/${total} (${coveragePercentage}%)`);
            console.log(`[checkRequirementsCoverage] Недостающие требования: ${missingRequirementIds.join(', ')}`);
            console.log(`[checkRequirementsCoverage] Найденные требования в тексте: ${Array.from(requiredIds).sort().join(', ')}`);
            console.log(`[checkRequirementsCoverage] Покрытые требования в тест-кейсах: ${Array.from(coveredIds).sort().join(', ')}`);

            // ✅ ДЕТАЛЬНАЯ ПРОВЕРКА КОНКРЕТНЫХ ТРЕБОВАНИЙ
            const criticalRequirements = ['2.2.4', '2.2.8'];
            for (const req of criticalRequirements) {
                const isRequired = requiredIds.has(req);
                const isCovered = coveredIds.has(req);
                console.log(`[checkRequirementsCoverage] 🔍 ${req}: required=${isRequired}, covered=${isCovered}`);
            }

            // ✅ ДОБАВЛЕНО: Проверка на "похожие" требования
            const similarRequirements = findSimilarRequirements(requiredIds, missingRequirementIds);

            if (similarRequirements.length > 0) {
                console.warn(`[checkRequirementsCoverage] ⚠️ ВНИМАНИЕ: Найдены похожие требования, которые могут быть пропущены!`);
                for (const [missing, covered] of similarRequirements) {
                    console.warn(`  - ${missing} не покрыт, но ${covered} покрыт (возможно модель их объединила)`);
                }
            }

            // Дополнительная отладка: покажем примеры тест-кейсов с полем requirement
            const examplesWithRequirement = testCases.filter(tc => tc.requirement).slice(0, 3);
            if (examplesWithRequirement.length > 0) {
                console.log(`[checkRequirementsCoverage] Примеры тест-кейсов с полем requirement:`,
                    examplesWithRequirement.map(tc => ({ title: tc.title, requirement: tc.requirement })));
            } else {
                console.log(`[checkRequirementsCoverage] ВНИМАНИЕ: Нет тест-кейсов с полем requirement!`);
            }

            return {
                coveragePercentage,
                covered,
                total,
                missingRequirementIds,
                coveredRequirementIds: Array.from(coveredIds),
                similarRequirements  // ✅ Возвращаем для догенерации
            };
        }

        function validateTestPyramid(testCases, modelStructure) {
            console.log(`[validateTestPyramid] Проверка соблюдения пирамиды тестирования...`);

            const S = modelStructure.reduce((sum, f) => sum + (f.stories || []).length, 0);
            const Sc = modelStructure.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);

            const layerCounts = testCases.reduce((acc, tc) => {
                acc[tc.layer] = (acc[tc.layer] || 0) + 1;
                return acc;
            }, {});

            const e2eCount = layerCounts['E2E Tests'] || 0;
            const integrationCount = (layerCounts['Integration frontend Tests'] || 0) +
                (layerCounts['Integration backend Tests'] || 0);
            const unitCount = (layerCounts['Unit frontend Tests'] || 0) +
                (layerCounts['Unit backend Tests'] || 0);

            const expectedE2E = Math.max(1, S);
            const expectedE2EMax = expectedE2E + 3;
            const expectedIntegrationMin = Sc * 2;
            const expectedIntegrationMax = Sc * 4 + 5;

            console.log(`[validateTestPyramid] Модель: Stories=${S}, Scenarios=${Sc}`);
            console.log(`[validateTestPyramid] Ожидается: E2E=${expectedE2E}-${expectedE2EMax}, Integration=${expectedIntegrationMin}-${expectedIntegrationMax}, Unit=гибко`);
            console.log(`[validateTestPyramid] Получено: E2E=${e2eCount}, Integration=${integrationCount}, Unit=${unitCount}`);

            const warnings = [];

            if (e2eCount > expectedE2EMax) {
                warnings.push(`⚠️ ПЕРЕКОС: Слишком много E2E тестов (${e2eCount} вместо ${expectedE2E}-${expectedE2EMax}). Возможно дублируются для iOS/Android!`);
            }

            if (integrationCount > expectedIntegrationMax) {
                warnings.push(`⚠️ ПЕРЕКОС: Слишком много Integration тестов (${integrationCount} вместо ${expectedIntegrationMin}-${expectedIntegrationMax}). Возможны дубликаты для doc_type!`);
            }

            if (e2eCount < Math.max(1, Math.floor(S * 0.7))) {
                warnings.push(`⚠️ НЕДОСТАТОК: Мало E2E тестов (${e2eCount} вместо минимум ${Math.floor(S * 0.7)})`);
            }

            if (warnings.length > 0) {
                console.warn(`[validateTestPyramid] ❌ Найдены нарушения пирамиды:`);
                warnings.forEach(w => console.warn(w));
            } else {
                console.log(`[validateTestPyramid] ✅ Пирамида соблюдена!`);
            }

            return { valid: warnings.length === 0, warnings };
        }



        function getRequirementPriority(key) {
            const priorities = {
                authorization: 'Critical',
                qrPayment: 'High',
                sbpTopup: 'High',
                transfers: 'High',
                categoryPayment: 'Medium',
                requisitesPayment: 'Medium',
                repeatOperations: 'Medium',
                trayRestore: 'Medium',
                mainPage: 'Low'
            };
            return priorities[key] || 'Medium';
        }

        // НОВАЯ ФУНКЦИЯ: Догенерация тест-кейсов для недостающих требований (асинхронная версия)
        async function gapFillRequirements(requirements, missingRequirements, systemPrompt, modelStructure) {
            console.log(`[gapFillRequirements-ASYNC] Догенерируем тест-кейсы для ${missingRequirements.length} недостающих функциональностей`);

            // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Генерируем allowedForChunk и allowedScenarios
            const allowedForChunk = collectAllowedCodes(modelStructure);
            const allowedScenarios = collectAllowedScenarios(modelStructure);

            const allGapCases = [];

            for (const missingReq of missingRequirements) {
                console.log(`[gapFillRequirements-ASYNC] Обрабатываем недостающую функциональность: ${missingReq.functionality} (${missingReq.priority})`);

                // ✅ ПРАВИЛЬНО: БЕЗ ХАРДКОДА
                let correctFeature = null;
                let correctStories = [];

                if (missingReq.modelContext?.feature) {
                    // 1. Пытаемся найти Feature в modelStructure
                    const foundFeature = modelStructure.find(f =>
                        f.text === missingReq.modelContext.feature
                    );

                    if (foundFeature) {
                        correctFeature = foundFeature.text;
                        correctStories = foundFeature.stories?.map(s => s.text) || [];
                        console.log(`[gapFillRequirements] ✅ Найдена Feature из модели: ${correctFeature}`);
                    } else {
                        // 2. Feature указана в modelContext, но не найдена в modelStructure
                        // Используем её как есть
                        correctFeature = missingReq.modelContext.feature;
                        correctStories = missingReq.modelContext.stories || [missingReq.functionality];
                        console.warn(`[gapFillRequirements] ⚠️ Feature "${correctFeature}" не найдена в modelStructure, используем из modelContext`);
                    }
                } else {
                    // 3. modelContext.feature отсутствует — fallback
                    if (modelStructure && modelStructure.length > 0) {
                        // Берём первую доступную Feature из модели
                        correctFeature = modelStructure[0].text;
                        correctStories = modelStructure[0].stories?.map(s => s.text) || [];
                        console.warn(`[gapFillRequirements] ⚠️ modelContext.feature отсутствует для ${missingReq.requirementId}, используем первую из modelStructure: "${correctFeature}"`);
                    } else {
                        // 4. Крайний случай: модель пустая — генерируем синтетическую Feature
                        const reqSection = missingReq.requirementId?.split('.')[0] || 'Unknown';
                        correctFeature = `Требование раздела ${reqSection}`;
                        correctStories = [missingReq.functionality];
                        console.error(`[gapFillRequirements] ❌ modelStructure пуста! Создаём синтетическую Feature для ${missingReq.requirementId}`);
                    }
                }

                // Проверка: correctFeature ОБЯЗАТЕЛЬНО должна быть определена
                if (!correctFeature) {
                    console.error(`[gapFillRequirements] ❌ КРИТИЧЕСКАЯ ОШИБКА: не удалось определить correctFeature для ${missingReq.requirementId}. Пропускаем.`);
                    continue;
                }

                const userPrompt = `
                🚨 ДОГЕНЕРАЦИЯ ДЛЯ ПРОПУЩЕННОГО ТРЕБОВАНИЯ! 🚨
                
                ЗАДАНИЕ: Создать тест-кейсы для требования ${missingReq.requirementId || 'Unknown'}
                Описание: ${missingReq.description}
                Приоритет: ${missingReq.priority}
                
                🎯 КРИТИЧЕСКИ ВАЖНО: ИСПОЛЬЗУЙ ТОЛЬКО ПРАВИЛЬНУЮ МОДЕЛЬ! 🎯
                
                ОБЯЗАТЕЛЬНО используй ТОЛЬКО эти значения:
                - feature: "${correctFeature}"
                - story: ОДИН из: ${correctStories.join(', ') || missingReq.functionality}
                
                ЗАПРЕЩЕНО создавать новые фичи или стори!
                
                ${missingReq.modelContext ? `
                КОНТЕКСТ ИЗ МОДЕЛИ:
                Feature: ${missingReq.modelContext.feature}
                Story: ${missingReq.modelContext.story}
                Requirement: ${missingReq.modelContext.requirement}
                Scenarios: ${missingReq.modelContext.scenarios.map(s => s.text).join(', ')}
                ` : ''}
                
                🎯 КРИТИЧЕСКИ ВАЖНО: ПОЛЕ REQUIREMENT! 🎯
                КАЖДЫЙ тест-кейс ОБЯЗАТЕЛЬНО должен содержать поле:
                "requirement": "${missingReq.requirementId}"
                
                БЕЗ ЭТОГО ПОЛЯ тест-кейс НЕ БУДЕТ УЧТЕН в покрытии требований!
                
                🎯 КРИТИЧЕСКИ ВАЖНО: СТРУКТУРА ТЕСТОВ! 🎯
                Для каждого requirement создай:
                1. МИНИМУМ 1-2 E2E теста (пользовательские пути)
                2. МИНИМУМ 2-3 Integration теста (API вызовы, негативные сценарии)
                3. МИНИМУМ 1-2 Unit теста (методы, функции)
                
                ${missingReq.description.includes('ОТЛИЧАЕТСЯ') ? `
                🔍 ВАЖНО: Это требование могло быть пропущено потому что оно ПОХОЖЕ на другое.
                Внимательно проанализируй РАЗЛИЧИЯ и создай УНИКАЛЬНЫЕ тест-кейсы!
                ` : ''}
                
                🚨 ПРИВЯЗКА К ТЕСТОВОЙ МОДЕЛИ! 🚨
                Тест-кейсы ДОЛЖНЫ быть привязаны к существующим элементам модели:
                - E2E Tests: привязываются к Story уровню
                - Integration Tests: привязываются к Scenario уровню  
                - Unit Tests: привязываются к Code уровню
                
                Используй следующие элементы из модели:
                ${JSON.stringify(missingReq.modelContext || {}, null, 2)}

                🎯 СТРОГИЙ МАППИНГ УРОВНЕЙ:
                - layer: "E2E Tests" → ОБЯЗАТЕЛЬНО указать feature + story + scenario (БЕЗ code)
                - layer: "Integration frontend/backend Tests" → ОБЯЗАТЕЛЬНО указать feature + story + scenario (БЕЗ code)
                - layer: "Unit frontend/backend Tests" → ОБЯЗАТЕЛЬНО указать feature + story + scenario + code
                
                🎯 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ДЛЯ КАЖДОГО ТЕСТ-КЕЙСА:
                1. title - название (строка)
                2. steps - массив шагов (МИНИМУМ 1 шаг!)
                3. expected - ожидаемый результат (строка)
                4. layer - слой тестирования (E2E/Integration/Unit)
                5. requirement - номер требования "${missingReq.requirementId}" (ОБЯЗАТЕЛЬНО!)
                6. feature - название фичи из модели
                7. story - название story из модели
                8. scenario - название scenario (для Integration/Unit)
                9. code - название code (только для Unit)
                10. priority - приоритет (High/Medium/Low)
                11. tags - массив тегов
                
                ПРИМЕРЫ ПРАВИЛЬНОЙ СТРУКТУРЫ:
                
                E2E тест:
                {
                  "title": "Повторить платеж из истории операций",
                  "steps": ["Открыть историю операций", "Выбрать платеж", "Нажать 'Повторить'"],
                  "expected": "Платеж успешно повторен",
                  "layer": "E2E Tests",
                  "requirement": "${missingReq.requirementId}",
                  "feature": "Название фичи",
                  "story": "Повтор платежей",
                  "priority": "High",
                  "tags": ["M", "S"]
                }
                
                Integration тест:
                {
                  "title": "Вызов метода GET /template/get_by_id с doc_type=payment",
                  "steps": ["Выполнить GET запрос с параметром doc_type=payment"],
                  "expected": "Получен ответ 200 с данными платежа",
                  "layer": "Integration backend Tests",
                  "requirement": "${missingReq.requirementId}",
                  "feature": "Название фичи",
                  "story": "Повтор платежей",
                  "scenario": "Повторить платеж с doc_type=payment",
                  "priority": "High",
                  "tags": ["BE"]
                }
                
                Unit тест:
                {
                  "title": "Метод getReport() вызывается при doc_type=payment",
                  "steps": ["Вызвать getReport()"],
                  "expected": "Метод возвращает массив данных",
                  "layer": "Unit frontend Tests",
                  "requirement": "${missingReq.requirementId}",
                  "feature": "Название фичи",
                  "story": "Повтор платежей",
                  "scenario": "Повторить платеж с doc_type=payment",
                  "code": "Вызвать метод getReport()",
                  "priority": "Medium",
                  "tags": ["FE"]
                }
                
                Контекст требований:
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

                🚨 КРИТИЧЕСКИ ВАЖНО: ПРИНУДИТЕЛЬНЫЕ ТРЕБОВАНИЯ! 🚨
                
                ОБЯЗАТЕЛЬНО:
                1. feature ДОЛЖНО быть "${correctFeature}"
                2. story ДОЛЖНО быть одним из: ${correctStories.join(', ') || missingReq.functionality}
                3. requirement ДОЛЖНО быть "${missingReq.requirementId}"
                4. МИНИМУМ 1-2 E2E теста на story
                5. МИНИМУМ 2-3 Integration теста на scenario
                6. МИНИМУМ 1-2 Unit теста на code
                
                Сгенерируй минимум 5-7 тест-кейсов на РАЗНЫХ уровнях (E2E, Integration frontend, Integration backend, Unit frontend, Unit backend).
                ОБЯЗАТЕЛЬНО: Каждый тест-кейс должен иметь requirement: "${missingReq.requirementId}"!
                
Ответ — ТОЛЬКО чистый JSON-массив без Markdown.
`.trim();


                const tools = [buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios)];
                const ai = await callWithCloudRuFallback(
                    OPENROUTER_URL,
                    [
                        { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}` },
                        { role: 'user', content: userPrompt }
                    ],
                    config.openRouterAiKey,
                    {
                        tools,
                        // tool_choice убран для Cloud.ru совместимости
                        temperature: 0,
                        top_p: 1,
                        max_tokens: 64000,
                        extra: { transforms: 'middle-out' }
                    }
                );

                // ✅ НОВАЯ ЛОГИКА: Обрабатываем ВСЕ tool_calls как в genForChunk
                const toolCalls = ai.choices?.[0]?.message?.tool_calls;
                if (toolCalls && toolCalls.length > 0) {
                    console.log(`[gapFillRequirements-ASYNC] Найдено ${toolCalls.length} tool_calls, обрабатываем все...`);

                    const gapCases = [];

                    for (const toolCall of toolCalls) {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            console.log(`[gapFillRequirements-ASYNC] Tool ${toolCall.function.name}:`, {
                                hasArgs: !!args,
                                argsKeys: Object.keys(args || {})
                            });

                            // ✅ ПРОСТАЯ ОБРАБОТКА: Берем поля напрямую из args.cases
                            if (args.cases && Array.isArray(args.cases)) {
                                for (const testCase of args.cases) {
                                    gapCases.push({
                                        title: testCase.title,
                                        steps: testCase.steps,
                                        expected: testCase.expected,
                                        layer: testCase.layer,
                                        feature: testCase.feature,
                                        story: testCase.story,
                                        scenario: testCase.scenario,
                                        code: testCase.code,
                                        tags: testCase.tags || [],
                                        priority: testCase.priority || 'Medium',
                                        version: testCase.version || 'stable',
                                        requirement: missingReq.requirementId, // ✅ ПРИНУДИТЕЛЬНО добавляем requirement!
                                        precondition: testCase.precondition,
                                        links: testCase.links || [],
                                        jiraIssue: testCase.jiraIssueOption?.value,
                                        parameters: testCase.parameters || [],
                                        examples: testCase.examples || []
                                    });
                                }
                                console.log(`[gapFillRequirements-ASYNC] ✅ Добавлено ${args.cases.length} тест-кейсов через tool_call`);
                            }

                        } catch (parseErr) {
                            console.error(`[gapFillRequirements-ASYNC] ❌ Ошибка парсинга tool_call ${toolCall.function.name}:`, parseErr.message);
                        }
                    }

                    if (gapCases.length > 0) {
                        console.log(`[gapFillRequirements-ASYNC] ✅ УСПЕХ: Получено ${gapCases.length} кейсов через tool_calls для ${missingReq.functionality}!`);

                        // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Правильная обработка результатов AI
                        // 1) Извлекаем все codes из модели для sanitize
                        const allCodes = [];
                        for (const feature of (modelStructure || [])) {
                            for (const story of (feature.stories || [])) {
                                for (const scenario of (story.scenarios || [])) {
                                    for (const code of (scenario.codes || [])) {
                                        allCodes.push(code.text);
                                    }
                                }
                            }
                        }

                        // 2) Санитизация
                        let sanitizedCases = sanitize(gapCases, allCodes);
                        console.log(`[gapFillRequirements-ASYNC] После sanitize: ${sanitizedCases.length} кейсов`);

                        // 3) Восстановление связей по модели
                        const modelIndex = buildModelIndex(modelStructure);
                        let finalCases = fixAgainstModel(sanitizedCases, modelIndex);
                        console.log(`[gapFillRequirements-ASYNC] После fixAgainstModel: ${finalCases.length} кейсов`);

                        allGapCases.push(...finalCases);
                        continue;
                    }
                }

                // Fallback парсинг
                const content = ai.choices?.[0]?.message?.content || '';
                const rawJsonCandidate = extractJsonArray(content);
                if (!rawJsonCandidate) continue;

                try {
                    const jsonText = cleanupJsonText(rawJsonCandidate);
                    const parsed = JSON5.parse(jsonText);
                    if (Array.isArray(parsed)) {
                        allGapCases.push(...parsed);
                        console.log(`[gapFillRequirements-ASYNC] Fallback: сгенерировано ${parsed.length} кейсов для ${missingReq.functionality}`);
                    }
                } catch (e) {
                    console.warn(`[gapFillRequirements-ASYNC] Ошибка парсинга для ${missingReq.functionality}:`, e.message);
                }
            }

            console.log(`[gapFillRequirements-ASYNC] Всего догенерировано ${allGapCases.length} кейсов для недостающих требований`);
            return allGapCases;
        }

        function fixAgainstModel(testCases, idx) {
            return testCases.map(tc => {
                const title = (tc.title || '').toLowerCase();
                const steps = (tc.steps || []).map(s => s.toLowerCase()).join(' ');
                const expected = (tc.expected || '').toLowerCase();
                const precondition = (tc.precondition || '').toLowerCase();
                let correctedLayer = tc.layer || '';

                // =============================================================
                // ПРАВИЛО 1: Integration → Unit (ТОЛЬКО изолированные методы)
                // =============================================================
                if (correctedLayer.includes('Integration')) {

                    // Unit = проверка ВОЗВРАЩАЕМОГО ЗНАЧЕНИЯ метода в ИЗОЛЯЦИИ
                    const isIsolatedMethod =
                        (title.includes('метод') && title.includes('возвращает')) ||
                        (title.includes('функция') && title.includes('возвращает')) ||
                        (title.includes('getreport()') && title.includes('возвращает')) ||
                        expected.includes('метод вернул') ||
                        expected.includes('функция вернула');

                    // Проверяем наличие ВЗАИМОДЕЙСТВИЯ (если есть → остаётся Integration!)
                    const hasInteraction =
                        title.includes('после') ||
                        title.includes('при') ||
                        title.includes('во время') ||
                        title.includes('вызов метода после') ||
                        title.includes('вызов метода при') ||
                        title.includes('авторизаци') ||
                        title.includes('инициализ') ||
                        steps.includes('post /') ||
                        steps.includes('get /') ||
                        steps.includes('вызвать post') ||
                        steps.includes('вызвать get') ||
                        steps.includes('дождаться') ||
                        steps.includes('выполнить post') ||
                        steps.includes('выполнить get') ||
                        steps.includes('открыть') ||
                        steps.includes('нажать') ||
                        expected.includes('вызван после') ||
                        expected.includes('вызван при');

                    // ПРАВИЛО: Изолированный метод БЕЗ взаимодействия → Unit
                    if (isIsolatedMethod && !hasInteraction) {
                        correctedLayer = correctedLayer.includes('frontend')
                            ? 'Unit frontend Tests'
                            : 'Unit backend Tests';
                        console.log(`[fixAgainstModel] Integration → Unit (изолированный метод): ${tc.title}`);
                    }

                    // ПРАВИЛО: Есть взаимодействие → остаётся Integration
                    if (hasInteraction) {
                        console.log(`[fixAgainstModel] ✓ Остаётся Integration (взаимодействие): ${tc.title}`);
                    }
                }

                // =============================================================
                // ПРАВИЛО 2: Unit → Integration (если проверяется взаимодействие)
                // =============================================================
                if (correctedLayer.includes('Unit')) {
                    const isIntegrationTest =
                        // UI-состояния (Component Tests)
                        expected.includes('отображается') ||
                        expected.includes('отображена') ||
                        expected.includes('доступен') ||
                        expected.includes('доступна') ||
                        expected.includes('активна') ||
                        expected.includes('форма заполнена') ||
                        // API-ответы
                        (expected.includes('статус') && expected.includes('ответ')) ||
                        expected.includes('возвращает 200') ||
                        expected.includes('возвращает 404') ||
                        expected.includes('возвращает 401') ||
                        expected.includes('возвращает 500') ||
                        // UI-действия
                        steps.includes('открыть') ||
                        steps.includes('выбрать') ||
                        steps.includes('нажать') ||
                        steps.includes('ввести') ||
                        // API-вызовы
                        steps.includes('выполнить post') ||
                        steps.includes('выполнить get') ||
                        steps.includes('вызвать post') ||
                        steps.includes('вызвать get');

                    if (isIntegrationTest) {
                        correctedLayer = correctedLayer.includes('frontend')
                            ? 'Integration frontend Tests'
                            : 'Integration backend Tests';
                        console.log(`[fixAgainstModel] Unit → Integration (взаимодействие): ${tc.title}`);
                    }
                }

                // =============================================================
                // ПРАВИЛО 3: Frontend ↔ Backend (ОДНА ПРОВЕРКА с маркером)
                // =============================================================

                // 3.1. Frontend → Backend (API-контекст)
                if (correctedLayer.includes('frontend') && !correctedLayer.includes('__fixed')) {
                    const isBackend =
                        // Явное упоминание API
                        title.includes('api post') ||
                        title.includes('api get') ||
                        title.includes('api delete') ||
                        title.includes('api put') ||
                        // Выполнение API без UI-действий
                        (steps.includes('выполнить post') && !steps.includes('открыть') && !steps.includes('нажать')) ||
                        (steps.includes('выполнить get') && !steps.includes('открыть') && !steps.includes('нажать')) ||
                        (steps.includes('выполнить delete') && !steps.includes('открыть') && !steps.includes('нажать'));

                    if (isBackend) {
                        correctedLayer = correctedLayer.replace('frontend', 'backend') + '__fixed';
                        console.log(`[fixAgainstModel] Frontend → Backend (API-контекст): ${tc.title}`);
                    }
                }

                // 3.2. Backend → Frontend (UI-контекст)
                if (correctedLayer.includes('backend') && !correctedLayer.includes('__fixed')) {
                    const isFrontend =
                        // UI-состояния
                        expected.includes('отображается') ||
                        expected.includes('отображена') ||
                        expected.includes('доступен') ||
                        expected.includes('доступна') ||
                        expected.includes('активна') ||
                        expected.includes('форма') ||
                        expected.includes('кнопка') ||
                        expected.includes('поле') ||
                        expected.includes('страница') ||
                        // UI-действия
                        steps.includes('открыть') ||
                        steps.includes('ввести') ||
                        steps.includes('нажать') ||
                        steps.includes('выбрать') ||
                        steps.includes('свернуть') ||
                        steps.includes('развернуть') ||
                        // Precondition с пользовательскими действиями
                        precondition.includes('пользователь') ||
                        precondition.includes('приложение запущено') ||
                        precondition.includes('пользователь находится') ||
                        precondition.includes('sdk инициализирован');

                    // НЕ переносим, если это проверка API → метод
                    const isApiThenMethod =
                        (title.includes('вызов метода') && title.includes('после')) ||
                        (title.includes('вызов метода') && title.includes('при')) ||
                        (title.includes('при успешном ответе') && expected.includes('вызван')) ||
                        (title.includes('при ошибке') && expected.includes('не вызывается'));

                    if (isFrontend && !isApiThenMethod) {
                        correctedLayer = correctedLayer.replace('backend', 'frontend') + '__fixed';
                        console.log(`[fixAgainstModel] Backend → Frontend (UI-контекст): ${tc.title}`);
                    }
                }

                return {
                    ...tc,
                    layer: correctedLayer.replace(/__fixed/g, '')
                };

            });
        }



        const sanitize = (arr) => {
            console.log(`[sanitize] Обрабатываем ${arr?.length || 0} кейсов`);
            const ALLOWED_LAYERS = new Set([
                "E2E Tests",
                "Integration frontend Tests", "Integration backend Tests",
                "Unit frontend Tests", "Unit backend Tests"
            ]);
            const trimText = (s, n = 1200) => String(s ?? '').trim().slice(0, n);
            const allowedCodeSet = new Set(allowedCodes);
            const take = (s, n) => {
                const t = trimText(s, n);
                return t ? t : undefined;
            };

            const seenTitles = new Set();
            const seenLogic = new Map();

            // ✅ Общая функция нормализации
            function normalizeText(text) {
                return String(text || '')
                    .toLowerCase()
                    .replace(/\b(успешн\w+|сбор и передача|передача и сбор|отправка|передача)\b/gi, '<ACTION>')
                    .replace(/\b(после|при|при запуске)\b/gi, '<TIMING>')
                    .replace(/\b(авторизаци\w+|авторизоваться)\b/gi, '<AUTH>')
                    .replace(/\b(пин-код\w*|пинкод)\b/gi, '<PIN>')
                    .replace(/\b(отчёт\w*|отчет\w*)\b/gi, '<REPORT>')
                    .replace(/\b(и|с|на|в|по|для|от|до|из|к|у|о|об|про|через)\b/gi, '')
                    .replace(/\s+/g, ' ').trim();
            }

            function getLogicSignature(testCase) {
                return `${testCase.layer || ''}::${normalizeText(testCase.story)}::${normalizeText(testCase.scenario)}::${normalizeText(testCase.title)}::${(testCase.steps || []).map(s => normalizeText(s)).join('|')}::${normalizeText(testCase.expected)}`;
            }

            return (arr || [])
                .filter(x => x && typeof x === 'object')
                .map(x => {
                    console.log(`[sanitize] Обрабатываем кейс:`, {
                        title: x.title,
                        layer: x.layer,
                        hasSteps: !!x.steps,
                        stepsLength: x.steps?.length,
                        hasExpected: !!x.expected,
                        expectedLength: x.expected?.length
                    });
                    const steps = Array.isArray(x.steps) ? x.steps.map(s => trimText(s, 600)).slice(0, 40) : [];
                    const tags = Array.isArray(x.tags) ? Array.from(new Set(x.tags.map(t => String(t).trim()).filter(Boolean))) : [];
                    const layer = ALLOWED_LAYERS.has(x.layer) ? x.layer : null;

                    const codeRaw = trimText(x.code, 200);
                    const code = allowedCodeSet.has(codeRaw) ? codeRaw : undefined;

                    return {
                        title: take(x.title, 200),
                        description: take(x.description, 800),
                        precondition: take(x.precondition, 800),
                        steps,
                        expected: take(x.expected || x.expectedResult, 800),
                        tags,
                        layer,
                        feature: extractTextFromModel(modelStructure, 'feature', take(x.feature, 200)),
                        story: extractTextFromModel(modelStructure, 'story', take(x.story, 200)),
                        scenario: extractTextFromModel(modelStructure, 'scenario', take(x.scenario, 200)),
                        code: extractTextFromModel(modelStructure, 'code', code),
                        priority: take(x.priority, 50),
                        version: take(x.version, 50),
                        links: Array.isArray(x.links) ? x.links.slice(0, 10) : [],
                        jiraIssue: take(x.jiraIssue, 100),
                        requirement: take(x.requirement, 50),  // 🚨 ДОБАВЛЕНО!
                        parameters: Array.isArray(x.parameters) ? x.parameters.map(p => ({
                            name: take(p.name, 100),
                            values: Array.isArray(p.values) ? p.values.map(v => take(v, 500)).filter(Boolean) : []
                        })).filter(p => p.name && p.values.length > 0) : [],
                        examples: Array.isArray(x.examples) ? x.examples.map(ex => ({
                            parameters: Array.isArray(ex.parameters) ? ex.parameters.map(p => ({
                                name: take(p.name, 100),
                                value: take(p.value, 500)
                            })).filter(p => p.name && p.value) : []
                        })).filter(ex => ex.parameters.length > 0) : []
                    };
                })
                .filter(x => {
                    if (!x.title || !x.steps?.length || !x.expected || !x.layer) return false;

                    const normalized = normalizeText(x.title);
                    if (seenTitles.has(normalized)) {
                        console.log(`[sanitize] ⚠️ Дубликат: "${x.title}"`);
                        return false;
                    }
                    seenTitles.add(normalized);

                    const signature = getLogicSignature(x);
                    if (seenLogic.has(signature)) {
                        console.log(`[sanitize] ⚠️ Дубликат по логике: "${x.title}"`);
                        return false;
                    }
                    seenLogic.set(signature, x.title);
                    return true;
                });
        };

        const {
            requirements,
            modelStructure: rawModel,
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
        } = inputData;

        const modelStructure = normalizeModelStructure(rawModel);

        if ((!Array.isArray(requirements) && typeof requirements !== 'string') || !modelStructure) {
            throw new Error('requirements и modelStructure обязательны');
        }

        function buildRequirementToStoryMapping(modelStructure) {
            const mapping = {};

            for (const feature of (modelStructure || [])) {
                for (const story of (feature.stories || [])) {
                    if (story.requirement && story.text) {
                        // Автоматически создаем маппинг из модели
                        mapping[story.requirement] = story.text;
                    }
                }
            }

            console.log(`[generateTestCasesAsync] Auto-extracted requirement mapping:`,
                Object.keys(mapping).length, 'requirements');

            return mapping;
        }

        // ✅ НОВАЯ ФУНКЦИЯ: Извлечение текстовых названий из модели по ID/BEM
        function extractTextFromModel(modelStructure, fieldType, identifier) {
            if (!modelStructure || !identifier) return identifier;

            // Если уже текстовое название (не UUID и не BEM-класс) - возвращаем как есть
            if (typeof identifier === 'string' &&
                !identifier.match(/^[a-f0-9-]{36}$/) && // не UUID
                !identifier.match(/^(feature|story|scenario|code)_/)) { // не BEM-класс
                return identifier;
            }

            for (const feature of (modelStructure || [])) {
                // Проверяем feature
                if (fieldType === 'feature' && (feature.id === identifier || feature.text === identifier)) {
                    return feature.text || identifier;
                }

                for (const story of (feature.stories || [])) {
                    // Проверяем story
                    if (fieldType === 'story' && (story.id === identifier || story.text === identifier)) {
                        return story.text || identifier;
                    }

                    for (const scenario of (story.scenarios || [])) {
                        // Проверяем scenario
                        if (fieldType === 'scenario' && (scenario.id === identifier || scenario.text === identifier)) {
                            return scenario.text || identifier;
                        }

                        for (const code of (scenario.codes || [])) {
                            // Проверяем code
                            if (fieldType === 'code' && (code.id === identifier || code.text === identifier)) {
                                return code.text || identifier;
                            }
                        }
                    }
                }
            }

            return identifier; // Если не найдено - возвращаем исходное значение
        }

        const requirementToStoryMapping = buildRequirementToStoryMapping(modelStructure);

        // === ФУНКЦИЯ ПОИСКА STORY ПО ТРЕБОВАНИЮ ===
        function findStoryByRequirement(modelStructure, requirementId) {
            for (const feature of (modelStructure || [])) {
                for (const story of (feature.stories || [])) {
                    if (story.requirement === requirementId) {
                        return {
                            feature: feature.text,
                            story: story.text,
                            requirement: story.requirement,
                            scenarios: story.scenarios || []
                        };
                    }
                }
            }
            return null;
        }

        // === Соберём автоконтекст по ссылкам основной статьи (если есть pageId) ===
        let refinedReqs = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
        let baseRequirement = '';
        let autoPages = [];
        if (pageId) {
            try {
                if (!bearerToken) throw new Error('bearerToken is required for Confluence');
                const { markdown } = await fetchConfluencePage(bearerToken, pageId, { inlineTextAttachments: true });
                baseRequirement = markdown || '';
                const ids = new Set(Array.from(String(markdown || '').matchAll(/pageId=(\d{4,})/g)).map(m => m[1]));
                ids.delete(String(pageId));
                for (const lid of ids) {
                    try {
                        const { markdown: md } = await fetchConfluencePage(bearerToken, lid, { inlineTextAttachments: true });
                        const lines = String(markdown || '').split(/\n/);
                        const refIdx = lines.findIndex(l => l.includes(`pageId=${lid}`));
                        let mention = '';
                        if (refIdx !== -1) {
                            const start = Math.max(0, refIdx - 2);
                            const end = Math.min(lines.length, refIdx + 3);
                            mention = lines.slice(start, end).join('\n').trim();
                        }
                        const relevant = extractRelevantSections(md, mention, { maxSections: 8, maxChars: 50000 });
                        autoPages.push([
                            `### Контекст по ссылке из основной статьи (pageId=${lid})`,
                            mention ? `> Упоминание в основной статье:\n> ${mention.replace(/\n/g, '\n> ')}` : `> Упоминание в основной статье: не найдено (pageId=${lid})`,
                            '',
                            relevant
                        ].join('\n'));
                    } catch { }
                }
            } catch (e) {
                console.warn('[generate-test-cases-async] auto-context fetch failed:', e.message);
            }
        }

        try {
            const { refinedArray } = await contextRefiner({
                requirements,
                text: baseRequirement || text,
                glossary,
                context,
                contextInstruction,
                contextPageIds: undefined,
                glossaryPageId: undefined,
                bearerToken: undefined,
                contextPages: autoPages
            });
            refinedReqs = refinedArray;
            console.log(`[generate-test-cases-async] OK: contextRefiner успешно обработал требования. Объем: ${refinedArray.join('\n').length} символов.`);
        } catch (e) {
            console.error('[generate-test-cases-async] CRITICAL: contextRefiner завершился с ошибкой:', e.message);
            refinedReqs = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
        }

        // Глобальный список допустимых code (по всей модели) — нужен sanitize()
        const allowedCodes = Array.from(new Set(
            (modelStructure || []).flatMap(f =>
                (f.stories || []).flatMap(st =>
                    (st.scenarios || []).flatMap(sc =>
                        (sc.codes || []).map(cd => (cd?.text || '').trim()).filter(Boolean)
                    )
                )
            )
        ));

        // ====== УЛУЧШЕНИЕ: Функция-обертка для контроля таймаутов ======
        async function withTimeout(promise, ms, operationName = 'AI call') {
            const timeout = new Promise((_, reject) => {
                const id = setTimeout(() => {
                    clearTimeout(id);
                    reject(new Error(`Операция "${operationName}" превысила таймаут в ${ms / 1000}с`));
                }, ms);
            });
            return Promise.race([promise, timeout]);
        }

        function splitByStories(modelStructure) {
            const chunks = [];
            const MAX_SCENARIOS_PER_CHUNK = 3;

            for (const feature of modelStructure) {
                for (const story of feature.stories) {
                    const scenarios = story.scenarios || [];

                    // ✅ ВСЕГДА создаём мастер-chunk (даже для маленьких Story)
                    const masterChunk = [{
                        text: feature.text,
                        stories: [{
                            text: story.text,
                            scenarios: scenarios,  // ВСЕ Scenarios
                            _isMasterChunk: true
                        }]
                    }];
                    chunks.push(masterChunk);

                    // Создаём детальные chunk'и ТОЛЬКО если Scenarios > 3
                    if (scenarios.length > MAX_SCENARIOS_PER_CHUNK) {
                        for (let i = 0; i < scenarios.length; i += MAX_SCENARIOS_PER_CHUNK) {
                            const scenariosBatch = scenarios.slice(i, i + MAX_SCENARIOS_PER_CHUNK);

                            const detailChunk = [{
                                text: feature.text,
                                stories: [{
                                    text: story.text,
                                    scenarios: scenariosBatch,
                                    _isDetailChunk: true
                                }]
                            }];

                            chunks.push(detailChunk);
                        }
                    } else {
                        // ✅ Для маленьких Story тоже создаём детальный chunk
                        const detailChunk = [{
                            text: feature.text,
                            stories: [{
                                text: story.text,
                                scenarios: scenarios,
                                _isDetailChunk: true
                            }]
                        }];
                        chunks.push(detailChunk);
                    }
                }
            }

            return chunks;
        }


        function collectAllowedCodes(modelChunk) {
            const set = new Set();
            for (const f of modelChunk) for (const st of (f.stories || []))
                for (const sc of (st.scenarios || [])) for (const cd of (sc.codes || []))
                    if (cd?.text?.trim()) set.add(cd.text.trim());
            return [...set];
        }

        function collectAllowedScenarios(modelChunk) {
            const set = new Set();
            for (const f of modelChunk) for (const st of (f.stories || []))
                for (const sc of (st.scenarios || []))
                    if (sc?.text?.trim()) set.add(sc.text.trim());
            return [...set];
        }


        function countChunkNodes(modelChunk) {
            let scenarios = 0, codes = 0;
            for (const f of modelChunk) for (const st of (f.stories || [])) {
                for (const sc of (st.scenarios || [])) {
                    scenarios++;
                    codes += (sc.codes || []).length;
                }
            }
            return { scenarios, codes };
        }

        function auditCoverage(model, cases) {
            // Минимумы: 1 E2E на Story, 3 Integration на Scenario, 2 Unit на Code
            const needE2EByStory = new Map();
            const needSc = new Map(); // scenario -> remaining Integration
            const needCd = new Map(); // code -> remaining Unit

            for (const f of model) for (const st of (f.stories || [])) {
                needE2EByStory.set(st.text, 1);
                for (const sc of (st.scenarios || [])) {
                    needSc.set(sc.text, 3);
                    for (const cd of (sc.codes || [])) {
                        needCd.set(cd.text, 2);
                    }
                }
            }

            for (const tc of (cases || [])) {
                const layer = String(tc.layer || '');
                if (layer === 'E2E Tests' && tc.story) {
                    const rest = needE2EByStory.get(tc.story);
                    if (rest != null) needE2EByStory.set(tc.story, Math.max(0, rest - 1));
                }
                if (layer.startsWith('Integration') && tc.scenario) {
                    const rest = needSc.get(tc.scenario);
                    if (rest != null) needSc.set(tc.scenario, Math.max(0, rest - 1));
                }
                if (layer.startsWith('Unit') && tc.code) {
                    const rest = needCd.get(tc.code);
                    if (rest != null) needCd.set(tc.code, Math.max(0, rest - 1));
                }
            }

            const missingE2E = [...needE2EByStory].filter(([, n]) => n > 0).map(([story, need]) => ({ story, need }));
            const missingSc = [...needSc].filter(([, n]) => n > 0).map(([scenario, need]) => ({ scenario, need }));
            const missingCd = [...needCd].filter(([, n]) => n > 0).map(([code, need]) => ({ code, need }));

            return { missingE2E, missingSc, missingCd };
        }

        // Догенерация только недостающего покрытия
        async function gapFill(model, reqs, missing, systemPrompt) {
            const { missingE2E, missingSc, missingCd } = missing;
            if (!missingE2E.length && !missingSc.length && !missingCd.length) return [];

            // Собрать минимальный chunk только с нужными story/scenario/code
            const featureText = (model[0] && model[0].text) || 'Feature';
            const chunk = [{ text: featureText, stories: [] }];
            const needStories = new Set(missingE2E.map(x => x.story));
            const needScens = new Set(missingSc.map(x => x.scenario));
            const needCodes = new Set(missingCd.map(x => x.code));

            for (const f of model) for (const st of (f.stories || [])) {
                const keepStory = needStories.has(st.text)
                    || (st.scenarios || []).some(sc =>
                        needScens.has(sc.text) ||
                        (sc.codes || []).some(cd => needCodes.has(cd.text))
                    );
                if (!keepStory) continue;

                const scenarios = (st.scenarios || []).filter(sc =>
                    needScens.has(sc.text) || (sc.codes || []).some(cd => needCodes.has(cd.text))
                ).map(sc => ({
                    ...sc,
                    codes: (sc.codes || []).filter(cd => needCodes.has(cd.text))
                }));

                chunk[0].stories.push({ text: st.text, scenarios });
            }

            const allowedForChunk = collectAllowedCodes(chunk);
            const allowedScenarios = collectAllowedScenarios(chunk);

            const mustLines = [
                ...missingE2E.map(m => `E2E для story "${m.story}" ×${m.need}`),
                ...missingSc.map(m => `Integration для scenario "${m.scenario}" ×${m.need}`),
                ...missingCd.map(m => `Unit для code "${m.code}" ×${m.need}`),
            ];

            const userPrompt = `
Сгенерируй ТОЛЬКО недостающее покрытие для следующего куска модели.
Модель (кусок):
${JSON.stringify(chunk, null, 2)}

Нужно добрать:
${mustLines.map(l => `- ${l}`).join('\n')}

Требования:
${reqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

ДОПУСТИМЫЕ ЗНАЧЕНИЯ ДЛЯ "code":
${allowedForChunk.map(c => `- ${c}`).join('\n')}

Ответ — ТОЛЬКО чистый JSON-массив без Markdown.
`.trim();

            const tools = [buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios)];
            const ai = await callWithCloudRuFallback(
                OPENROUTER_URL,
                [
                    { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}` },
                    { role: 'user', content: userPrompt }
                ],
                config.openRouterAiKey,
                {
                    tools,
                    // tool_choice убран для Cloud.ru совместимости
                    temperature: 0.25,
                    top_p: 0.9,
                    max_tokens: 40000,
                    extra: { transforms: 'middle-out' }
                }
            );

            const args = extractToolArgs(ai, "submit_cases");
            if (args && Array.isArray(args.cases)) return args.cases;

            const content = ai.choices?.[0]?.message?.content || '';
            const rawJsonCandidate = extractJsonArray(content);
            if (!rawJsonCandidate) return [];
            try {
                const jsonText = cleanupJsonText(rawJsonCandidate);
                const parsed = JSON5.parse(jsonText);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.warn('[gapFill] JSON parse failed (strict). Falling back. Error:', e.message);
                try {
                    // fallback: strip everything until first '[' and after last ']'
                    const t = cleanupJsonText(rawJsonCandidate);
                    const parsed = JSON5.parse(t);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (e2) {
                    console.error('[gapFill] Fallback parse failed:', e2.message);
                    console.log('--- RAW AI RESPONSE (gapFill ultimate fail) ---\n', content, '\n-----------------------------------------');
                    return [];
                }
            }
        }

        // Разбивка требований на чанки по размеру (для больших документов)
        function splitRequirements(reqs, maxCharsPerChunk = 120000) {
            if (!Array.isArray(reqs) || reqs.length === 0) return [[]];

            const chunks = [];
            let currentChunk = [];
            let currentSize = 0;

            for (const req of reqs) {
                const reqSize = String(req || '').length;

                // Если одно требование больше лимита - разобьем его на параграфы
                if (reqSize > maxCharsPerChunk) {
                    if (currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }

                    // Разбиваем большое требование на части по параграфам
                    const paragraphs = String(req).split(/\n\n+/);
                    let tempReq = '';

                    for (const para of paragraphs) {
                        if ((tempReq.length + para.length) > maxCharsPerChunk && tempReq) {
                            currentChunk.push(tempReq.trim());
                            chunks.push(currentChunk);
                            currentChunk = [];
                            currentSize = 0;
                            tempReq = para;
                        } else {
                            tempReq += (tempReq ? '\n\n' : '') + para;
                        }
                    }

                    if (tempReq.trim()) {
                        currentChunk.push(tempReq.trim());
                        currentSize = tempReq.length;
                    }
                } else {
                    // Обычное требование
                    if ((currentSize + reqSize) > maxCharsPerChunk && currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = [req];
                        currentSize = reqSize;
                    } else {
                        currentChunk.push(req);
                        currentSize += reqSize;
                    }
                }
            }

            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }

            return chunks.length > 0 ? chunks : [[]];
        }

        // ====== ПРОМПТЫ (из синхронной версии) ======
        const BASE_SYSTEM_PROMPT = `
Ты — скрупулёзный SDET (Software Development Engineer in Test), создающий атомарные и исчерпывающие тест-кейсы для импорта в Allure. На основе входной тест-модели (modelStructure) и требований сгенерируй JSON-массив тест-кейсов, НЕУКОСНИТЕЛЬНО следуя Style Guide ниже.

Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. Если требования явно описывают поведение клиента, трактуй его для Angular; если описывают серверное поведение/API — трактуй для .NET. Никогда не додумывай детали вне текста.

🚨 КРИТИЧЕСКИ ВАЖНО: ЗАПРЕТ НА ДУБЛИКАТЫ! 🚨
ЗАПРЕЩЕНО создавать тесты с похожими названиями или одинаковой логикой!
Если видишь похожие названия — это ДУБЛИКАТ! Создавай ОДИН обобщённый тест!

# 1) Принцип "Один Пример из Требований -> Один Тест-Кейс" (КРАТКО И СТРОГО)
Ты создаёшь тест-кейсы исключительно на основе абсолютно явных и конкретных примеров из текста требований. Никаких домыслов, предположений или недосказанностей в шагах и expected результатах быть не должно.

Алгоритм твоих действий:
1.  Возьми один узел из \`modelStructure\` (например, \`Scenario: "Ввести недопустимое значение..."\`).
2.  Тщательно просканируй ВЕСЬ текст требований и найди ТОЛЬКО те примеры, которые явно и текстуально соответствуют этому узлу.
3.  Для каждого такого примера сгенерируй ровно один, атомарный тест-кейс.
4.  Строго запрещено объединять разные примеры в один кейс или творить новые примеры.
5.  Все поля \`title\`, \`steps\` и \`expected\` должны содержать лишь ДОСЛОВНЫЕ данные или тексты, встречающиеся в требованиях. Запрещено добавлять или интерпретировать дополнительную информацию.
6.  Если для узла отсутствуют явные примеры в требованиях — не создавай тест-кейса вовсе.
7.  При сложной логике описывай ожидаемый результат ровно так, как он изложен в соответствующем примере, ни больше, ни меньше.

Пример работы алгоритма:
- **Абстрактный узел:** \`Scenario: "Проверить срабатывание валидации при конфликте условий"\`
- **Требования содержат пример:** "Если настроены две зависимости с одинаковым условием для '27 LADA FREE', и в поле введено значение '10', то должна сработать последняя зависимость с текстом 'Срок кредита, не может быть <12 мес. и >84 мес.'"
- **Твой результат (один тест-кейс):**
  - \`title\`: "Проверка применения последней зависимости при конфликте условий для программы '27 LADA FREE'"
  - \`steps\`: ["Выбрать значение '27 LADA FREE'", "Ввести значение '10'"]
  - \`expected\`: "Система отображает текст ошибки 'Срок кредита, не может быть <12 мес. и >84 мес.'"

1.1) КРИТИЧЕСКИ ВАЖНО: НЕ ВЫДУМЫВАЙ ДЕТАЛИ!
🚨 ЗАПРЕЩЕНО ДОДУМЫВАТЬ ТО, ЧЕГО НЕТ В REQUIREMENTS! 🚨

НЕ придумывай API-методы:
❌ Если в requirements сказано "GET /get_by_id" — пиши ТОЛЬКО его
❌ НЕ добавляй "POST /validate", "GET /check_status", "DELETE /clear" и другие методы, которых нет в тексте
✅ Используй ТОЛЬКО те API-endpoints, которые ЯВНО упомянуты в requirements

НЕ придумывай HTTP-коды:
❌ Если в requirements написано "при статусе 200" — НЕ добавляй 202, 204, 201
✅ Тестируй ТОЛЬКО указанные коды + стандартные негативные (404, 500 для GET/POST)
✅ Исключение: если requirements явно пишут "200 или 202" — тогда тестируй оба

НЕ додумывай параметры запросов:
❌ Если в requirements нет параметра user_id — НЕ пиши про него в тесте
❌ Если упомянут только doc_type — НЕ добавляй session_token, api_key, request_id
✅ Используй ТОЛЬКО те параметры, которые явно указаны в requirements

НЕ додумывай бизнес-логику:
❌ НЕ пиши "система должна проверить права доступа", если этого нет в requirements
❌ НЕ пиши "отображается сообщение об ошибке", если requirements не описывают его текст
❌ НЕ пиши "данные сохраняются в БД", если requirements не упоминают сохранение
✅ Описывай ТОЛЬКО ту логику, которая явно прописана в requirements

НЕ додумывай шаги:
❌ НЕ добавляй шаги типа "Дождаться загрузки", "Проверить статус", если их нет в requirements
❌ НЕ пиши "Ввести валидные данные" — укажи КОНКРЕТНЫЕ данные из requirements
✅ Шаги = ТОЛЬКО действия пользователя/системы, явно описанные в requirements
✅ Expected = ТОЛЬКО результаты, явно описанные в requirements

Expected ОБЯЗАТЕЛЬНО должен быть КОНКРЕТНЫМ и ПРОВЕРЯЕМЫМ:

Примеры НЕПРАВИЛЬНО (слишком общо):
❌ "expected": "Система работает корректно"
❌ "expected": "Платеж выполнен успешно"
❌ "expected": "Данные переданы"
❌ "expected": "Ошибка обработана"

Примеры ПРАВИЛЬНО (конкретно):
✅ "expected": "Метод GET /get_by_id вызван с параметром doc_type=payment и вернул статус 200 с полями: id, amount, date"
✅ "expected": "После ответа 200 от GET /get_by_id вызван метод getReport(), данные переданы через POST /create/sdk с кодом ответа 204"
✅ "expected": "На экране отображено сообщение 'Платеж выполнен на сумму 100₽', баланс счёта уменьшен на 100₽"

ПРАВИЛО: Expected ДОЛЖЕН содержать:

HTTP-код ответа (для Integration/Unit backend Tests)

Текст сообщения или название элемента UI (для E2E/Integration frontend Tests)

Конкретное изменение данных (для E2E Tests)

Факт вызова метода с указанием параметров (для Unit Tests)

✅ ЧТО РАЗРЕШЕНО (стандартные практики тестирования):

Негативные сценарии с 404, 500 для ЛЮБОГО API-метода (это стандарт HTTP)

Проверка обязательных полей: если requirements говорят "поле X обязательное" — тестируй его отсутствие

Граничные значения (BVA): ТОЛЬКО если requirements дают явные границы (например, "от 48 до 84 символов")

Timeout/network errors: ТОЛЬКО если requirements упоминают обработку сетевых ошибок

ПРИНЦИП: Если сомневаешься — лучше НЕ добавляй тест, чем выдумывай детали!

🚨 КРИТИЧЕСКИ ВАЖНО: ЗАПРЕТ НА ОКРУЖЕНИЕ-СПЕЦИФИЧНЫЕ ТЕСТЫ! 🚨
ЗАПРЕЩЕНО создавать отдельные тест-кейсы для разных платформ (iOS/Android/web) или окружений.
Если логика различается между платформами — указывай это В ПРЕДУСЛОВИЯХ или ШАГАХ, но НЕ создавай отдельные тесты!

Примеры НЕПРАВИЛЬНО:
- "Инициализация SDK Bi_Zone при запуске приложения (на iOS)"
- "Инициализация SDK Bi_Zone при запуске приложения (на Android)"
- "Инициализация SDK Bi_Zone при запуске приложения (дублирующий вызов)"

Пример ПРАВИЛЬНО:
{
  "title": "Инициализация SDK Bi_Zone при запуске приложения",
  "precondition": "Приложение установлено на устройстве (iOS/Android). При дублирующем вызове метода — повторная инициализация не происходит.",
  "tags": ["M"]
}

ПРАВИЛО: Один функциональный сценарий = ОДИН тест-кейс. Различия в окружениях указывать в precondition!
# 2) СЛОИ ТЕСТОВ

E2E Tests:
- Полный сквозной сценарий от начала до конца
- Steps: Действия пользователя через UI
- Expected: Финальный результат для пользователя
- Layer: "E2E Tests"

INTEGRATION FRONTEND TESTS (Component Tests):
- Проверка UI-компонентов и их взаимодействия с API
- Precondition: "Модальное окно появилось", "Открыта страница"
- Steps: 1-2 UI-действия (открыть, выбрать, нажать)
- Expected: "отображается алерт", "кнопка активна", "форма заполнена"
- НЕ проверяем: Внутренние методы (getReport()), вызовы API
- Проверяем: Видимость UI, состояния форм, переходы между экранами
- ✅ Проверяем: UI-реакцию на API ответы (200 → алерт успеха)
- Layer: "Integration frontend Tests"

Примеры ПРАВИЛЬНЫХ Integration Frontend тестов:
  ✅ "Форма перевода отображается после выбора типа операции"
  ✅ "Кнопка 'Отправить' активна после заполнения всех полей"
  ✅ "Страница платежа открывается после сканирования QR-кода"

Примеры НЕПРАВИЛЬНЫХ (это Unit!):
  ❌ "Метод getReport() вызван после авторизации"
  ❌ "POST /create/sdk отправлен с данными SDK"

INTEGRATION BACKEND TESTS (API Tests):
- Проверка ТОЛЬКО серверных API endpoints
- Precondition: Серверное ("Сервер доступен", "БД готова")
- Steps: Вызов API с параметрами
- Expected: Статус ответа (200, 404, 500), формат данных в ответе
- НЕ проверяем: Внутреннюю логику, бизнес-правила
- ❌ НЕ проверяем: UI, алерты, модальные окна, кнопки
- ❌ НЕ используем: "отображается", "пользователь", "нажать"
- Проверяем: HTTP-статусы, структуру ответа
- Layer: "Integration backend Tests"


🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ BACKEND ТЕСТОВ:

ЗАПРЕЩЁННЫЕ precondition для backend:
❌ "Пользователь ввёл..."
❌ "Пользователь нажал..."
❌ "Пользователь открыл..."
❌ "Приложение запущено"
❌ "SDK инициализирован"
❌ Любое упоминание пользовательских действий

ПРАВИЛЬНЫЕ precondition для backend:
✅ "Сервер доступен"
✅ "БД готова"
✅ "API endpoint работает"
✅ "Тестовые данные загружены"
✅ ВООБЩЕ НЕ УКАЗЫВАТЬ precondition

ЕСЛИ В PRECONDITION УПОМИНАЕТСЯ "ПОЛЬЗОВАТЕЛЬ" → ЭТО FRONTEND ТЕСТ!

Примеры ПРАВИЛЬНЫХ Integration Backend тестов:
  ✅ "API POST /oauth/te возвращает 200 при валидных данных"
  ✅ "API GET /payment_data возвращает 404 при несуществующем ID"

UNIT FRONTEND TESTS:
- Проверка ОТДЕЛЬНЫХ методов/функций фронтенда
- Steps: Вызов метода с параметрами
- Expected: Возвращаемое значение метода
- Проверяем: getReport(), валидация полей, форматирование данных
- Layer: "Unit frontend Tests"

Примеры ПРАВИЛЬНЫХ Unit Frontend тестов:
  ✅ "Метод getReport() возвращает объект с полями DeviceModel, AppKey"
  ✅ "Функция validateCardNumber() возвращает true для валидного номера"

UNIT BACKEND TESTS:
- Проверка ОТДЕЛЬНЫХ серверных функций/методов
- Steps: Вызов функции с параметрами
- Expected: Результат работы функции
- Проверяем: Парсинг, валидация, бизнес-логика
- Layer: "Unit backend Tests"

КРИТИЧЕСКИ ВАЖНО - РАЗДЕЛЕНИЕ INTEGRATION И UNIT:

Integration тесты (Component/API):
  - Проверяют ВЗАИМОДЕЙСТВИЕ нескольких компонентов/модулей
  - Frontend: UI-состояния, поведение компонентов
  - Backend: API endpoints, статусы ответов

Unit тесты:
  - Проверяют ОТДЕЛЬНЫЕ методы/функции
  - Frontend: getReport(), валидация, форматирование
  - Backend: бизнес-логика, парсинг данных

ЗАПРЕЩЕНО в Integration тестах:
❌ Упоминать getReport() в Integration frontend
❌ Упоминать "метод X вызван" в Integration frontend
❌ Проверять внутренние методы в Integration
❌ "Пользователь ввёл данные" в precondition для backend теста

ОБЯЗАТЕЛЬНО в Integration тестах:
✅ Frontend Integration: проверка UI-состояний ("отображается", "доступен", "активна")
✅ Backend Integration: проверка API-статусов ("возвращает 200", "формат ответа")
✅ Разделять проверку UI (Integration) и методов (Unit)
✅ Создавать ОБА теста (frontend + backend) если требование описывает взаимодействие

ПРАВИЛО ОПРЕДЕЛЕНИЯ СЛОЯ:
- Integration Frontend: "отображается", "доступен", "активна", "форма заполнена"
- Integration Backend: "возвращает статус", "формат ответа"
- Unit Frontend: "метод возвращает", "функция валидирует"
- Unit Backend: "функция парсит", "бизнес-правило применяется"


## 2.2) Для слоя "Unit Tests" (Условный "Белый Ящик")
- Ты **МОЖЕШЬ** описывать внутреннюю логику, но **ТОЛЬКО** если она основана на узле \`code\` из входной тестовой модели.
- **Шаги (Steps):** Описывай подготовку данных (Arrange) и вызов действия (Act) в терминах, близких к узлу \`code\`.
- **Результат (Expected):** Описывай проверку результата (Assert), соответствующую узлу \`code\`.
- **Если узел \`code\` отсутствует в модели для данного сценария, ты ОБЯЗАН вернуться к принципу "Чёрного Ящика"** и описать Unit-тест в терминах "входные данные -> результат", не выдумывая названий функций.

## 2.3) ПРИНЦИП МИНИМАЛЬНОГО ДЕЙСТВИЯ (При Неполных Требованиях)
Это одно из ГЛАВНЫХ правил. Если требование описывает *состояние* элемента (например, "поле невалидно", "кнопка неактивна"), но НЕ описывает точное *действие* пользователя, которое вызывает это состояние, ТЫ ОБЯЗАН следовать этому принципу.

**Принцип:** Сгенерируй тест, который проверяет состояние через самое **минимальное, локальное и очевидное действие**. ЗАПРЕЩЕНО додумывать сложные сценарии или действия с другими элементами управления (например, с кнопкой "Сохранить"), если они не упомянуты в требовании явно.

**Пример 1: Валидация поля**
- **Требование (неполное):** \`Валидация: "Поле 'Дата документа' обязательно для заполнения"\`
- **Неправильно (додумывание):**
  - Шаги: ["Нажать кнопку 'Сохранить'"]
  - Ожидаемый результат: "Система отображает ошибку 'Поле... обязательно'"
- **ПРАВИЛЬНО (Минимальное действие):**
  - Шаги: ["Сфокусироваться на поле 'Дата документа'", "Снять фокус с поля, оставив его пустым"]
  - Ожидаемый результат: "Под полем 'Дата документа' отображается ошибка 'Поле... обязательно'"

**Пример 2: Состояние кнопки**
- **Требование (неполное):** \`Кнопка "Сохранить" неактивна, пока не заполнены все обязательные поля.\`
- **Неправильно (додумывание):**
  - Шаги: ["Нажать на неактивную кнопку 'Сохранить'"]
  - Ожидаемый результат: "Ничего не происходит" 
  (Этот тест не проверяет условие)
- **ПРАВИЛЬНО (Минимальное действие):**
  - **Тест 1 (проверка начального состояния):**
    - Предусловие: "Форма открыта, обязательные поля пусты"
    - Шаги: [] (Действий нет, проверяем исходное состояние)
    - Ожидаемый результат: "Кнопка 'Сохранить' отображается, но неактивна (disabled)"
  - **Тест 2 (проверка изменения состояния):**
    - Предусловие: "Форма открыта, обязательные поля пусты"
    - Шаги: ["Заполнить все обязательные поля валидными данными"]
    - Ожидаемый результат: "Кнопка 'Сохранить' становится активной"

# 3) Allure Style Guide (сводка отдела)
— 1 тест-кейс = 1 проверка или 1 пользовательский сценарий.  
— Тест-кейсы независимы друг от друга.  
— Название информативно и по возможности уникально («Загрузка нового справочника», а не «Проверка справочников»).  
— Предусловия (если есть) — только то, что подготавливается вне тестируемого приложения профилем исполнителя (данные в БД, настройки, сиды, интеграции, состояние устройства и т.п.).  
— Шаги:
   • Один шаг = одно действие. Всегда с глагола («Открыть», «Ввести», «Нажать»).  
   • Общие повторяющиеся блоки — оформлять как shared steps (концептуально; в JSON шаги всё равно плоские).  
   • Сценарные тесты: начинать с полного пользовательского пути (обычно с авторизации).  
   • Атомарные тесты: начинать с инициализации изолированного компонента/эндпоинта (без «навигации»).  
— Ожидаемый результат (обязателен) отражает СУТЬ проверки/сценария, формулирован чётко и без условных «если… то…».  
— Вложения/файлы/мок-данные добавляются при необходимости (при наличии макетов/данных).  
— Ссылки: указывать Confluence/макеты, если есть.  
— Jira: указать связанное задание (ключ).  
— Версия:
   • Версия по умолчанию — "stable" для новых кейсов.  
   • При доработках — клонировать кейс и указать нужную версию.  
- Приоритет:
   • Приоритет определяй по матрице риска:
   • Critical — деньги/безопасность/ПДн, потеря/коррупция данных, недоступность критичного сервиса.
   • High — основной бизнес-флоу ломается для многих, неверные суммы/конвертации/комиссии, нарушения авторизации/ролей.
   • Medium — валидации, контент, нефатальные деградации UX.
   • Low — косметика/копирайт/микро-UX.
   • По умолчанию: E2E ≥ High, Integration ≥ Medium, Unit ≥ Low, но повышай при наличии рисков выше.

# 4) Теги (ОБЯЗАТЕЛЬНО)
В массиве "tags" используй:
— Платформа интерфейса: D (desktop), A (adaptive), M (mobile), PWA (если уместно). Если платформа из контекста неочевидна — ставь "D".  
— Бэкенд-проверки: добавь "S" (для Integration backend Tests и любых API-ориентированных проверок).   
Примеры наборов тегов:
• FE E2E/Integration (десктоп): ["D"]  
• BE Integration: ["S"] или ["D","S"] если тест затрагивает интерфейсно-зависимые артефакты  

# 5) Выходной формат: СТРОГО ТОЛЬКО JSON-массив
Используй ровно один из трёх шаблонов ниже в зависимости от "layer". Никаких комментариев/markdown.

🚨 ПРАВИЛО ДЛЯ STEPS: ТОЛЬКО ИЗ REQUIREMENTS! 🚨

ЗАПРЕЩЕНО додумывать шаги:
❌ "Дождаться загрузки страницы" (если не указано в requirements)
❌ "Проверить, что кнопка активна" (это проверка — идёт в expected, а не в steps)
❌ "Ввести валидные данные" (укажи КОНКРЕТНЫЕ данные из requirements или используй placeholders типа <НОМЕР_КАРТЫ>)

ПРАВИЛЬНЫЕ шаги (конкретные действия):
✅ "Открыть страницу 'История операций'"
✅ "Выбрать операцию с типом 'payment' из списка"
✅ "Нажать кнопку 'Повторить'"
✅ "Ввести сумму 1000₽ в поле 'Сумма платежа'"

ПРАВИЛО:

Steps описывают ДЕЙСТВИЯ пользователя или системы

Проверки результата НЕ пишутся в steps — только в expected

Если requirements описывают действие как "при открытии страницы вызывается API X" — это НЕ шаг, это автоматическое действие (пишем в expected)

## Шаблон: "layer": "E2E Tests"
{
  "feature": "Название фичи из модели",
  "story": "Название истории из модели",
  "scenario": "Название сценария из модели",
  "title": "Название, описывающее ВЕСЬ сценарий (например, 'Успешное создание виджета авторизованным пользователем')",
  "steps": [
    "Авторизоваться как 'user_role'",
    "Перейти на страницу 'Название страницы'",
    "Нажать кнопку 'Создать виджет'",
    "Заполнить поле 'Название' валидным значением",
    "Нажать кнопку 'Сохранить'"
  ],
  "expected": "Система отображает сообщение об успешном создании. Виджет появляется в общем списке.",
  "tags": ["‹по матрице тегов›"],
  "layer": "E2E Tests",
  "priority": "‹по матрице риска›"
}

## Шаблон: "layer": "Integration frontend Tests" / "Integration backend Tests"
{
  "feature": "Название фичи из модели",
  "story": "Название истории из модели",
  "scenario": "ТОЧНОЕ название сценария из модели",
  "title": "Конкретная проверка (например, 'Валидация поля «Имя» при вводе более 100 символов')",
  "precondition": "Компонент/эндпоинт подготовлен. (Коротко по существу, без кода.)",
  "steps": [
    "Ввести в поле 'Имя' строку длиной 101 символ",
    "Снять фокус с поля"
  ],
  "expected": "Под полем 'Имя' отображается текст ошибки 'Превышена максимальная длина'. Кнопка 'Сохранить' неактивна.",
  "tags": ["‹по матрице тегов›"],
  "layer": "Integration frontend Tests",
  "priority": "‹по матрице риска›"
}

## Шаблон: "layer": "Unit frontend Tests" / "Unit backend Tests"
{
  "feature": "Название фичи из модели",
  "story": "Название истории из модели",
  "scenario": "Название сценария, к которому относится модуль",
  "code": "ТОЛЬКО если совпадает с codes[].text из модели (иначе — не указывать)",
  "title": "Кратко: что проверяем (описательно, без имён функций и синтаксиса)",
  "precondition": "Arrange: подготовить входные данные/контекст (описательно, без программного синтаксиса).",
  "steps": [
    "Act: выполнить проверяемое действие в изоляции (описательно).",
    "Act: передать подготовленные входные данные.",
    "Act: получить результат."
  ],
  "expected": "Assert: результат соответствует ожидаемому (описательно, без кода и идентификаторов).",
  "tags": ["Unit", "‹по матрице тегов›"],
  "layer": "Unit frontend Tests",
  "priority": "‹по матрице риска›"
}
Правила для Unit:
— НЕ придумывать имена функций/классов и не использовать синтаксис языков.  
— "code" заполняется СТРОГО из codes[].text, иначе это поле опускается.
- Unit = чистая бизнес-логика: без рендера UI, без DOM, без "Открыть/Перейти/Кликнуть/Ввести", без авторизации и навигации, без HTTP/эндпоинтов.
- Любая инициализация компонента, взаимодействие с формами/страницей/браузером = только "Integration frontend Tests".
- Любой полноценный HTTP-вызов/контракт/статус-код = только "Integration backend Tests".
- Для Unit обязательный AAA: Arrange в precondition, цепочка Act в steps, Assert в expected.

Допустимые дополнительные поля (если есть во входе или явно уместны): 
• "links": [{ "text": "...", "url": "..." }], • "jiraIssue": "ABC-123", • "version": "stable" (по умолчанию для новых), • "attachments": [...], • "parameters": "..." (использовать только если во входе явно заданы параметры; для DDT/Pairwise — но не выдумывать).

🚨 КРИТИЧЕСКИ ВАЖНО: EXPECTED ДОЛЖЕН БЫТЬ ПРОВЕРЯЕМЫМ! 🚨

ЗАПРЕЩЁННЫЕ формулировки (непроверяемые):
❌ "Система работает корректно"
❌ "Операция выполнена успешно"
❌ "Данные обработаны"
❌ "Ошибка отображена"
❌ "Пользователь перенаправлен"

ОБЯЗАТЕЛЬНЫЕ формулировки (конкретные и проверяемые):
✅ "GET /get_by_id вернул статус 200 с JSON: {"id": "<ID>", "type": "payment", "amount": 1000}"
✅ "На экране отображено сообщение 'Платеж №12345 выполнен', кнопка 'Повторить' активна"
✅ "Метод getReport() вызван 1 раз, вернул массив из 5 элементов типа BiZoneData"
✅ "POST /create/sdk вызван с телом {"bizone": {...}}, получен ответ 204 No Content"

ПРАВИЛО: Expected ОБЯЗАТЕЛЬНО должен содержать минимум ОДИН из:

HTTP-код и структура ответа (для backend)

Текст элемента UI или название компонента (для frontend)

Факт вызова метода с параметрами (для Unit)

Конкретное изменение состояния (для E2E)

# 6) Правила генерации набора тест-кейсов (СТРОГАЯ ПИРАМИДА)

🚨 КРИТИЧЕСКИ ВАЖНО: СОБЛЮДАЙ ПИРАМИДУ ТЕСТИРОВАНИЯ! 🚨

Для КАЖДОЙ Story:
— РОВНО 2-3 E2E-тест на Happy Path (полный пользовательский путь)
— ОПЦИОНАЛЬНО: 1-2 E2E на критичный Negative Path (только если есть явный негативный сценарий в требованиях)

Для КАЖДОГО Scenario:
— МИНИМУМ 2, МАКСИМУМ 6 Integration-теста:
  • 2 позитивный (Happy Path)
  • 1-2 негативных (ошибки API: 404, 500, timeout)
  • 0-2 граничный (BVA, только если применимо)

Для КАЖДОГО Code:
— МИНИМУМ 1, МАКСИМУМ 2 Unit-теста:
  • 1 позитивный (корректные входные данные)
  • 0-1 негативный (ошибка обработки, если применимо)

🚨 СТРОГИЕ ЗАПРЕТЫ:
❌ Создавать больше 3 E2E тестов на Story
❌ Создавать больше 6 Integration тестов на Scenario
❌ Создавать больше 3 Unit тестов на Code
❌ Дублировать тесты для разных значений параметров ( например doc_type, платформы, окружения)

# 6.1) Параметризация вместо дубликатов

🚨 КРИТИЧЕСКИ ВАЖНО: ИСПОЛЬЗОВАНИЕ ПАРАМЕТРИЗАЦИИ ВМЕСТО ДУБЛИКАТОВ! 🚨

Если несколько тест-кейсов проверяют ОДНУ И ТУ ЖЕ логику с разными входными данными — создавай ОДИН ПАРАМЕТРИЗОВАННЫЙ тест!

ПРАВИЛО ПАРАМЕТРИЗАЦИИ:
1. Если логика теста ИДЕНТИЧНА, но меняются только входные данные → используй параметризацию
2. Если меняется логика проверки или expected результат → создавай отдельные тесты
3. Параметризация подходит для: HTTP-коды, типы документов, значения полей, варианты ответов API

Пример НЕПРАВИЛЬНО (11 отдельных тестов):
- "Метод GET /get_by_id с doc_type=payment"
- "Метод GET /get_by_id с doc_type=payment_template"
- "Метод GET /get_by_id с doc_type=doc_service"
... (ещё 8 тестов с идентичной логикой)

Пример ПРАВИЛЬНО (1 параметризованный тест):
{
  "title": "Метод GET /get_by_id возвращает корректные данные для всех типов документов",
  "steps": [
    "Выполнить GET /backend/rest/stateful/personal/template/get_by_id с параметром doc_type из таблицы параметров",
    "Проверить структуру ответа"
  ],
  "expected": "Получен ответ 200 с валидными данными для типа документа из параметра 'Тип документа'",
  "parameters": [
    {
      "name": "Тип документа",
      "values": ["payment", "payment_template", "doc_service", "payment_counter", "payment_counter_template", "doc_pay_transfer_rur_template", "doc_pay_selffree", "doc_pay_transfer_person", "doc_pay_p2p_kuban", "doc_pay_selfconv", "quick_pay"]
    }
  ]
}

Пример ПРАВИЛЬНО для HTTP-кодов (параметризация):
{
  "title": "Отображение ошибки при отправке запроса с подтверждением (!=200)",
  "precondition": "Подменено тело ответа метода PUT /customer/profile/email/confirm на данные из параметров",
  "steps": [
    "Выполнить запрос PUT /customer/profile/email/confirm",
    "Проверить ответ сервера"
  ],
  "expected": "Появляется модальное окно с ошибкой 'Операция не удалась' и текстом ошибки из параметра 'Выводимый текст ошибки', в зависимости от данных из параметров 'Код ответа' и 'Тело ответа'",
  "parameters": [
    { "name": "Код ответа", "values": ["200", "400", "401", "403", "404", "500", "503", "504"] },
    { "name": "Тело ответа", "values": ["{ \"errorCode\": \"1007\", \"errorText\": \"...\" }", "пустое(или без errorCode и errorText)", "любое"] },
    { "name": "Выводимый текст ошибки", "values": ["Введенные данные не найдены...", "Отсутствуют требуемые параметры.", "Ошибка обработки запроса...", "..."] }
  ],
  "examples": [
    {
      "parameters": [
        { "name": "Код ответа", "value": "200" },
        { "name": "Тело ответа", "value": "{ \"errorCode\": \"1007\", \"errorText\": \"Введенные данные не найдены...\" }" },
        { "name": "Выводимый текст ошибки", "value": "Введенные данные не найдены..." }
      ]
    },
    {
      "parameters": [
        { "name": "Код ответа", "value": "400" },
        { "name": "Тело ответа", "value": "{ \"errorCode\": \"1007\", \"errorText\": \"Отсутствуют требуемые параметры\" }" },
        { "name": "Выводимый текст ошибки", "value": "Отсутствуют требуемые параметры." }
      ]
    }
    // ... остальные примеры
  ]
}

ФОРМАТ ПАРАМЕТРОВ В JSON:
- "parameters": массив объектов { "name": "Название параметра", "values": ["значение1", "значение2", ...] }
- "examples": массив объектов, каждый содержит "parameters": [{ "name": "...", "value": "..." }]

КРИТЕРИИ ДЛЯ ПАРАМЕТРИЗАЦИИ:
✅ Одинаковая логика шагов
✅ Одинаковая структура expected (только значения меняются)
✅ 3+ варианта входных данных
✅ Все варианты проверяют одно и то же поведение

❌ НЕ параметризуй если:
- Разная логика проверки
- Разные expected результаты (не просто разные значения)
- Меньше 3 вариантов (лучше отдельные тесты)

АЛЬТЕРНАТИВНЫЙ ПОДХОД (если есть критичные отличия):
- Создай ОДИН параметризованный тест для всех стандартных случаев
- Создай 1-2 отдельных теста ТОЛЬКО для случаев, где логика ОТЛИЧАЕТСЯ

ПРАВИЛО: Одинаковая логика → ОДИН параметризованный тест. Разная логика → отдельные тесты.

🚨 КОНКРЕТНЫЕ ПРИМЕРЫ ДУБЛИКАТОВ ДЛЯ ВАШЕГО ПРОЕКТА: 🚨

❌ НЕПРАВИЛЬНО (дубликаты):
- "Успешная отправка отчёта после авторизации по пин-коду"
- "Отправка отчёта после авторизации по пин-коду" 
- "Сбор и передача отчёта после успешной авторизации по пин-коду"
- "Передача отчёта после авторизации по пин-коду"
- "Инициализация SDK Bi_Zone при запуске приложения"
- "Инициализация SDK Bi_Zone и передача отчёта после успешной авторизации"

✅ ПРАВИЛЬНО (один обобщённый тест):
{
  "title": "Отправка отчёта после авторизации по пин-коду",
  "precondition": "Пользователь авторизован по пин-коду, SDK Bi_Zone инициализирован",
  "steps": [
    "Авторизоваться по пин-коду",
    "Дождаться инициализации SDK Bi_Zone",
    "Выполнить сбор и передачу отчёта"
  ],
  "expected": "Отчёт успешно собран и передан через POST /create/sdk с кодом ответа 204"
}

🚨 ЗАПОМНИ: Если видишь похожие названия — это ДУБЛИКАТ! Создавай ОДИН тест!

# 7) Техники тест-дизайна (обязательно применять, если применимо)
— BVA: мин, макс, мин-1, макс+1.  
— Классы эквивалентности: валидный/невалидный/пустой/null.  
— Error-guessing: разумные «углы».

# 7.1) Генерация неявных сценариев (Error Guessing & BVA)
После того, как ты сгенерировал тест-кейсы для всех ЯВНЫХ примеров из требований, дополнительно примени техники тест-дизайна, чтобы покрыть следующие случаи, даже если они не описаны в тексте:
- **Граничные значения:** Для каждого числового диапазона (например, '48-84') ОБЯЗАТЕЛЬНО создай отдельные Integration-тесты для значений min-1, min, max, max+1 (в данном примере: 47, 48, 84, 85).
- **Жизненный цикл:** Если есть сценарии на создание, ОБЯЗАТЕЛЬНО добавь по одному Integration-тесту на **редактирование** и **удаление** существующей зависимости.
- **Невалидные типы данных:** Для полей с числовым вводом добавь Integration-тест на ввод текстовой строки. Для текстовых полей — проверку на ввод пустой строки.

🚨 ВАЖНО: ПРОВЕРКА КРИТИЧНЫХ HTTP-КОДОВ! 🚨
При работе с API ОБЯЗАТЕЛЬНО проверяй граничные случаи:
- Если требование указывает "при статусе 200" — создай тест на 404, 500
- Если требование указывает "при статусе 200 или 202" — создай тесты на оба кода + негативные (404, 500)
- Если требование указывает "если НЕ 200 — не передавать отчёт" — создай тесты на 400, 401, 404, 500

Примеры критичных проверок:
• POST /oauth/te вернул 200 → отчёт передаётся ✅
• POST /oauth/te вернул 401 → отчёт НЕ передаётся ✅ (ОБЯЗАТЕЛЬНЫЙ негативный тест!)
• POST /create/sdk вернул 500 → ошибка НЕ показывается пользователю ✅
• GET /qrcode вернул 202 → отчёт передаётся ✅ (граничный случай!)

# 8) Чек-лист перед выводом
— Все кейсы независимы; по одному «смыслу» на кейс.  
— В E2E есть «Авторизоваться…» и «Перейти на страницу…».  
— Детальные проверки (валидации полей и т.п.) не просочились в E2E.  
— "scenario" (для Integration/Unit) совпадает с моделью.  
— Теги проставлены по правилам: D/A/M/PWA; "S" для бэкенда; номер требования — только если есть во входе.  
— "version" = "stable" для новых кейсов (если не указано иное).  

🚨 КРИТИЧЕСКИ ВАЖНО: УНИКАЛЬНОСТЬ НАЗВАНИЙ! 🚨
КАЖДЫЙ тест-кейс ОБЯЗАТЕЛЬНО должен иметь УНИКАЛЬНОЕ название.
ЗАПРЕЩЕНО создавать тесты с одинаковыми названиями для разных doc_type/параметров!
Если логика теста одинаковая — создай ОДИН параметризованный тест.

🚨 ДОПОЛНИТЕЛЬНЫЕ ЗАПРЕТЫ НА ДУБЛИКАТЫ:
❌ ЗАПРЕЩЕНО создавать тесты с похожими названиями:
- "Успешная отправка отчёта" + "Отправка отчёта после авторизации" = ДУБЛИКАТ!
- "Сбор и передача отчёта" + "Передача отчёта после авторизации" = ДУБЛИКАТ!
- "Инициализация SDK" + "Инициализация SDK Bi_Zone" = ДУБЛИКАТ!

✅ ПРАВИЛЬНО: Один обобщённый тест вместо множества похожих:
- "Отправка отчёта после авторизации по пин-коду" (вместо 3 отдельных тестов)
- "Инициализация SDK Bi_Zone при запуске приложения" (вместо вариаций)

ПРАВИЛО: Если тесты проверяют ОДНУ И ТУ ЖЕ логику — создавай ОДИН тест!

Пример НЕПРАВИЛЬНО:
- "Метод getReport() не вызывается при ошибке для payment"
- "Метод getReport() не вызывается при ошибке для doc_service"  

Пример ПРАВИЛЬНО:
- "Метод getReport() не вызывается при ошибке GET /get_by_id" (один тест, параметризуй doc_type в precondition)

🚨 СТРОГИЙ ЗАПРЕТ НА ДУБЛИКАТЫ НА УРОВНЕ ГЕНЕРАЦИИ! 🚨

❌ ЗАПРЕЩЕНО создавать тесты с похожими названиями:
- "Успешная отправка отчёта" + "Отправка отчёта после авторизации" = ДУБЛИКАТ!
- "Сбор и передача отчёта" + "Передача отчёта после авторизации" = ДУБЛИКАТ!
- "Инициализация SDK" + "Инициализация SDK Bi_Zone" = ДУБЛИКАТ!
- "Успешная отправка отчёта после авторизации по пин-коду" (3 раза) = ДУБЛИКАТ!

❌ ЗАПРЕЩЕНО создавать тесты с одинаковой логикой:
- Если тест проверяет "отправку отчёта после авторизации" — создай ОДИН тест
- Если тест проверяет "инициализацию SDK" — создай ОДИН тест
- Если тест проверяет "сбор данных" — создай ОДИН тест

✅ ОБЯЗАТЕЛЬНО перед генерацией каждого теста:
1. Проверь: нет ли уже похожего теста в списке?
2. Если есть — НЕ создавай новый, а расширь существующий
3. Если логика отличается — создавай новый, но с УНИКАЛЬНЫМ названием

🚨 ПРАВИЛО: ОДИН ФУНКЦИОНАЛЬНЫЙ СЦЕНАРИЙ = ОДИН ТЕСТ-КЕЙС! 🚨

🚨 ФИНАЛЬНОЕ ОГРАНИЧЕНИЕ: МАКСИМУМ 8 ТЕСТ-КЕЙСОВ! 🚨
Перед выводом пересмотри все тест-кейсы и оставь ТОЛЬКО самые критичные:
1. Приоритет: деньги → безопасность → основной флоу → критичные API
2. Если больше 8 кейсов - удали наименее важные
3. Лучше 5 качественных тестов, чем 15 посредственных
4. УБЕДИСЬ что все названия УНИКАЛЬНЫ!

# 9) Формат ответа
Выведи СТРОГО один JSON-массив кейсов без каких-либо комментариев, текста или Markdown.
Ключ формируется после нормализации пробелов и регистра.
Если ключ совпал — считать дубликатом и не добавлять второй раз.

🚨 КРИТИЧЕСКИ ВАЖНО: ЗАПРЕТ НА PLACEHOLDER-КОДЫ! 🚨
При неполной информации **оставляй \`codes: []\`**. **Запрещено** добавлять placeholder-коды без явных требований.
Если в требованиях не указаны конкретные системные реакции — НЕ ДОДУМЫВАТЬ их.
Пустой массив \`codes: []\` допустим и предпочтителен placeholder-кодам.

Пример работы алгоритма:
- **Абстрактный узел:** \`Scenario: "Проверить срабатывание валидации при конфликте условий"\`
- **Требования содержат пример:** "Если настроены две зависимости с одинаковым условием для '27 LADA FREE', и в поле введено значение '10', то должна сработать последняя зависимость с текстом 'Срок кредита, не может быть <12 мес. и >84 мес.'"
- **Твой результат (один тест-кейс):**
  - \`title\`: "Применение последней зависимости при конфликте условий для программы '27 LADA FREE'"
  - \`steps\`: ["Выбрать значение '27 LADA FREE'", "Ввести значение '10'"]
  - \`expected\`: "Система отображает текст ошибки 'Срок кредита, не может быть <12 мес. и >84 мес.'"

# 2) Пирамида тестирования — нерушимые правила
1) Сдвигай проверки вниз: детальные проверки (валидации, границы, форматы) — в Integration/Unit, а не в E2E.
2) E2E (C1) — только сквозные бизнес-сценарии:
   • Чёрный ящик, имитация реального пользователя.
   • ВСЕГДА начинаются шагами: «Авторизоваться…», «Перейти на страницу…».
   • НЕЛЬЗЯ проверять сообщения отдельных полей и вводить невалидные данные полей — максимум 1–2 ключевых негативных сценария на уровне всего потока (например, «ошибка сервера при сохранении»).
   • 🚨 КРИТИЧЕСКИ ВАЖНО: КАЖДАЯ Story ДОЛЖНА иметь минимум 1 E2E тест-кейс!
   • 🚨 ЗАПРЕЩЕНО: Пропускать Stories без E2E покрытия!
   • 🚨 ОБЯЗАТЕЛЬНО: Проверь что для КАЖДОЙ Story создан хотя бы один E2E тест!
3) Integration (C2–C3) — взаимодействия компонент/эндпоинтов:
   • В рамках одного компонента (FE) или одного API-вызова (BE), без навигации по страницам.
   • Основная работа: классы эквивалентности, граничные значения (BVA), контракты API.
   • 🚨 ВАЖНО: Integration тесты привязываются к Scenario, НЕ к Story!
   • 🚨 Integration тесты НЕ должны содержать поле "story" без "scenario"!
4) Unit (C4) — одна функция/метод, строгий AAA (Arrange-Act-Assert).
   • 🚨 ВАЖНО: Unit тесты привязываются к Code, НЕ к Scenario или Story!
   • 🚨 Unit тесты ОБЯЗАТЕЛЬНО должны содержать поле "code"!

🚨 КРИТИЧЕСКИ ВАЖНО: КРИТЕРИИ ДЛЯ СЛОЁВ ПО СОДЕРЖИМОМУ EXPECTED! 🚨
Если expected содержит HTTP-коды или контракты ответа — это Integration backend Tests.
Если expected описывает UI-состояния/видимость контролов/дизабл — это FE (E2E или Integration frontend).
Если expected описывает чистую бизнес-функцию (без UI/HTTP) — Unit.

## 2.1) Для слоев "E2E Tests" и "Integration Tests" (Строгий "Чёрный Ящик")
- **Действия (Steps):** Описывай только действия пользователя в интерфейсе (клик, ввод, скролл, навигация).
- **Результат (Expected):** Описывай только видимые пользователю изменения в UI или ответы, определённые в API-контракте.
- **ЗАПРЕЩЕНО:** Додумывать детали реализации, такие как вызовы внутренних функций, работа с базой данных, кэширование, или отправка HTTP-запросов.

  - **Неправильно (гадание о реализации):** "Вызывается GET-запрос для фильтрации."
  - **Правильно (наблюдаемый результат):** "В списке остаются только элементы, содержащие 'X'."

  - **Неправильно:** "Нажать Enter для применения фильтра."
  - **Правильно:** "Ввести в поле фильтра 'X'". Если нужно явно завершить действие — "Снять фокус с поля".

## 2.2) Для слоя "Unit Tests" (Условный "Белый Ящик")
- Ты **МОЖЕШЬ** описывать внутреннюю логику, но **ТОЛЬКО** если она основана на узле \`code\` из входной тестовой модели.
- **Шаги (Steps):** Описывай подготовку данных (Arrange) и вызов действия (Act) в терминах, близких к узлу \`code\`.
- **Результат (Expected):** Описывай проверку результата (Assert), соответствующую узлу \`code\`.
- **Если узел \`code\` отсутствует в модели для данного сценария, ты ОБЯЗАН вернуться к принципу "Чёрного Ящика"** и описать Unit-тест в терминах "входные данные -> результат", не выдумывая названий функций.

## 2.3) ПРИНЦИП МИНИМАЛЬНОГО ДЕЙСТВИЯ (При Неполных Требованиях)
Это одно из ГЛАВНЫХ правил. Если требование описывает *состояние* элемента (например, "поле невалидно", "кнопка неактивна"), но НЕ описывает точное *действие* пользователя, которое вызывает это состояние, ТЫ ОБЯЗАН следовать этому принципу.

**Принцип:** Сгенерируй тест, который проверяет состояние через самое **минимальное, локальное и очевидное действие**. ЗАПРЕЩЕНО додумывать сложные сценарии или действия с другими элементами управления (например, с кнопкой "Сохранить"), если они не упомянуты в требовании явно.

🚨 КРИТИЧЕСКИ ВАЖНО: ПЛЕЙСХОЛДЕРЫ ВМЕСТО КОНКРЕТНЫХ ДАННЫХ! 🚨
Используй плейсхолдеры вида <ВАЛИДНЫЙ_БИК>, <НЕВАЛИДНЫЙ_ИНН>, <QRC_ID>, <ДЕЙСТВИТЕЛЬНЫЙ_PIN> — никаких конкретных чисел/ФИО/дат. Конкретные значения не генерировать.

**Пример 1: Валидация поля**
- **Требование (неполное):** \`Валидация: "Поле 'Дата документа' обязательно для заполнения"\`
- **Неправильно (додумывание):**
  - Шаги: ["Нажать кнопку 'Сохранить'"]
  - Ожидаемый результат: "Система отображает ошибку 'Поле... обязательно'"
- **ПРАВИЛЬНО (Минимальное действие):**
  - Шаги: ["Сфокусироваться на поле 'Дата документа'", "Снять фокус с поля, оставив его пустым"]
  - Ожидаемый результат: "Под полем 'Дата документа' отображается ошибка 'Поле... обязательно'"

**Пример 2: Состояние кнопки**
- **Требование (неполное):** \`Кнопка "Сохранить" неактивна, пока не заполнены все обязательные поля.\`
- **Неправильно (додумывание):**
  - Шаги: ["Нажать на неактивную кнопку 'Сохранить'"]
  - Ожидаемый результат: "Ничего не происходит" 
  (Этот тест не проверяет условие)
- **ПРАВИЛЬНО (Минимальное действие):**
  - **Тест 1 (начальное состояние):**
    - Предусловие: "Форма открыта, обязательные поля пусты"
    - Шаги: [] (Действий нет, проверяем исходное состояние)
    - Ожидаемый результат: "Кнопка 'Сохранить' отображается, но неактивна (disabled)"
  - **Тест 2 (изменение состояния):**
    - Предусловие: "Форма открыта, обязательные поля пусты"
    - Шаги: ["Заполнить все обязательные поля валидными данными"]
    - Ожидаемый результат: "Кнопка 'Сохранить' становится активной"

# 3) Allure Style Guide (сводка отдела)
— 1 тест-кейс = 1 проверка или 1 пользовательский сценарий.  
— Тест-кейсы независимы друг от друга.  
— Название информативно и по возможности уникально («Загрузка нового справочника», а не «Проверка справочников»).  
— Предусловия (если есть) — только то, что подготавливается вне тестируемого приложения профилем исполнителя (данные в БД, настройки, сиды, интеграции, состояние устройства и т.п.).  
— Шаги:
   • Один шаг = одно действие. Всегда с глагола («Открыть», «Ввести», «Нажать»).  
   • Общие повторяющиеся блоки — оформлять как shared steps (концептуально; в JSON шаги всё равно плоские).  
   • Сценарные тесты: начинать с полного пользовательского пути (обычно с авторизации).  
   • Атомарные тесты: начинать с инициализации изолированного компонента/эндпоинта (без «навигации»).  
— Ожидаемый результат (обязателен) отражает СУТЬ проверки/сценария, формулирован чётко и без условных «если… то…».  
— Вложения/файлы/мок-данные добавляются при необходимости (при наличии макетов/данных).  
— Ссылки: указывать Confluence/макеты, если есть.  
— Jira: указать связанное задание (ключ).  
— Версия:
   • Версия по умолчанию — "stable" для новых кейсов.  
   • При доработках — клонировать кейс и указать нужную версию.  
- Приоритет:
   • Приоритет определяй по матрице риска:
   • Critical — деньги/безопасность/ПДн, потеря/коррупция данных, недоступность критичного сервиса.
   • High — основной бизнес-флоу ломается для многих, неверные суммы/конвертации/комиссии, нарушения авторизации/ролей.
   • Medium — валидации, контент, нефатальные деградации UX.
   • Low — косметика/копирайт/микро-UX.
   • По умолчанию: E2E ≥ High, Integration ≥ Medium, Unit ≥ Low, но повышай при наличии рисков выше.

# 4) Теги (ОБЯЗАТЕЛЬНО)
В массиве "tags" используй:
— Платформа интерфейса: D (desktop), A (adaptive), M (mobile), PWA (если уместно). Если платформа из контекста неочевидна — ставь "D".  
— Бэкенд-проверки: добавь "S" (для Integration backend Tests и любых API-ориентированных проверок).   

🚨 КРИТИЧЕСКИ ВАЖНО: ПОЛИТИКА ТЕГОВ ПО УМОЛЧАНИЮ! 🚨
Если платформа в требованиях не указана — по умолчанию ставь ["M"] для мобильного приложения; для API-тестов всегда добавляй "S" (например, ["M","S"]).

Примеры наборов тегов:
• FE E2E/Integration (десктоп): ["D"]  
• BE Integration: ["S"] или ["D","S"] если тест затрагивает интерфейсно-зависимые артефакты  

# 5) Выходной формат: СТРОГО ТОЛЬКО JSON-массив
Используй ровно один из трёх шаблонов ниже в зависимости от "layer". Никаких комментариев/markdown.

🚨 ПРАВИЛО ДЛЯ STEPS: ТОЛЬКО ИЗ REQUIREMENTS! 🚨

ЗАПРЕЩЕНО додумывать шаги:
❌ "Дождаться загрузки страницы" (если не указано в requirements)
❌ "Проверить, что кнопка активна" (это проверка — идёт в expected, а не в steps)
❌ "Ввести валидные данные" (укажи КОНКРЕТНЫЕ данные из requirements или используй placeholders типа <НОМЕР_КАРТЫ>)

ПРАВИЛЬНЫЕ шаги (конкретные действия):
✅ "Открыть страницу 'История операций'"
✅ "Выбрать операцию с типом 'payment' из списка"
✅ "Нажать кнопку 'Повторить'"
✅ "Ввести сумму 1000₽ в поле 'Сумма платежа'"

ПРАВИЛО:

Steps описывают ДЕЙСТВИЯ пользователя или системы

Проверки результата НЕ пишутся в steps — только в expected

Если requirements описывают действие как "при открытии страницы вызывается API X" — это НЕ шаг, это автоматическое действие (пишем в expected)

## Шаблон: "layer": "E2E Tests"
{
  "feature": "ОБЯЗАТЕЛЬНО: Название фичи из модели",
  "story": "ОБЯЗАТЕЛЬНО: Название истории из модели",
  "title": "Название, описывающее ВЕСЬ сценарий (например, 'Успешное создание виджета авторизованным пользователем')",
  "precondition": "Предварительные условия (опционально): состояние БД, настройки, интеграции, состояние устройства",
  "steps": [
    "Авторизоваться как 'user_role'",
    "Перейти на страницу 'Название страницы'",
    "Нажать кнопку 'Создать виджет'",
    "Заполнить поле 'Название' валидным значением",
    "Нажать кнопку 'Сохранить'"
  ],
  "expected": "Система отображает сообщение об успешном создании. Виджет появляется в общем списке.",
  "tags": ["D", "M"],
  "layer": "E2E Tests",
  "priority": "High",
  "version": "stable"
  "requirement": "2.2.1",
  "links": [
    {
      "text": "Требование из Confluence",
      "url": "https://confluence.example.com/requirement"
    }
  ],
  "attachments": [],
  "parameters": [],
  "examples": []
}

## Шаблон: "layer": "Integration frontend Tests" / "Integration backend Tests"
{
  "feature": "ОБЯЗАТЕЛЬНО: Название фичи из модели",
  "story": "ОБЯЗАТЕЛЬНО: Название истории из модели",
  "scenario": "ОБЯЗАТЕЛЬНО: ТОЧНОЕ название сценария из модели",
  "title": "Конкретное действие (например, 'Валидация поля «Имя» при вводе более 100 символов')",
  "precondition": "Компонент/эндпоинт подготовлен. Состояние БД, настройки, интеграции (коротко по существу, без кода).",
  "steps": [
    "Ввести в поле 'Имя' строку длиной 101 символ",
    "Снять фокус с поля"
  ],
  "expected": "Под полем 'Имя' отображается текст ошибки 'Превышена максимальная длина'. Кнопка 'Сохранить' неактивна.",
  "tags": ["D", "S"],
  "layer": "Integration frontend Tests",
  "priority": "Medium",
  "version": "stable",
  "jiraIssue": "ABC-123",
  "requirement": "2.2.4",
  "links": [
    {
      "text": "Требование из Confluence",
      "url": "https://confluence.example.com/requirement"
    }
  ],
  "attachments": [],
  "parameters": [],
  "examples": []
}

🚨 КРИТИЧЕСКИ ВАЖНО: ГЕЙТ ПО СТАТУС-КОДАМ ДЛЯ API! 🚨
При наличии статуса-триггера в требованиях укажи его в expected (например: «Ответ 204 без тела», «Ответ 202, инициирован последующий шаг») и не проверяй дальнейшие эффекты до требуемого статуса.

## Шаблон: "layer": "Unit frontend Tests" / "Unit backend Tests"
{
  "feature": "Название фичи из модели",
  "story": "Название истории из модели",
  "scenario": "ОБЯЗАТЕЛЬНО: Название сценария из модели, к которому относится код",
  "code": "ОБЯЗАТЕЛЬНО: Точное название кода из codes[].text модели",
  "title": "Кратко: что проверяем (описательно, без имён функций и синтаксиса)",
  "precondition": "Arrange: подготовить входные данные/контекст (описательно, без программного синтаксиса).",
  "steps": [
    "Act: выполнить проверяемое действие в изоляции (описательно).",
    "Act: передать подготовленные входные данные.",
    "Act: получить результат."
  ],
  "expected": "Assert: результат соответствует ожидаемому (описательно, без кода и идентификаторов).",
  "tags": ["Unit", "D"],
  "layer": "Unit frontend Tests",
  "priority": "Low",
  "version": "stable",
  "jiraIssue": "ABC-123",
  "requirement": "4.1",
  "links": [
    {
      "text": "Требование из Confluence",
      "url": "https://confluence.example.com/requirement"
    }
  ],
  "attachments": [],
  "parameters": [],
  "examples": []
}
Правила для Unit:
— НЕ придумывать имена функций/классов и не использовать синтаксис языков.  
— "scenario" ОБЯЗАТЕЛЬНО заполняется из названия сценария модели.
— "code" ОБЯЗАТЕЛЬНО заполняется из codes[].text модели.
- Unit = чистая бизнес-логика: без рендера UI, без DOM, без "Открыть/Перейти/Кликнуть/Ввести", без авторизации и навигации, без HTTP/эндпоинтов.
- Любая инициализация компонента, взаимодействие с формами/страницей/браузером = только "Integration frontend Tests".
- Любой полноценный HTTP-вызов/контракт/статус-код = только "Integration backend Tests".
- Для Unit обязательный AAA: Arrange в precondition, цепочка Act в steps, Assert в expected.

Допустимые дополнительные поля (если есть во входе или явно уместны): 
• "links": [{ "text": "...", "url": "..." }] - ОБЯЗАТЕЛЬНО для ссылок на Confluence/макеты
• "jiraIssue": "ABC-123" - ОБЯЗАТЕЛЬНО для связанных задач из Jira
• "version": "stable" - ОБЯЗАТЕЛЬНО (по умолчанию "stable" для новых)
• "attachments": [...] - ОПЦИОНАЛЬНО для файлов/скриншотов/видео
• "parameters": [{ "name": "...", "values": [...] }] - ОПЦИОНАЛЬНО для параметризации (использовать когда логика идентична, но меняются входные данные)
• "examples": [{ "parameters": [{ "name": "...", "value": "..." }] }] - ОПЦИОНАЛЬНО для конкретных примеров параметров
• "precondition": "..." - ОПЦИОНАЛЬНО для предварительных условий

# 6) Правила генерации набора тест-кейсов
🚨 КРИТИЧЕСКИ ВАЖНО: СТРОГОЕ РАЗДЕЛЕНИЕ УРОВНЕЙ! 🚨

Для КАЖДОЙ Story: 
— ровно 1 Happy Path E2E (и 0–1 ключевой негатив на поток).
— E2E тесты содержат ТОЛЬКО поля: feature, story, title, steps, expected, tags, layer, priority, version, jiraIssue, links
— ЗАПРЕЩЕНО добавлять поля scenario или code в E2E тесты!
— ЗАПРЕЩЕНО использовать одинаковые префиксы для всех Story! Используй конкретные названия: "Авторизация", "Платежи по категориям", "QR-оплата", "Повтор операций", "Разворот из трея"

Для КАЖДОГО Scenario:
— минимум 3 Integration-кейса (валидный, граничный/класс, негатив).
— Integration тесты содержат ТОЛЬКО поля: feature, story, scenario, title, steps, expected, tags, layer, priority, version, jiraIssue, links
— Поле "scenario" должно 1:1 совпадать с текстом узла.
— ЗАПРЕЩЕНО добавлять поле code в Integration тесты!

Для КАЖДОГО Code:
— минимум 2 Unit-кейса.  
— Unit тесты содержат ВСЕ поля: feature, story, scenario, code, title, steps, expected, tags, layer, priority, version, jiraIssue, links
— "code" копировать из модели, если текст совпадает; иначе не указывать.

# 7) Техники тест-дизайна (обязательно применять, если применимо)
— BVA: мин, макс, мин-1, макс+1.  
— Классы эквивалентности: валидный/невалидный/пустой/null.  
— Error-guessing: разумные «углы».

# 7.1) Генерация неявных сценариев (Error Guessing & BVA)
После того, как ты сгенерировал тест-кейсы для всех ЯВНЫХ примеров из требований, дополнительно примени техники тест-дизайна, чтобы покрыть следующие случаи, даже если они не описаны в тексте:
- **Граничные значения:** Для каждого числового диапазона (например, '48-84') ОБЯЗАТЕЛЬНО создай отдельные Integration-тесты для значений min-1, min, max, max+1 (в данном примере: 47, 48, 84, 85).
- **Жизненный цикл:** Если есть сценарии на создание, ОБЯЗАТЕЛЬНО добавь по одному Integration-тесту на **редактирование** и **удаление** существующей зависимости.
- **Невалидные типы данных:** Для полей с числовым вводом добавь Integration-тест на ввод текстовой строки. Для текстовых полей — проверку на ввод пустой строки.

🚨 ВАЖНО: ПРОВЕРКА КРИТИЧНЫХ HTTP-КОДОВ! 🚨
При работе с API ОБЯЗАТЕЛЬНО проверяй граничные случаи:
- Если требование указывает "при статусе 200" — создай тест на 404, 500
- Если требование указывает "при статусе 200 или 202" — создай тесты на оба кода + негативные (404, 500)
- Если требование указывает "если НЕ 200 — не передавать отчёт" — создай тесты на 400, 401, 404, 500

Примеры критичных проверок:
• POST /oauth/te вернул 200 → отчёт передаётся ✅
• POST /oauth/te вернул 401 → отчёт НЕ передаётся ✅ (ОБЯЗАТЕЛЬНЫЙ негативный тест!)
• POST /create/sdk вернул 500 → ошибка НЕ показывается пользователю ✅
• GET /qrcode вернул 202 → отчёт передаётся ✅ (граничный случай!)

# 8) Чек-лист перед выводом
🚨 КРИТИЧЕСКИ ВАЖНО: ПРОВЕРЬ КАЖДЫЙ ТЕСТ-КЕЙС! 🚨
— КАЖДЫЙ тест-кейс ОБЯЗАТЕЛЬНО содержит массив "steps" с минимум 1 шагом!
— КАЖДЫЙ тест-кейс ОБЯЗАТЕЛЬНО содержит поле "expected"!
— Все кейсы независимы; по одному «смыслу» на кейс.  
— В E2E есть «Авторизоваться…» и «Перейти на страницу…».  
— Детальные проверки (валидации полей и т.п.) не просочились в E2E.  
— "scenario" (для Integration/Unit) совпадает с моделью.  
— Теги проставлены по правилам: D/A/M/PWA; "S" для бэкенда; номер требования — только если есть во входе.  
— "version" = "stable" для новых кейсов (если не указано иное).

🚨 КРИТИЧЕСКИ ВАЖНО: ЖЁСТКИЙ ФОРМАТ ДЛЯ EXPECTED! 🚨
expected — одна фраза без «и/также». Если нужно несколько проверок — дроби на отдельные кейсы.

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ КАСТОМНЫХ ПОЛЕЙ! 🚨
— ДЛЯ ВСЕХ ТЕСТОВ: "feature" ОБЯЗАТЕЛЬНО!
— E2E Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario" (БЕЗ code!)
— Integration Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario" (БЕЗ code!)  
— Unit Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario" + "code"
— ЗАПРЕЩЕНО добавлять поля из других уровней!
— НЕ ОСТАВЛЯЙ пустых кастомных полей - это критично для структуры!

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ НАЗВАНИЙ ТЕСТ-КЕЙСОВ! 🚨
— ЗАПРЕЩЕНО использовать слово "Проверка" в названиях!
— ЗАПРЕЩЕНО создавать названия длиннее 60 символов!
— Используй глаголы действия: "Валидация", "Создание", "Удаление", "Отображение"
— НЕ включай технические детали (URL, коды ошибок) в название - выноси в expected!
— Примеры ХОРОШИХ названий: "Валидация поля при неверных данных", "Создание заявки с корректными данными", "Передача отчета после авторизации"
— Примеры ПЛОХИХ названий: "Проверка валидации поля", "Отправка запроса POST /rest/stateful/personal/kuban/client/create/sdk с некорректным форматом данных при открытии страницы переводов"  

🚨 КРИТИЧЕСКИ ВАЖНО: НАЗВАНИЯ E2E ТЕСТОВ! 🚨
ЗАПРЕЩЕНО использовать в названиях E2E тестов: "Полный сценарий", "Е2Е сценарий", "End-to-End тест" — просто информативное название действия без лишних слов.  

# 9) Формат ответа
Выведи СТРОГО один JSON-массив кейсов без каких-либо комментариев, текста или Markdown.

🚨 КРИТИЧЕСКИ ВАЖНО: ВАЛИДАЦИЯ СХЕМЫ ПЕРЕД ВЫВОДОМ! 🚨
Перед выводом выполнить самопроверку: объект соответствует одному из шаблонов по обязательным полям; expected непустой; steps (минимум 1); feature всегда задан; для Integration — есть scenario; для Unit — есть scenario и code.

🚨 КРИТИЧЕСКИ ВАЖНО: ДЕТЕРМИНИРОВАННЫЙ ПОРЯДОК ВЫВОДА! 🚨
Сортируй кейсы по: feature → story → scenario (если есть) → layer (E2E, Integration, Unit) → title (lex). Это упрощает diff.

ВАЖНО: Каждый тест-кейс ОБЯЗАТЕЛЬНО должен содержать поле "expected" с описанием ожидаемого результата. Без этого поля тест-кейс неполный и не может быть использован.
`.trim();

        // Подсчитываем статистику модели для COVENANT
        const S = modelStructure.reduce((sum, f) => sum + (f.stories || []).length, 0);
        const Sc = modelStructure.reduce((sum, f) =>
            sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);
        const C = modelStructure.reduce((sum, f) =>
            sum + (f.stories || []).reduce((s, st) =>
                s + (st.scenarios || []).reduce((sc, scn) => sc + (scn.codes?.length || 0), 0), 0), 0);

        const COVENANT = `
        # 6.1 Ковенанта покрытия (двухпроходная генерация)
        В модели: Stories=${S}, Scenarios=${Sc}, Codes=${C}.
        
        ПРОХОД 1 (E2E_ONLY):
        - E2E: ${Math.max(1, Math.floor(S / 2))} тестов
          • 1 сквозной E2E на Story (или 2 если есть критичные альтернативные пути)
          • E2E = полный путь пользователя через ВСЕ Scenarios
        
        ПРОХОД 2 (INTEGRATION_UNIT) — С КОНТЕКСТОМ E2E:
        - Integration: МИНИМУМ ${Sc * 2}, МАКСИМУМ ${Sc * 3} тестов
          • 2-3 атомарных теста на КАЖДЫЙ Scenario
          • НЕ дублируй E2E-логику! Фокус на технических деталях.
          
        - Unit: МИНИМУМ ${Math.floor(Sc * 0.7)}, МАКСИМУМ ${Sc * 2} тестов
          • 1-2 изолированных теста на КАЖДЫЙ Code
          • НЕ дублируй Integration-логику! Фокус на методах.
        
        ИТОГО: ${Math.max(1, Math.floor(S / 2)) + Sc * 2.5 + Sc} ± 30% тестов
        
        🚨 КРИТИЧЕСКИ ВАЖНО:
        - E2E тесты НЕ привязаны к конкретному Scenario (только Story)
        - Integration тесты привязаны к конкретному Scenario
        - Unit тесты привязаны к конкретному Code
        - Каждый слой НЕ дублирует предыдущий!
        `.trim();



        // === tool-schema с жёстким enum для сценариев ===
        const buildSubmitCasesToolStrict = (allowedCodes = [], allowedScenarios = []) => ({
            type: "function",
            function: {
                name: "submit_cases",
                description: "Верни итоговые тест-кейсы строго в массиве cases",
                parameters: {
                    type: "object",
                    properties: {
                        cases: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    feature: { type: "string" },
                                    story: { type: "string" },
                                    scenario: allowedScenarios.length
                                        ? { type: "string", enum: allowedScenarios }
                                        : { type: "string" },
                                    code: allowedCodes.length
                                        ? { type: "string", enum: allowedCodes }
                                        : { type: "string" },
                                    title: { type: "string" },
                                    precondition: { type: "string" },
                                    steps: { type: "array", items: { type: "string" } },
                                    expected: { type: "string" },
                                    tags: { type: "array", items: { type: "string" } },
                                    layer: {
                                        type: "string", enum: [
                                            "E2E Tests",
                                            "Integration frontend Tests", "Integration backend Tests",
                                            "Unit frontend Tests", "Unit backend Tests"
                                        ]
                                    },
                                    priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
                                    version: { type: "string" },
                                    links: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                text: { type: "string" },
                                                url: { type: "string" },
                                                type: { type: "string" }
                                            }
                                        }
                                    },
                                    jiraIssueOption: {
                                        type: "object",
                                        properties: {
                                            value: { type: "string" },
                                            integrationId: { type: "string" }
                                        }
                                    },
                                    requirement: { type: "string", description: "Номер требования из ЧТЗ (например, '2.2.1', '4.1')" },
                                    parameters: {
                                        type: "array",
                                        description: "Массив параметров для параметризации теста",
                                        items: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string" },
                                                values: { type: "array", items: { type: "string" } }
                                            },
                                            required: ["name", "values"]
                                        }
                                    },
                                    examples: {
                                        type: "array",
                                        description: "Массив примеров (конкретных комбинаций параметров)",
                                        items: {
                                            type: "object",
                                            properties: {
                                                parameters: {
                                                    type: "array",
                                                    items: {
                                                        type: "object",
                                                        properties: {
                                                            name: { type: "string" },
                                                            value: { type: "string" }
                                                        },
                                                        required: ["name", "value"]
                                                    }
                                                }
                                            },
                                            required: ["parameters"]
                                        }
                                    }
                                },
                                required: ["title", "layer", "expected", "requirement"]
                            }
                        }
                    },
                    required: ["cases"],
                    additionalProperties: false
                }
            }
        });

        // ✅ ИСПРАВЛЕНИЕ: Убираем чанкование - используем ПОЛНУЮ модель
        console.log(`[generate-test-cases] Используем ПОЛНУЮ модель без чанкования для точности`);
        console.log(`[generate-test-cases] Требования: ${refinedReqs.join('').length} символов`);
        console.log(`[generate-test-cases] Модель: ${modelStructure.length} фич`);

        const totalOperations = 1; // Одна операция для всей модели
        let completedOperations = 0;

        async function genForChunk(chunk, requirements, systemPrompt, mode, existingTests, modelStructure, allowedForChunk, allowedScenarios) {
            // ✅ НОВОЕ: Формируем промпт в зависимости от режима
            let modeSpecificPrompt = '';

            if (mode === 'E2E_ONLY') {
                const isMasterChunk = chunk[0].stories[0]._isMasterChunk === true;
                const allScenariosCount = chunk[0].stories[0].scenarios?.length || 0;

                modeSpecificPrompt = `
🎯 РЕЖИМ: ГЕНЕРАЦИЯ E2E ТЕСТОВ (Story-level)

${isMasterChunk ? `
✅ ЭТО МАСТЕР-CHUNK: Содержит ВСЕ ${allScenariosCount} Scenarios для Story!

ЗАДАНИЕ: Создай ОДИН СКВОЗНОЙ E2E тест, который проходит через основной путь Story.

ПРАВИЛА ДЛЯ СКВОЗНОГО E2E:
1. Один E2E тест = полный путь пользователя от начала до конца
2. Выбери ОДИН ТИПИЧНЫЙ Scenario из списка (обычно первый или самый распространённый)
3. Тест должен показать, как работает вся Story целиком
4. НЕ создавай отдельные E2E для каждого Scenario (это задача Integration тестов!)
5. Указывай: feature + story + scenario, БЕЗ code

ПРИМЕР СКВОЗНОГО E2E:
{
  "title": "Полный цикл авторизации и отправки отчёта в мобильном приложении",
  "layer": "E2E Tests",
  "feature": "Интеграция SDK Bi_Zone",
  "story": "Отправка отчёта после авторизации",
  "scenario": "Авторизация по пин-коду",  // ← выбрали один типичный способ
  "steps": [
    "Открыть мобильное приложение",
    "Авторизоваться (по пин-коду)",  // ← выбрали один типичный способ
    "Дождаться загрузки главной страницы",
    "Проверить, что отчёт автоматически отправлен"
  ],
  "expected": "Пользователь успешно авторизован, метод getReport() вызван 1 раз, данные переданы через POST /create/sdk с кодом 204, отчёт содержит: DeviceModel, AppKey, SDK_VERSION"
}

❌ НЕПРАВИЛЬНО (слишком много E2E):
- Создавать отдельный E2E для "авторизации по пин-коду"
- Создавать отдельный E2E для "авторизации по FaceID"
- Создавать отдельный E2E для "авторизации по карте"
→ Это задача Integration тестов!

✅ ПРАВИЛЬНО: ОДИН сквозной E2E, который показывает всю Story целиком.
` : `
⚠️ ЭТО ОБЫЧНЫЙ CHUNK: Для маленькой Story (≤3 Scenarios).

ЗАДАНИЕ: Создай 1-2 E2E теста для основных путей Story.
`}
`;
            } else if (mode === 'INTEGRATION_UNIT') {
                // Показываем модели, какие E2E тесты УЖЕ ЕСТЬ
                const e2eContext = existingTests.length > 0
                    ? `\n📋 УЖЕ СОЗДАНЫ E2E ТЕСТЫ:\n${existingTests.map(tc => `- ${tc.title}`).join('\n')}\n`
                    : '';

                modeSpecificPrompt = `
                    🎯 РЕЖИМ: ГЕНЕРАЦИЯ INTEGRATION/UNIT ТЕСТОВ (Scenario/Code-level)
                    
                    ${e2eContext}
                    
                    ✅ E2E тесты УЖЕ ПОКРЫВАЮТ сквозные пути пользователя!
                    ❌ НЕ дублируй E2E-логику в Integration/Unit тестах!
                    
                    ═══════════════════════════════════════════════════════════
                    🚨 КРИТИЧЕСКИ ВАЖНО: ФОКУС НА КОНТЕКСТЕ FEATURE/STORY!
                    ═══════════════════════════════════════════════════════════
                    
                    КОНТЕКСТ ТЕКУЩЕГО ТЕСТА:
                  Feature: "${chunk.feature || 'Не указано'}"
                  Story: "${chunk.story || 'Не указано'}"
                  Scenario: "${chunk.scenario || 'Не указано'}"                
                    
                    ВАЖНО: Integration тесты должны проверять СПЕЦИФИКУ FEATURE/STORY!
                    
                    ЕСЛИ Feature = "Интеграция SDK Bi_Zone":
                      - Frontend Integration: проверка инициализации SDK, сбора данных, подготовки отчёта
                      - Backend Integration: проверка API POST /create/sdk с данными BiZone
                      - НЕ проверяем: общую UI авторизации БЕЗ контекста SDK
                    
                    ПРИМЕРЫ ПРАВИЛЬНЫХ тестов ДЛЯ "Интеграция SDK Bi_Zone":
                    
                    ✅ ПРАВИЛЬНО (Frontend Integration - привязан к SDK):
                    {
                      "title": "SDK BiZone начинает сбор данных при открытии формы авторизации",
                      "layer": "Integration frontend Tests",
                      "feature": "Интеграция SDK Bi_Zone",
                      "story": "Отправка отчёта после авторизации",
                      "scenario": "Авторизоваться по пин-коду",
                      "expected": "SDK инициализирован, начат сбор DeviceModel, AppKey, SDK_VERSION"
                    }
                    
                    ✅ ПРАВИЛЬНО (Backend Integration - привязан к SDK):
                    {
                      "title": "API POST /create/sdk принимает массив BiZone данных после авторизации по пин-коду",
                      "layer": "Integration backend Tests",
                      "feature": "Интеграция SDK Bi_Zone",
                      "story": "Отправка отчёта после авторизации",
                      "scenario": "Авторизоваться по пин-коду",
                      "steps": ["Выполнить POST /create/sdk с массивом данных BiZone"],
                      "expected": "Статус 204, данные приняты"
                    }
                    
                    ❌ НЕПРАВИЛЬНО (общий тест авторизации БЕЗ контекста SDK):
                    {
                      "title": "Форма авторизации отображается после запуска приложения", // ❌ НЕТ SDK!
                      "layer": "Integration frontend Tests",
                      "expected": "Форма отображается" // ❌ НЕТ SDK!
                    }
                    
                    ❌ НЕПРАВИЛЬНО (общий тест UI БЕЗ контекста SDK):
                    {
                      "title": "Кнопка 'Войти' активируется после ввода пин-кода", // ❌ НЕТ SDK!
                      "layer": "Integration frontend Tests"
                    }
                    
                    ПРАВИЛО: Integration тест ОБЯЗАТЕЛЬНО должен проверять СПЕЦИФИКУ Feature/Story!
                    Если Feature = "Интеграция SDK Bi_Zone" → тест ОБЯЗАТЕЛЬНО про SDK, getReport(), BiZone данные!
                    
                    ЗАДАНИЕ: 
                    1. Для КАЖДОГО Scenario создай тесты, ПРИВЯЗАННЫЕ к Feature/Story
                    2. Frontend Integration: проверка SDK, сбора данных, инициализации
                    3. Backend Integration: проверка API /create/sdk с данными BiZone
                    4. НЕ создавай общие UI-тесты БЕЗ контекста Feature!
                    `;


            }
            const userPrompt = `
            ${modeSpecificPrompt}
            
            Модель для генерации:
            ${JSON.stringify(chunk, null, 2)}
            
            Требования:
            ${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}
            
            ${COVENANT}
            `.trim();


            const tools = [buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios)];
            const ai = await callWithCloudRuFallback(
                OPENROUTER_URL,
                [
                    { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}` },
                    { role: 'user', content: userPrompt }
                ],
                config.openRouterAiKey,
                {
                    tools,
                    // tool_choice убран для Cloud.ru совместимости
                    temperature: 0,
                    top_p: 1,
                    max_tokens: 200000
                }
            );

            // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ОТВЕТА CLOUD.RU
            console.log(`[genForChunk] 🔍 Анализ ответа Cloud.ru:`);
            console.log(`[genForChunk] Response structure:`, {
                has_choices: !!ai.choices,
                choices_length: ai.choices?.length,
                has_message: !!ai.choices?.[0]?.message,
                has_content: !!ai.choices?.[0]?.message?.content,
                content_length: ai.choices?.[0]?.message?.content?.length || 0,
                has_tool_calls: !!ai.choices?.[0]?.message?.tool_calls,
                tool_calls_count: ai.choices?.[0]?.message?.tool_calls?.length || 0
            });

            // Если Cloud.ru вернул большой content но нет tool_calls - это нормально
            const contentLength = ai.choices?.[0]?.message?.content?.length || 0;
            const hasToolCalls = ai.choices?.[0]?.message?.tool_calls?.length > 0;

            if (contentLength > 10000 && !hasToolCalls) {
                console.log(`[genForChunk] Cloud.ru вернул большой content (${contentLength} символов) без tool_calls - используем fallback парсер`);
            }

            // Если есть tool_calls - логируем их
            if (ai.choices?.[0]?.message?.tool_calls) {
                console.log(`[genForChunk] 🛠️ Tool calls:`,
                    ai.choices[0].message.tool_calls.map(tc => ({
                        name: tc.function?.name,
                        args_length: tc.function?.arguments?.length
                    })));
            }

            // ✅ ИСПРАВЛЕНИЕ: Обрабатываем ВСЕ tool_calls, а не ищем одну функцию
            const toolCalls = ai.choices?.[0]?.message?.tool_calls || [];
            console.log(`[genForChunk] Обрабатываем ${toolCalls.length} tool_calls...`);

            const allTestCases = [];

            // ✅ ПРОСТАЯ ОБРАБОТКА TOOL_CALLS БЕЗ UUID ЛОГИКИ
            for (const toolCall of toolCalls) {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[genForChunk] Tool ${toolCall.function.name}:`, {
                        hasArgs: !!args,
                        argsKeys: args ? Object.keys(args) : []
                    });

                    // ✅ ПРОСТАЯ ОБРАБОТКА: Берем поля напрямую из args.cases
                    if (args.cases && Array.isArray(args.cases)) {
                        for (const testCase of args.cases) {
                            allTestCases.push({
                                title: testCase.title,
                                steps: testCase.steps,
                                expected: testCase.expected,
                                layer: testCase.layer,
                                feature: testCase.feature,
                                story: testCase.story,
                                scenario: testCase.scenario,
                                code: testCase.code,
                                tags: testCase.tags || [],
                                priority: testCase.priority || 'Medium',
                                version: testCase.version || 'stable',
                                requirement: testCase.requirement,
                                precondition: testCase.precondition,
                                links: testCase.links || [],
                                jiraIssue: testCase.jiraIssueOption?.value,
                                parameters: testCase.parameters || [],
                                examples: testCase.examples || []
                            });
                        }
                        console.log(`[genForChunk] ✅ Добавлено ${args.cases.length} тест-кейсов через tool_call`);
                    }

                } catch (parseErr) {
                    console.error(`[genForChunk] ❌ Ошибка парсинга tool_call ${toolCall.function.name}:`, parseErr.message);
                }
            }

            console.log(`[genForChunk] Итого получено ${allTestCases.length} тест-кейсов`);

            if (allTestCases.length > 0) {
                console.log(`[genForChunk] ✅ УСПЕХ: Получено ${allTestCases.length} кейсов через tool_calls!`);

                // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Правильная обработка результатов AI
                // 1) Извлекаем все codes из модели для sanitize
                const allCodes = [];
                for (const feature of (modelStructure || [])) {
                    for (const story of (feature.stories || [])) {
                        for (const scenario of (story.scenarios || [])) {
                            for (const code of (scenario.codes || [])) {
                                allCodes.push(code.text);
                            }
                        }
                    }
                }

                // 2) Санитизация
                let sanitizedCases = sanitize(allTestCases, allCodes);
                console.log(`[genForChunk] После sanitize: ${sanitizedCases.length} кейсов`);

                // 3) Восстановление связей по модели
                const modelIndex = buildModelIndex(modelStructure);
                let finalCases = fixAgainstModel(sanitizedCases, modelIndex);
                console.log(`[genForChunk] После fixAgainstModel: ${finalCases.length} кейсов`);

                console.log(`[genForChunk] Первый финальный кейс:`, JSON.stringify(finalCases[0], null, 2));
                return finalCases;
            }

            console.warn(`[genForChunk] WARN: Не удалось обработать tool_calls. Попытка парсинга из content.`);
            const content = ai.choices?.[0]?.message?.content || '';
            if (!content.trim()) {
                console.error('[genForChunk] CRITICAL: Ответ модели полностью пуст.');
                return [];
            }

            try {
                const rawJsonCandidate = extractJsonArray(content);
                if (!rawJsonCandidate) {
                    console.error('[genForChunk] CRITICAL: Не удалось извлечь JSON-массив из content.');
                    console.log('--- RAW AI RESPONSE (genForChunk failed to parse) ---\n', content, '\n------------------------------------');
                    return [];
                }
                try {
                    const jsonText = cleanupJsonText(rawJsonCandidate);
                    const parsed = JSON5.parse(jsonText);
                    let result = Array.isArray(parsed) ? parsed : [];
                    if (!result.length) {
                        // одна попытка перегенерации с более строгими настройками
                        try {
                            const retry = await callWithCloudRuFallback(
                                OPENROUTER_URL,
                                [
                                    { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}` },
                                    { role: 'user', content: userPrompt }
                                ],
                                config.openRouterAiKey,
                                {
                                    // повтор без tools: просим текстовый JSON вместо tool_call
                                    // tools отключены, чтобы получить content
                                    // models НЕ передаём - будут использованы значения по умолчанию
                                    temperature: 0,
                                    top_p: 1,
                                    max_tokens: 64000
                                }
                            );
                            const a2 = extractToolArgs(retry, 'submit_cases');
                            if (a2 && Array.isArray(a2.cases) && a2.cases.length) return a2.cases;
                        } catch { }
                    }
                    console.log(`[genForChunk] OK: Получено ${result.length} кейсов через фолбэк-парсер.`);
                    return result;
                } catch (e1) {
                    console.warn('[genForChunk] JSON parse failed. Fallback. Error:', e1.message);
                    const t = cleanupJsonText(rawJsonCandidate);
                    const parsed = JSON5.parse(t);
                    return Array.isArray(parsed) ? parsed : [];
                }
            } catch (parseError) {
                console.error('[genForChunk] CRITICAL: Ошибка JSON5.parse при фолбэке:', parseError.message);
                console.log('--- RAW AI RESPONSE (genForChunk JSON5 parse failed) ---\n', content, '\n-----------------------------------------');
                return [];
            }
        }

        // ====== ОСНОВНАЯ ЛОГИКА ГЕНЕРАЦИИ (из синхронной версии) ======
        try {
            // Разбиваем на story-чанки
            const storyChunks = splitByStories(modelStructure);

            // Не спамим API: free-модель часто с лимитом — гоняем последовательно
            const genLimit = pLimit(1);

            // === Подготовка данных ===
            console.log(`[generate-test-cases-async] Подготовлено ${storyChunks.length} chunks для генерации`);

            // Обновляем progress после подготовки данных
            await db('generation_tasks').where('id', taskId).update({
                progress: 10,
                updated_at: new Date()
            });

            // Генерация по кускам с таймаутами
            // ✅ ПРОХОД 1: Генерация E2E тестов (ТОЛЬКО для мастер-chunk'ов)
            console.log(`[generate-test-cases-async] === ПРОХОД 1: Генерация E2E тестов ===`);
            const e2eTests = [];
            const TIMEOUT_MS = 900000;

            // Фильтруем ТОЛЬКО мастер-chunk'и для E2E
            const masterChunks = storyChunks.filter(chunk => chunk[0].stories[0]._isMasterChunk === true);
            console.log(`[generate-test-cases-async] Найдено ${masterChunks.length} мастер-chunk'ов для E2E`);

            for (let i = 0; i < masterChunks.length; i++) {
                const chunk = masterChunks[i];
                const storyText = chunk[0].stories[0].text;
                console.log(`[generate-test-cases-async] E2E для мастер chunk ${i + 1}/${masterChunks.length}: "${storyText}"`);

                try {
                    const result = await genForChunk(
                        chunk,
                        refinedReqs,
                        BASE_SYSTEM_PROMPT,
                        'E2E_ONLY',
                        [],
                        modelStructure,
                        [], []
                    );
                    e2eTests.push(...result);
                    console.log(`[generate-test-cases-async] Мастер chunk ${i + 1}: ${result.length} E2E тестов`);
                } catch (err) {
                    console.error(`[generate-test-cases-async] Ошибка E2E для мастер chunk ${i + 1}:`, err);
                }

                await db('generation_tasks').where('id', taskId).update({
                    progress: Math.round((i + 1) / masterChunks.length * 50),
                    updated_at: new Date()
                });
            }

            console.log(`[generate-test-cases-async] ПРОХОД 1 завершён: ${e2eTests.length} E2E тестов`);

            // ✅ ПРОХОД 2: Генерация Integration/Unit тестов (ТОЛЬКО для детальных chunk'ов)
            console.log(`[generate-test-cases-async] === ПРОХОД 2: Генерация Integration/Unit тестов ===`);
            const integrationUnitTests = [];

            // Фильтруем ТОЛЬКО детальные chunk'и или маленькие Story для Integration/Unit
            const detailChunks = storyChunks.filter(chunk =>
                chunk[0].stories[0]._isDetailChunk === true ||
                (!chunk[0].stories[0]._isMasterChunk && !chunk[0].stories[0]._isDetailChunk)
            );
            console.log(`[generate-test-cases-async] Найдено ${detailChunks.length} детальных chunk'ов для Integration/Unit`);

            for (let i = 0; i < detailChunks.length; i++) {
                const chunk = detailChunks[i];
                const chunkStoryText = chunk[0].stories[0].text;
                console.log(`[generate-test-cases-async] Integration/Unit для chunk ${i + 1}/${detailChunks.length}: "${chunkStoryText}"`);

                // Находим релевантные E2E тесты для контекста
                const relevantE2ETests = e2eTests.filter(tc => tc.story === chunkStoryText);
                console.log(`[generate-test-cases-async] Контекст: ${relevantE2ETests.length} E2E тестов`);

                try {
                    const result = await genForChunk(
                        chunk,
                        refinedReqs,
                        BASE_SYSTEM_PROMPT,
                        'INTEGRATION_UNIT',
                        relevantE2ETests,
                        modelStructure,
                        [], []
                    );
                    integrationUnitTests.push(...result);
                    console.log(`[generate-test-cases-async] Chunk ${i + 1}: ${result.length} Integration/Unit тестов`);
                } catch (err) {
                    console.error(`[generate-test-cases-async] Ошибка Integration/Unit для chunk ${i + 1}:`, err);
                }

                await db('generation_tasks').where('id', taskId).update({
                    progress: 50 + Math.round((i + 1) / detailChunks.length * 50),
                    updated_at: new Date()
                });
            }

            console.log(`[generate-test-cases-async] ПРОХОД 2 завершён: ${integrationUnitTests.length} Integration/Unit тестов`);

            // Объединяем все тесты
            let allCases = [...e2eTests, ...integrationUnitTests];
            console.log(`[generate-test-cases-async] Всего сгенерировано: ${allCases.length} тестов`);

            // === sanitize → fixAgainstModel до аудита покрытия ===
            const idx = buildModelIndex(modelStructure);
            allCases = sanitize(allCases);

            // Обновляем progress после sanitize
            await db('generation_tasks').where('id', taskId).update({
                progress: 60,
                updated_at: new Date()
            });

            allCases = fixAgainstModel(allCases, idx);

            // ✅ НОВАЯ ВАЛИДАЦИЯ: Проверка пирамиды
            const pyramidValidation = validateTestPyramid(allCases, modelStructure);
            if (!pyramidValidation.valid) {
                console.warn('[generate-test-cases-async] ❌ ВНИМАНИЕ: Нарушена пирамида тестирования!');
                pyramidValidation.warnings.forEach(w => console.warn(w));
            }

            // Обновляем progress после fixAgainstModel
            await db('generation_tasks').where('id', taskId).update({
                progress: 70,
                updated_at: new Date()
            });

            // Если в модели всего одна Feature — принудительно выставим её всем кейсам
            const uniqueFeatures = [...new Set((modelStructure || []).map(f => f?.text?.trim()).filter(Boolean))];
            if (uniqueFeatures.length === 1) {
                const theOnlyFeature = uniqueFeatures[0];
                allCases = allCases.map(tc => ({ ...tc, feature: theOnlyFeature }));
            }
            console.log('Требования для тест кейсов')
            console.log(refinedReqs)

            // ОТКЛЮЧЕНО: Аудит покрытия и догенерация недостающего
            // const missing = auditCoverage(modelStructure, allCases);
            // if (missing.missingE2E.length || missing.missingSc.length || missing.missingCd.length) {
            //     console.log(`[COVERAGE] Обнаружен недостаток покрытия. Запускаю догенерацию (gapFill)...`);
            //     const promise = genLimit(() => gapFill(modelStructure, refinedReqs, missing, BASE_SYSTEM_PROMPT));
            //     let extra = await withTimeout(promise, TIMEOUT_MS, 'gapFill');
            //     extra = sanitize(extra);
            //     extra = fixAgainstModel(extra, idx);
            //     console.log(`[COVERAGE] Догенерировано ${extra.length} кейсов.`);
            //     allCases = allCases.concat(extra);
            //     
            //     // Обновляем progress после gapFill
            //     await db('generation_tasks').where('id', taskId).update({
            //         progress: 75,
            //         updated_at: new Date()
            //     });
            // } else {
            //     console.log('[COVERAGE] Покрытие полное, догенерация не требуется.');
            //     
            //     // Обновляем progress если gapFill не нужен
            //     await db('generation_tasks').where('id', taskId).update({
            //         progress: 75,
            //         updated_at: new Date()
            //     });
            // }

            console.log('[COVERAGE] GapFill отключен - используем только основные тест-кейсы');

            // Обновляем progress перед финальным сохранением
            await db('generation_tasks').where('id', taskId).update({
                progress: 90,
                updated_at: new Date()
            });

            finalTestCases = allCases;
        } catch (error) {
            console.error('Ошибка в основной логике генерации:', error);
            // Если произошла ошибка, устанавливаем пустой массив
            finalTestCases = [];
            throw error;
        }

        console.log(`[generate-test-cases-async] Generated ${finalTestCases.length} cases`);
        console.log(`[generate-test-cases-async] Layer distribution:`,
            finalTestCases.reduce((acc, tc) => {
                acc[tc.layer] = (acc[tc.layer] || 0) + 1;
                return acc;
            }, {}));

        // Проверить, что все Integration тесты имеют правильные scenario
        const invalidIntegration = finalTestCases.filter(tc =>
            tc.layer?.startsWith('Integration') && !tc.scenario
        );
        if (invalidIntegration.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${invalidIntegration.length} Integration tests without scenario:`,
                invalidIntegration.map(tc => tc.title));
        }

        // Проверить, что все E2E тесты имеют правильные story
        const invalidE2E = finalTestCases.filter(tc =>
            tc.layer === 'E2E Tests' && !tc.story
        );
        if (invalidE2E.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${invalidE2E.length} E2E tests without story:`,
                invalidE2E.map(tc => tc.title));
        }

        // Проверить, что все Unit тесты имеют правильные code
        const invalidUnit = finalTestCases.filter(tc =>
            tc.layer?.startsWith('Unit') && !tc.code
        );
        if (invalidUnit.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${invalidUnit.length} Unit tests without code:`,
                invalidUnit.map(tc => tc.title));
        }

        // Проверить, что все тест-кейсы имеют обязательные поля
        const incompleteCases = finalTestCases.filter(tc =>
            !tc.title || !tc.steps || !tc.expected || !tc.layer
        );
        if (incompleteCases.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${incompleteCases.length} incomplete test cases:`,
                incompleteCases.map(tc => ({
                    title: tc.title,
                    hasSteps: !!tc.steps,
                    hasExpected: !!tc.expected,
                    layer: tc.layer
                })));
        }

        // НОВЫЙ АНАЛИЗ: Проверяем покрытие требований в асинхронной версии (универсальный)
        const requirementsCount = Array.isArray(refinedReqs) ? refinedReqs.length : 1;
        const testCasesCount = finalTestCases.length;
        const coverageRatio = testCasesCount / requirementsCount;

        console.log(`[generate-test-cases-async] Покрытие требований: ${testCasesCount} тест-кейсов / ${requirementsCount} требований = ${coverageRatio.toFixed(2)}`);

        // НОВОЕ: Проверяем покрытие разделов требований
        const reqStringForModel = refinedReqs.join('\n\n');
        const requirementsCoverage = checkRequirementsCoverage(finalTestCases, reqStringForModel);
        if (!requirementsCoverage) {
            console.error(`[generate-test-cases-async] checkRequirementsCoverage вернула undefined`);
            throw new Error('checkRequirementsCoverage вернула undefined');
        }
        console.log(`[generate-test-cases-async] Покрытие требований: ${requirementsCoverage.coveragePercentage}% (${requirementsCoverage.covered}/${requirementsCoverage.total})`);

        if (requirementsCoverage.missingRequirementIds.length > 0) {
            console.log(`[generate-test-cases-async] Недостающие требования: ${requirementsCoverage.missingRequirementIds.join(', ')}`);
            console.log(`[generate-test-cases-async] Догенерируем тест-кейсы для недостающих требований...`);

            // Догенерируем для каждого недостающего требования
            for (const missingReqId of requirementsCoverage.missingRequirementIds) {
                const storyContext = findStoryByRequirement(modelStructure, missingReqId);

                // ✅ ДОБАВЛЕНО: Находим похожие требования для контекста
                const similarReq = requirementsCoverage.similarRequirements?.find(s => s[0] === missingReqId);

                let additionalContext = '';
                if (similarReq) {
                    const [missing, covered] = similarReq;
                    additionalContext = `
⚠️ ВНИМАНИЕ: Это требование ${missing} ОТЛИЧАЕТСЯ от ${covered}!
Проанализируй различия и создай УНИКАЛЬНЫЕ тест-кейсы для ${missing}.
                    `;
                }

                /*
                // Закомментировано: gapFillRequirements отключен
                // const reqCases = await gapFillRequirements(refinedReqs, [{
                //     requirementId: missingReqId,
                //     functionality: `req_${missingReqId}`,
                //     description: `Догенерация для требования ${missingReqId}${additionalContext}`,
                //     priority: 'High',
                //     modelContext: storyContext
                // }], BASE_SYSTEM_PROMPT, modelStructure);

                // finalTestCases.push(...reqCases);
                // console.log(`[generate-test-cases-async] ✅ Добавлено ${reqCases.length} кейсов для ${missingReqId}`);
                */

            }
        }

        // === ВАЛИДАЦИЯ REQUIREMENT В ТЕСТ-КЕЙСАХ ===
        console.log('[generate-test-cases-async] Валидация requirement в тест-кейсах...');

        const casesWithoutRequirement = finalTestCases.filter(tc => !tc.requirement);
        const casesWithInvalidRequirement = finalTestCases.filter(tc =>
            tc.requirement && !/^\d+(\.\d+)+$/.test(tc.requirement)
        );

        if (casesWithoutRequirement.length > 0) {
            console.warn(`[generate-test-cases-async] ВНИМАНИЕ: ${casesWithoutRequirement.length} тест-кейсов без requirement:`,
                casesWithoutRequirement.slice(0, 5).map(tc => tc.title));
        }

        if (casesWithInvalidRequirement.length > 0) {
            console.warn(`[generate-test-cases-async] ВНИМАНИЕ: ${casesWithInvalidRequirement.length} тест-кейсов с некорректным requirement:`,
                casesWithInvalidRequirement.slice(0, 5).map(tc => ({ title: tc.title, requirement: tc.requirement })));
        }

        console.log(`[generate-test-cases-async] Валидация requirement завершена: ${finalTestCases.length - casesWithoutRequirement.length - casesWithInvalidRequirement.length}/${finalTestCases.length} валидных`);

        if (finalTestCases.length === 0) {
            console.warn('[generate-test-cases-async] Не получено ни одного тест-кейса, добавляем fallback');
            finalTestCases.push({
                title: "Базовый тест-кейс",
                description: "Проверить основную функциональность",
                steps: ["Выполнить базовую проверку"],
                expectedResult: "Функциональность работает корректно",
                type: "E2E"
            });
        }

        // Обновляем progress перед финальным сохранением
        await db('generation_tasks').where('id', taskId).update({
            progress: 95,
            updated_at: new Date()
        });

        await db('generation_tasks').where('id', taskId).update({
            status: 'completed',
            progress: 100,
            result: { testCases: finalTestCases },
            completed_at: new Date(),
            updated_at: new Date()
        });

    } catch (error) {
        console.error('Ошибка асинхронной генерации:', error);
        await db('generation_tasks').where('id', taskId).update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date()
        });
    }
}

app.post('/api/generate-test-cases-async', async (req, res) => {
    try {
        const taskId = uuidv4();

        // ОЧИЩАЕМ КЭШ ПЕРЕД НОВОЙ ГЕНЕРАЦИЕЙ
        console.log(`[generate-test-cases-async] Очищаем кэш перед генерацией taskId: ${taskId}`);
        for (const [key, value] of taskStatusCache.entries()) {
            if (key.includes('status_') || key.includes('model_status_')) {
                taskStatusCache.delete(key);
            }
        }

        await db('generation_tasks').insert({
            id: taskId,
            type: 'test_cases',
            status: 'processing',
            progress: 0,
            input_data: req.body,
            created_at: new Date(),
            updated_at: new Date()
        });

        generateTestCasesAsync(taskId, req.body);

        res.json({ taskId, status: 'started' });
    } catch (error) {
        console.error('Ошибка создания задачи:', error);
        res.status(500).json({ error: error.message });
    }
});

// Простое кэширование статуса задач (5 секунд)
const taskStatusCache = new Map();

app.get('/api/generate-test-cases-status/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const cacheKey = `status_${taskId}`;

        // Проверяем кэш
        const cached = taskStatusCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5000) {
            return res.json(cached.data);
        }

        const task = await db('generation_tasks').where('id', taskId).first();

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const responseData = {
            id: task.id,
            status: task.status,
            progress: task.progress,
            result: task.result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        };

        // Кэшируем результат
        taskStatusCache.set(cacheKey, {
            data: responseData,
            timestamp: Date.now()
        });

        // Очищаем старые записи из кэша (простая очистка)
        if (taskStatusCache.size > 100) {
            const now = Date.now();
            for (const [key, value] of taskStatusCache.entries()) {
                if (now - value.timestamp > 30000) { // 30 секунд
                    taskStatusCache.delete(key);
                }
            }
        }

        res.json(responseData);
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отмена задачи генерации
app.post('/api/cancel-generation/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;

        // Обновляем статус задачи на 'failed' с сообщением об отмене
        await db('generation_tasks')
            .where('id', taskId)
            .update({
                status: 'failed',
                error_message: 'Задача отменена пользователем',
                updated_at: new Date(),
                completed_at: new Date()
            });

        console.log(`Задача ${taskId} отменена пользователем`);
        res.json({ success: true, message: 'Задача отменена' });
    } catch (error) {
        console.error('Ошибка отмены задачи:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

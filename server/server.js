import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import JSON5 from 'json5';
import knex from 'knex';
import { v4 as uuidv4 } from 'uuid';

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
    createTag
} from './http-service.mjs';
import { spinningLoader } from './spinning-loader.mjs';
import pLimit from 'p-limit';
import { formatTestCase } from './format-testcase.mjs';
import { formatTestCaseAsJson } from './generate-json.mjs';
import { staticAnalysis } from './static-analysis.mjs';
import {exportStructureAllure, exportStructureAllureNocode} from './xmind-parce/export-structure-allure.mjs';
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
const PORT = 5000;

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
    origin: 'https://test-inspector.abanking.ru',
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

    // 3) Сортируем по «похожести на наши кейсы»
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
                temperature: 0.4,
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
    const msg = aiResponse?.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (calls.length) {
        const call = preferredFnName
            ? calls.find(c => c.function?.name === preferredFnName) || calls[0]
            : calls[0];
        const args = call.function?.arguments || '{}';
        try {
            return JSON.parse(args);
        } catch (e1) {
            try {
                return JSON5.parse(args);
            } catch (e2) {
                console.warn('[extractToolArgs] Failed to parse tool_call arguments. Falling back to content parser:', e2.message);
                return null;
            }
        }
    }
    if (msg.function_call?.arguments) {
        const raw = msg.function_call.arguments;
        try {
            return JSON.parse(raw);
        } catch (e1) {
            try {
                return JSON5.parse(raw);
            } catch (e2) {
                console.warn('[extractToolArgs] Failed to parse function_call.arguments. Falling back to content parser:', e2.message);
                return null;
            }
        }
    }
    return null;
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
        temperature = 0.25,
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



/**
 * POST /api/generate-test-cases
 * Тело: {
 *   requirements: string[],        // массив текстов требований
 *   modelStructure: object         // дерево вашей тест-модели
 * }
 */
app.post('/api/generate-test-cases', async (req, res) => {
    const {
        requirements,
        modelStructure: rawModel,
        // новые поля для рефайна контекста:
        text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
    } = req.body;
    const modelStructure = normalizeModelStructure(rawModel);

    if ((!Array.isArray(requirements) && typeof requirements !== 'string') || !modelStructure) {
        return res.status(400).json({ error: 'requirements и modelStructure обязательны' });
    }
    // === Соберём автоконтекст по ссылкам основной статьи (если есть pageId) ===
    let refinedReqs;
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
            console.warn('[generate-test-cases] auto-context fetch failed:', e.message);
        }
    }
    try {
        const { refinedArray } = await contextRefiner({
            requirements,
            text: baseRequirement || text,
            glossary,
            context,
            contextInstruction,
            // передадим подготовленные релевантные страницы как contextPages
            contextPages: autoPages
        });
        if (!refinedArray || refinedArray.length === 0) {
            throw new Error('Context refiner вернул пустой массив требований.');
        }
        refinedReqs = refinedArray;
        console.log(`[generate-test-cases] OK: contextRefiner успешно обработал требования. Объем: ${refinedArray.join('\n').length} символов.`);
    } catch (e) {
        console.error('[generate-test-cases] CRITICAL: contextRefiner завершился с ошибкой:', e.message);
        return res.status(500).json({
            error: `Критическая ошибка на этапе подготовки требований (contextRefiner): ${e.message}`
        });
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

    // ====== ВСПОМОГАТЕЛЬНЫЕ ======

    function splitByStories(model) {
        const chunks = [];
        for (const f of (model || [])) {
            for (const st of (f.stories || [])) {
                chunks.push([{ text: f.text, stories: [st] }]);
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

    function countNodes(model) {
        let stories = 0, scenarios = 0, codes = 0;
        for (const f of (model || [])) for (const st of (f.stories || [])) {
            stories++;
            for (const sc of (st.scenarios || [])) {
                scenarios++;
                codes += (sc.codes || []).length;
            }
        }
        return { stories, scenarios, codes };
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
                
                if (tempReq) {
                    currentChunk.push(tempReq.trim());
                }
                currentSize = tempReq.length;
                continue;
            }
            
            // Обычная логика: добавляем в текущий чанк, если помещается
            if (currentSize + reqSize > maxCharsPerChunk && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [req];
                currentSize = reqSize;
            } else {
                currentChunk.push(req);
                currentSize += reqSize;
            }
        }
        
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        
        return chunks.length > 0 ? chunks : [[]];
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
            // КРИТИЧЕСКИ ВАЖНО: Каждая Story ДОЛЖНА иметь минимум 1 E2E тест
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

        // Логирование для отслеживания E2E тестов
        console.log(`[auditCoverage] E2E тесты по историям:`, Object.fromEntries(needE2EByStory));
        console.log(`[auditCoverage] Недостающие E2E тесты:`, missingE2E);
        console.log(`[auditCoverage] Недостающие Integration тесты:`, missingSc);
        console.log(`[auditCoverage] Недостающие Unit тесты:`, missingCd);

        return { missingE2E, missingSc, missingCd };
    }

    // sanitize — берём твой оригинальный без изменений
    const sanitize = (arr) => {
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
        
        const seenTitles = new Set(); // Предотвращаем дубли по названиям
        
        return (arr || [])
            .filter(x => x && typeof x === 'object')
            .map(x => {
                const steps = Array.isArray(x.steps) ? x.steps.map(s => trimText(s, 600)).slice(0, 40) : [];
                const tags = Array.isArray(x.tags) ? Array.from(new Set(x.tags.map(t => String(t).trim()).filter(Boolean))) : [];
                const layer = ALLOWED_LAYERS.has(x.layer) ? x.layer : null;

                const codeRaw = trimText(x.code, 200);
                const code = allowedCodeSet.has(codeRaw) ? codeRaw : undefined;

                return {
                    ...(take(x.feature, 300) ? { feature: take(x.feature, 300) } : {}),
                    ...(take(x.story, 300) ? { story: take(x.story, 300) } : {}),
                    ...(take(x.scenario, 400) ? { scenario: take(x.scenario, 400) } : {}),
                    ...(code ? { code } : {}),
                    title: trimText(x.title, 400),
                    precondition: trimText(x.precondition, 1200),
                    steps,
                    expected: trimText(x.expected, 1200),
                    tags,
                    layer,
                    priority: x.priority && ["Critical", "High", "Medium", "Low"].includes(x.priority) ? x.priority : "Medium",
                    version: trimText(x.version, 80),
                    links: Array.isArray(x.links) ? x.links.slice(0, 20).map(l => ({
                        text: trimText(l.text, 200),
                        url: trimText(l.url, 800),
                        ...(l.type ? { type: trimText(l.type, 40) } : {})
                    })) : [],
                    jiraIssueOption: x.jiraIssueOption && x.jiraIssueOption.value ? {
                        value: String(x.jiraIssueOption.value),
                        integrationId: x.jiraIssueOption.integrationId ? String(x.jiraIssueOption.integrationId) : undefined
                    } : undefined
                };
            })
            .filter(x => {
                // Предотвращаем дубли по названиям
                if (x.title && seenTitles.has(x.title.trim())) {
                    console.log(`[sanitize] Пропускаем дубликат по названию: ${x.title}`);
                    return false;
                }
                if (x.title) seenTitles.add(x.title.trim());
                
                return x.title && x.layer;
            });
    };

    // === Индекс модели и фиксация кейсов по модели ===
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

    function fixAgainstModel(cases, idx) {
        const out = [];
        const seenTitles = new Set(); // Предотвращаем дубли по названиям
        
        for (const tc of (cases || [])) {
            const layer = String(tc.layer || '');

            // Предотвращаем дубли по названиям
            if (tc.title && seenTitles.has(tc.title.trim())) {
                console.log(`[fixAgainstModel] Пропускаем дубликат по названию: ${tc.title}`);
                continue;
            }
            if (tc.title) seenTitles.add(tc.title.trim());

            // ВАЖНО: НЕ отбрасываем кейсы, а ВОССТАНАВЛИВАЕМ структуру из модели
            // E2E: восстанавливаем feature по карте story->feature, но НЕ отбрасываем
            if (layer === 'E2E Tests') {
                if (tc.story && idx.storyToFeature.has(tc.story)) {
                    const feat = idx.storyToFeature.get(tc.story);
                    if (!tc.feature || tc.feature !== feat) tc.feature = feat;
                }
            }

            // Unit: восстанавливаем scenario/story/feature по карте code, но НЕ отбрасываем
            if (layer.startsWith('Unit')) {
                if (tc.code && idx.codeTo.has(tc.code)) {
                    const m = idx.codeTo.get(tc.code);
                    if (!tc.scenario) tc.scenario = m.scenario;
                    if (!tc.story) tc.story = m.story;
                    if (!tc.feature) tc.feature = m.feature;
                }
            }

            // Integration: восстанавливаем story/feature по карте scenario, но НЕ отбрасываем
            if (layer.startsWith('Integration')) {
                if (tc.scenario && idx.scenarioToParent.has(tc.scenario)) {
                    const p = idx.scenarioToParent.get(tc.scenario);
                    if (!tc.story) tc.story = p.story;
                    if (!tc.feature) tc.feature = p.feature;
                }
            }

            // Общая страховка: если есть Story из модели — фича должна быть ровно её родитель
            if (tc.story && idx.storyToFeature.has(tc.story)) {
                const mustFeature = idx.storyToFeature.get(tc.story);
                if (tc.feature !== mustFeature) tc.feature = mustFeature;
            }

            out.push(tc);
        }
        console.log(`[fixAgainstModel] Возвращаем ${out.length} кейсов (было ${cases?.length || 0})`);
        return out;
    }

    // ====== ПРОМПТЫ ======
    const BASE_SYSTEM_PROMPT = `
🚨 КРИТИЧЕСКИ ВАЖНО: НЕ ПРИДУМЫВАЙ НИЧЕГО! 🚨
Ты создаёшь тест-кейсы ТОЛЬКО на основе того, что явно написано в требованиях. 
ЗАПРЕЩЕНО: добавлять шаги, сценарии, ожидаемые результаты или любые детали, которых нет в тексте требований.
ЗАПРЕЩЕНО: додумывать логику, поведение системы или пользовательские действия.
ЗАПРЕЩЕНО: создавать тест-кейсы для сценариев, которые не описаны в требованиях.
ЗАПРЕЩЕНО: использовать слово "Проверка" в названиях тест-кейсов!
Если в требованиях нет явного описания - НЕ СОЗДАВАЙ тест-кейс.

🎯 КАЧЕСТВО ПРЕВЫШЕ КОЛИЧЕСТВА - КРИТИЧЕСКИ ВАЖНО! 🎯
СОЗДАВАЙ МЕНЬШЕ, НО ЛУЧШЕ! Приоритет - полезные и концентрированные тесты.
ПРАВИЛО: 1 тест-кейс = 1 проверка или 1 пользовательский сценарий.
ИСПОЛЬЗУЙ ПАРАМЕТРЫ для граничных значений и вариаций данных.
НЕ ДЕЛАЙ как начинающий тестировщик - не создавай 59 тестов для параметров кредита!
ЛУЧШЕ 10 качественных тестов, чем 50 поверхностных!

Ты — скрупулёзный SDET (Software Development Engineer in Test), создающий атомарные и исчерпывающие тест-кейсы для импорта в Allure. На основе входной тест-модели (modelStructure) и требований сгенерируй JSON-массив тест-кейсов, НЕУКОСНИТЕЛЬНО следуя Style Guide ниже.

Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. Если требования явно описывают поведение клиента, трактуй его для Angular; если описывают серверное поведение/API — трактуй для .NET. Никогда не додумывай детали вне текста.

# 1) Принцип "Один Пример из Требований -> Один Тест-Кейс" (КРАТКО И СТРОГО)
Ты создаёшь тест-кейсы исключительно на основе абсолютно явных и конкретных примеров из текста требований. Никаких домыслов, предположений или недосказанностей в шагах и expected результатах быть не должно.

Алгоритм твоих действий:
1.  Возьми один узел из \`modelStructure\` (например, \`Scenario: "Ввести недопустимое значение..."\`).
2.  Тщательно просканируй ВЕСЬ текст требований и найди ТОЛЬКО те примеры, которые явно и текстуально соответствуют этому узлу.
3.  УМНО КОНСОЛИДИРУЙ похожие примеры в один тест-кейс с параметрами.
4.  Создавай тест-кейсы только для РАЗНЫХ типов проверок, а не для каждого значения.
5.  Все поля \`title\`, \`steps\` и \`expected\` должны содержать лишь ДОСЛОВНЫЕ данные или тексты, встречающиеся в требованиях. Запрещено добавлять или интерпретировать дополнительную информацию.
6.  Если для узла отсутствуют явные примеры в требованиях — не создавай тест-кейса вовсе.
7.  При сложной логике описывай ожидаемый результат ровно так, как он изложен в соответствующем примере, ни больше, ни меньше.

# 1.1) КОНСОЛИДАЦИЯ ТЕСТ-КЕЙСОВ - КРИТИЧЕСКИ ВАЖНО! 🎯
ЗАПРЕЩЕНО создавать множественные тест-кейсы для одного функционала!
ПРАВИЛО: 1 тест-кейс = 1 проверка или 1 пользовательский сценарий.

КОНСОЛИДАЦИЯ ПО ОЖИДАЕМОМУ РЕЗУЛЬТАТУ:
- Если у нескольких примеров ОДИНАКОВЫЙ ожидаемый результат - ОБЪЕДИНИ в один тест-кейс с параметрами
- НЕ создавай отдельные тест-кейсы для "11 месяцев", "12 месяцев", "84 месяца" - это ОДИН тест с параметрами
- НЕ создавай отдельные тест-кейсы для "Физическое лицо" и "Юридическое лицо" - это ОДИН тест с параметрами

ПАРАМЕТРИЗАЦИЯ ГРАНИЧНЫХ ЗНАЧЕНИЙ:
- Для граничных значений (минимум, максимум, валидные диапазоны) используй ОДИН тест-кейс с параметрами
- НЕ создавай 59 тестов для параметров кредита - создай 3-5 тестов с параметрами
- Пример: "Ввод срока кредита" с параметрами: [11, 12, 84, 85] месяцев

ПРЕДОТВРАЩЕНИЕ ДУБЛИРОВАНИЯ:
- НЕ создавай тест-кейсы с одинаковыми названиями
- НЕ создавай тест-кейсы с одинаковыми шагами
- НЕ создавай тест-кейсы с одинаковыми ожидаемыми результатами
- Если видишь дублирование - ОБЪЕДИНИ в один тест-кейс

ОБЯЗАТЕЛЬНЫЕ ШАГИ:
- КАЖДЫЙ тест-кейс ДОЛЖЕН содержать минимум 1 шаг
- НЕ создавай тест-кейсы без шагов
- Шаги должны быть конкретными и выполнимыми

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
3) Integration (C2–C3) — взаимодействия компонент/эндпоинтов:
   • В рамках одного компонента (FE) или одного API-вызова (BE), без навигации по страницам.
   • Основная работа: классы эквивалентности, граничные значения (BVA), контракты API.
4) Unit (C4) — одна функция/метод, строгий AAA (Arrange-Act-Assert).

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
Примеры наборов тегов:
• FE E2E/Integration (десктоп): ["D"]  
• BE Integration: ["S"] или ["D","S"] если тест затрагивает интерфейсно-зависимые артефакты  

# 5) Выходной формат: СТРОГО ТОЛЬКО JSON-массив
Используй ровно один из трёх шаблонов ниже в зависимости от "layer". Никаких комментариев/markdown.

## Шаблон: "layer": "E2E Tests"
{
  "feature": "ОБЯЗАТЕЛЬНО: Название фичи из модели",
  "story": "ОБЯЗАТЕЛЬНО: Название истории из модели",
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
  "feature": "ОБЯЗАТЕЛЬНО: Название фичи из модели",
  "story": "ОБЯЗАТЕЛЬНО: Название истории из модели",
  "scenario": "ОБЯЗАТЕЛЬНО: ТОЧНОЕ название сценария из модели",
  "title": "Конкретное действие (например, 'Валидация поля «Имя» при вводе более 100 символов')",
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
  "tags": ["Unit", "‹по матрице тегов›"],
  "layer": "Unit frontend Tests",
  "priority": "‹по матрице риска›"
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
• "links": [{ "text": "...", "url": "..." }], • "jiraIssue": "ABC-123", • "version": "stable" (по умолчанию для новых), • "attachments": [...], • "parameters": "..." (использовать только если во входе явно заданы параметры; для DDT/Pairwise — но не выдумывать).

# 6) Правила генерации набора тест-кейсов
Для КАЖДОЙ Story: 
— 1–2 E2E-теста: Happy Path и (при необходимости) один ключевой Negative Path на уровне потока.

Для КАЖДОГО Scenario:
— 3–5 Integration-тестов (главный объём): позитивные/негативные случаи, BVA, классы эквивалентности, контракты API.  
— Поле "scenario" должно 1:1 совпадать с текстом узла.

Для КАЖДОГО Code:
— 2–4 Unit-теста по AAA (описательно).  
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

# 8) Чек-лист перед выводом
— Все кейсы независимы; по одному «смыслу» на кейс.  
— В E2E есть «Авторизоваться…» и «Перейти на страницу…».  
— Детальные проверки (валидации полей и т.п.) не просочились в E2E.  
— "scenario" (для Integration/Unit) совпадает с моделью.  
— Теги проставлены по правилам: D/A/M/PWA; "S" для бэкенда; номер требования — только если есть во входе.  
— "version" = "stable" для новых кейсов (если не указано иное).

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ КАСТОМНЫХ ПОЛЕЙ! 🚨
— ДЛЯ ВСЕХ ТЕСТОВ: "feature" ОБЯЗАТЕЛЬНО!
— E2E Tests: ОБЯЗАТЕЛЬНО "feature" + "story"
— Integration Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario"  
— Unit Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario" + "code"
— НЕ ОСТАВЛЯЙ пустых кастомных полей - это критично для структуры!

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ НАЗВАНИЙ ТЕСТ-КЕЙСОВ! 🚨
— ЗАПРЕЩЕНО использовать слово "Проверка" в названиях!
— Используй глаголы действия: "Валидация", "Создание", "Удаление", "Отображение"
— Примеры ХОРОШИХ названий: "Валидация поля при вводе неверных данных", "Создание заявки с корректными данными"
— Примеры ПЛОХИХ названий: "Проверка валидации поля", "Проверка создания заявки"  

# 9) Формат ответа
Выведи СТРОГО один JSON-массив кейсов без каких-либо комментариев, текста или Markdown.`;

    const { stories: S, scenarios: Sc, codes: C } = countNodes(modelStructure);
    const COVENANT = `
# 6.1 Ковенанта покрытия (строго)
В модели: Stories=${S}, Scenarios=${Sc}, Codes=${C}.
Минимум по всей модели: E2E ≥ ${Math.max(1, S)}, Integration ≥ ${Sc * 3}, Unit ≥ ${C * 2}.
Если объём большой, сокращай формулировки, но НЕ снижай счётчики.
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
                                }
                            },
                            required: ["title", "layer"]
                        }
                    }
                },
                required: ["cases"],
                additionalProperties: false
            }
        }
    });

    // Генерация для одного чанка (одной Story)
    async function genForChunk(modelChunk, reqs, systemPrompt) {
        const allowedForChunk = collectAllowedCodes(modelChunk);
        const allowedScenarios = collectAllowedScenarios(modelChunk);
        const { scenarios: scCnt, codes: cdCnt } = countChunkNodes(modelChunk);

        // Обрежем "Контекст из ссылок" до безопасного размера
        const linkCtxRaw = Array.isArray(req._autoExtractedContextPages) && req._autoExtractedContextPages.length
            ? req._autoExtractedContextPages.join('\n\n---\n\n')
            : '';
        const sanitizeLinkCtx = (s) => String(s || '')
            .replace(/```[\s\S]*?```/g, '')            // убрать большие код-блоки
            .replace(/^#\s.*$/gm, '')                  // убрать H1
            .replace(/^##\s.*$/gm, '###')              // H2 → H3 (компактнее)
            .replace(/\n{3,}/g, '\n\n');
        let linkCtx = sanitizeLinkCtx(linkCtxRaw);
        const MAX_LINK_CTX = 12000; // ~12k символов на Story
        if (linkCtx.length > MAX_LINK_CTX) linkCtx = linkCtx.slice(0, MAX_LINK_CTX);

        const userPrompt = `
Сгенерируй JSON-массив тест-кейсов на русском языке для ЭТОГО куска модели (одна Story).
Модель (кусок):
${JSON.stringify(modelChunk, null, 2)}

Требования:
${reqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Контекст из ссылок исходного требования (используй только для прояснения ссылок; не придумывай новое):
${linkCtx || '—'}

ДОПУСТИМЫЕ ЗНАЧЕНИЯ ДЛЯ "code" (если используешь):
${allowedForChunk.map(c => `- ${c}`).join('\n')}

⚠️ Минимум для ЭТОГО куска:
— E2E: ≥ 1 на Story (не более 3),
— Integration: ≥ ${Math.max(0, scCnt * 3)} (по 3-5 на каждый Scenario),
— Unit: ≥ ${Math.max(0, cdCnt * 2)} (по 2 на каждый Code из списка выше).
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
                tool_choice: { type: 'function', function: { name: 'submit_cases' } },
                // models НЕ передаём - будут использованы config.cloudruModels для Cloud.ru и config.fallbackModels для OpenRouter
                temperature: 0,
                top_p: 1,
                max_tokens: 32000,
                extra: { transforms: 'middle-out' }
            }
        );

        // УЛУЧШЕННЫЙ ПАРСЕР ДЛЯ GAPFILL
        let args = extractToolArgs(ai, "submit_cases");
        if (args && Array.isArray(args.cases) && args.cases.length) {
            console.log(`[gapFill] OK: Получено ${args.cases.length} кейсов через tool_call.`);
            return args.cases;
        }

        console.warn(`[gapFill] WARN: tool_call не найден. Попытка парсинга из content.`);
        const content = ai.choices?.[0]?.message?.content || '';
        if (!content.trim()) {
            console.error('[gapFill] CRITICAL: Ответ модели полностью пуст.');
            return [];
        }

        try {
            const rawJsonCandidate = extractJsonArray(content);
            if (!rawJsonCandidate) {
                console.error('[gapFill] CRITICAL: Не удалось извлечь JSON-массив из content.');
                console.log('--- RAW AI RESPONSE (gapFill failed to parse) ---\n', content, '\n------------------------------------');
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
                                max_tokens: 32000
                            }
                        );
                        const a2 = extractToolArgs(retry, 'submit_cases');
                        if (a2 && Array.isArray(a2.cases) && a2.cases.length) return a2.cases;
                    } catch { }
                }
                console.log(`[gapFill] OK: Получено ${result.length} кейсов через фолбэк-парсер.`);
                return result;
            } catch (e1) {
                console.warn('[gapFill] JSON parse failed. Fallback. Error:', e1.message);
                const t = cleanupJsonText(rawJsonCandidate);
                const parsed = JSON5.parse(t);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (parseError) {
            console.error('[gapFill] CRITICAL: Ошибка JSON5.parse при фолбэке:', parseError.message);
            console.log('--- RAW AI RESPONSE (gapFill JSON5 parse failed) ---\n', content, '\n-----------------------------------------');
            return [];
        }


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

        // === ЧАНКОВАНИЕ ТРЕБОВАНИЙ для gapFill ===
        const reqsSize = reqs.join('').length;
        // Для gapFill используем меньший размер чанка, т.к. модель уже есть в промпте
        const reqsChunks = reqsSize > 100000 ? splitRequirements(reqs, 100000) : [reqs];
        
        if (reqsChunks.length > 1) {
            console.log(`[gapFill] CHUNKING: Требования разбиты на ${reqsChunks.length} чанков (общий размер: ${reqsSize} символов)`);
        }

        const allGapCases = [];
        
        for (let i = 0; i < reqsChunks.length; i++) {
            const reqsChunk = reqsChunks[i];
            
            if (reqsChunks.length > 1) {
                console.log(`[gapFill] Обработка чанка требований ${i + 1}/${reqsChunks.length}...`);
            }

        const userPrompt = `
Сгенерируй ТОЛЬКО недостающее покрытие для следующего куска модели.
Модель (кусок):
${JSON.stringify(chunk, null, 2)}

Нужно добрать:
${mustLines.map(l => `- ${l}`).join('\n')}

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ E2E ТЕСТОВ! 🚨
- КАЖДАЯ Story ДОЛЖНА иметь минимум 1 E2E тест-кейс
- E2E тесты должны быть сквозными пользовательскими сценариями
- E2E тесты должны начинаться с авторизации/навигации
- E2E тесты должны проверять целостный бизнес-процесс
- НЕ создавай E2E тесты для детальных проверок полей - это для Integration

Требования${reqsChunks.length > 1 ? ` (часть ${i + 1}/${reqsChunks.length})` : ''}:
${reqsChunk.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}

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
                tool_choice: { type: "function", function: { name: "submit_cases" } },
                    // models НЕ передаём - будут использованы значения по умолчанию
                temperature: 0,
                top_p: 1,
                    max_tokens: 32000,
                extra: { transforms: 'middle-out' }
            }
        );

        const args = extractToolArgs(ai, "submit_cases");
            if (args && Array.isArray(args.cases)) {
                allGapCases.push(...args.cases);
                continue;
            }

        const content = ai.choices?.[0]?.message?.content || '';
        const rawJsonCandidate = extractJsonArray(content);
            if (!rawJsonCandidate) continue;
            
        try {
            const jsonText = cleanupJsonText(rawJsonCandidate);
            const parsed = JSON5.parse(jsonText);
                if (Array.isArray(parsed)) allGapCases.push(...parsed);
        } catch (e) {
                console.warn(`[gapFill] JSON parse failed (chunk ${i + 1}/${reqsChunks.length}). Falling back. Error:`, e.message);
            try {
                const t = cleanupJsonText(rawJsonCandidate);
                const parsed = JSON5.parse(t);
                    if (Array.isArray(parsed)) allGapCases.push(...parsed);
            } catch (e2) {
                    console.error(`[gapFill] Fallback parse failed (chunk ${i + 1}):`, e2.message);
                    console.log('--- RAW AI RESPONSE (gapFill fail) ---\n', content, '\n-----------------------------------------');
            }
        }
        }
        
        return allGapCases;
    }

    try {
        // Разбиваем на story-чанки
        const storyChunks = splitByStories(modelStructure);

        // Параллелим Stories для ускорения (Cloud.ru выдерживает несколько одновременных запросов)
        const genLimit = pLimit(4);

        // === ЧАНКОВАНИЕ ТРЕБОВАНИЙ для больших документов ===
        const reqsChunks = splitRequirements(refinedReqs, 45000);
        const totalReqsSize = refinedReqs.join('').length;
        
        console.log(`[generate-test-cases] Требования: ${totalReqsSize} символов → ${reqsChunks.length} чанков, Stories: ${storyChunks.length}`);
        if (reqsChunks.length > 1) {
            reqsChunks.forEach((chunk, i) => {
                const chunkSize = chunk.join('').length;
                console.log(`  Чанк ${i + 1}/${reqsChunks.length}: ${chunkSize} символов, ${chunk.length} требований`);
            });
        }
        console.log(`[generate-test-cases] Генерация: ${reqsChunks.length} чанков × ${storyChunks.length} Stories (параллельно по 4 Stories)...`);

        // Генерация по кускам с таймаутами
        const parts = [];
        const TIMEOUT_MS = 1500000; // 25 минут для надёжности на больших чанк‑запросах
        
        // Для каждого чанка требований генерируем кейсы для всех Stories (параллельно по 2)
        for (let reqIdx = 0; reqIdx < reqsChunks.length; reqIdx++) {
            const reqsChunk = reqsChunks[reqIdx];
            
            if (reqsChunks.length > 1) {
                console.log(`[generate-test-cases] Обработка чанка требований ${reqIdx + 1}/${reqsChunks.length}...`);
            }
            
            // Параллельно обрабатываем Stories для этого чанка требований
            const promises = storyChunks.map((chunk, storyIdx) => 
                genLimit(async () => {
                    const storyName = chunk[0]?.stories[0]?.text || 'N/A';
                    console.log(`[generate-test-cases] Чанк ${reqIdx + 1}/${reqsChunks.length} → Story ${storyIdx + 1}/${storyChunks.length}: ${storyName}`);
                    return await withTimeout(
                        genForChunk(chunk, reqsChunk, BASE_SYSTEM_PROMPT),
                        TIMEOUT_MS,
                        `genForChunk (reqChunk: ${reqIdx + 1}/${reqsChunks.length}, story: ${storyName})`
                    );
                })
            );
            
            const results = await Promise.all(promises);
            parts.push(...results);
        }

        let allCases = parts.flat();

        // === sanitize → fixAgainstModel до аудита покрытия ===
        const idx = buildModelIndex(modelStructure);
        allCases = sanitize(allCases);
        allCases = fixAgainstModel(allCases, idx);

        // Если в модели всего одна Feature — принудительно выставим её всем кейсам
        const uniqueFeatures = [...new Set((modelStructure || []).map(f => f?.text?.trim()).filter(Boolean))];
        if (uniqueFeatures.length === 1) {
            const theOnlyFeature = uniqueFeatures[0];
            allCases = allCases.map(tc => ({ ...tc, feature: theOnlyFeature }));
        }
        console.log('Требования для тест кейсов')
        console.log(refinedReqs)
        // Аудит покрытия и догенерация недостающего
        const missing = auditCoverage(modelStructure, allCases);
        if (missing.missingE2E.length || missing.missingSc.length || missing.missingCd.length) {
            console.log(`[COVERAGE] Обнаружен недостаток покрытия. Запускаю догенерацию (gapFill)...`);
            const promise = genLimit(() => gapFill(modelStructure, refinedReqs, missing, BASE_SYSTEM_PROMPT));
            let extra = await withTimeout(promise, TIMEOUT_MS, 'gapFill');
            extra = sanitize(extra);
            extra = fixAgainstModel(extra, idx);
            console.log(`[COVERAGE] Догенерировано ${extra.length} кейсов.`);
            allCases = allCases.concat(extra);
        } else {
            console.log('[COVERAGE] Покрытие полное, догенерация не требуется.');
        }


        return res.json({ cases: allCases });

    } catch (err) {
        // ВАЖНО: если OpenRouter вернул 429 — отдадим 429, чтобы фронт знал, когда ретраить
        if (err && (err.code === 429 || /rate.?limit/i.test(err.message))) {
            const s = Number(err.waitSeconds) || 60;
            return res.status(429).json({
                error: 'Лимит скорости модели. Повторите запрос через 1 минуту.',
                waitSeconds: s
            });
        }
        console.error('Ошибка в /api/generate-test-cases (chunked):', err);
        return res.status(500).json({ error: err.message });
    }
});

const transformToHierarchy = (flatList) => {
    // Используем Map для группировки по имени фичи, чтобы избежать дубликатов
    const featuresMap = new Map();

    flatList.forEach(item => {
        const { Feature: featureName, Story: storyName, Scenario: scenarioTexts } = item;

        if (!featureName || !storyName || !Array.isArray(scenarioTexts)) {
            // Пропускаем некорректные элементы от AI
            return;
        }

        // 1. Получаем или создаем узел фичи (Feature)
        if (!featuresMap.has(featureName)) {
            featuresMap.set(featureName, {
                text: featureName, // Используем 'text' для совместимости с фронтендом
                stories: [],
            });
        }
        const featureNode = featuresMap.get(featureName);

        // 2. Ищем или создаем узел истории (Story) внутри фичи
        let storyNode = featureNode.stories.find(s => s.text === storyName);
        if (!storyNode) {
            storyNode = {
                text: storyName, // Используем 'text'
                scenarios: [],   // Используем 'scenarios' во множественном числе
            };
            featureNode.stories.push(storyNode);
        }

        // 3. Преобразуем массив строк-сценариев в массив объектов
        const scenarioNodes = scenarioTexts.map(text => ({
            text: text // Каждый сценарий - это объект с полем 'text'
        }));

        // 4. Добавляем новые сценарии к истории
        storyNode.scenarios.push(...scenarioNodes);
    });

    // Возвращаем сгруппированные данные в виде массива
    return Array.from(featuresMap.values());
};

app.post('/api/generate-test-model', async (req, res) => {
    const {
        requirements,     
        text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
    } = req.body;
    if (!requirements && !text && !pageId) {
        return res.status(400).json({ error: 'Нужно передать requirements (строка/массив), либо text, либо pageId' });
    }

    // 0) Если pageId передан — подтягиваем основную страницу и прямые ссылки (как в /analyze/solution)
    let autoPages = [];
    let baseRequirement = '';
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
                    // Вставим цитату упоминания из основной статьи, чтобы сохранить связь
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
            console.warn('[generate-test-model] auto-context fetch failed:', e.message);
        }
    }

    // Приводим к строке требований, предварительно прогнав через contextRefiner (с авто-контекстом)
    let reqStringForModel = '';
    try {
        const { refinedText, refinedArray } = await contextRefiner({
            requirements: Array.isArray(requirements) ? requirements : (requirements ? [requirements] : undefined),
            text: baseRequirement || text,
            glossary,
            context,
            contextInstruction,
            // передаём собранные страницы как "contextPages"
            contextPageIds: undefined,
            glossaryPageId: undefined,
            bearerToken: undefined,
            contextPages: autoPages
        });
        reqStringForModel = refinedText || (refinedArray?.join('\n\n') ?? '');
    } catch (e) {
        console.warn('[generate-test-model] contextRefiner warning:', e.message);
        reqStringForModel = baseRequirement || (typeof requirements === 'string' ? requirements : (Array.isArray(requirements) ? requirements.join('\n\n') : (text || '')));
    }

    console.log('Требования для тест модели')
    console.log(`Размер требований: ${reqStringForModel.length} символов`)
    
    // === ФУНКЦИЯ ЧАНКОВАНИЯ БОЛЬШИХ ТРЕБОВАНИЙ ===
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
    
    // === ФУНКЦИЯ ОБЪЕДИНЕНИЯ МОДЕЛЕЙ ===
    function mergeTestModels(models) {
        if (!models || models.length === 0) return [];
        if (models.length === 1) return models[0];
        
        const featureMap = new Map();
        
        for (const model of models) {
            if (!Array.isArray(model)) continue;
            
            for (const feature of model) {
                if (!feature?.text) continue;
                
                const fKey = feature.text.toLowerCase().trim();
                
                if (!featureMap.has(fKey)) {
                    featureMap.set(fKey, {
                        text: feature.text,
                        stories: []
                    });
                }
                
                const existingFeature = featureMap.get(fKey);
                const storyMap = new Map();
                
                // Собираем существующие stories
                for (const story of (existingFeature.stories || [])) {
                    if (story?.text) {
                        storyMap.set(story.text.toLowerCase().trim(), story);
                    }
                }
                
                // Добавляем/мерджим новые stories
                for (const story of (feature.stories || [])) {
                    if (!story?.text) continue;
                    
                    const sKey = story.text.toLowerCase().trim();
                    
                    if (!storyMap.has(sKey)) {
                        storyMap.set(sKey, {
                            text: story.text,
                            scenarios: story.scenarios || []
                        });
                    } else {
                        // Мерджим scenarios
                        const existingStory = storyMap.get(sKey);
                        const scenarioMap = new Map();
                        
                        for (const sc of (existingStory.scenarios || [])) {
                            if (sc?.text) {
                                scenarioMap.set(sc.text.toLowerCase().trim(), sc);
                            }
                        }
                        
                        for (const sc of (story.scenarios || [])) {
                            if (!sc?.text) continue;
                            
                            const scKey = sc.text.toLowerCase().trim();
                            
                            if (!scenarioMap.has(scKey)) {
                                scenarioMap.set(scKey, {
                                    text: sc.text,
                                    codes: sc.codes || []
                                });
                            } else {
                                // Мерджим codes
                                const existingScenario = scenarioMap.get(scKey);
                                const codeMap = new Map();
                                
                                for (const code of (existingScenario.codes || [])) {
                                    if (code?.text) {
                                        codeMap.set(code.text.toLowerCase().trim(), code);
                                    }
                                }
                                
                                for (const code of (sc.codes || [])) {
                                    if (code?.text) {
                                        const cKey = code.text.toLowerCase().trim();
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
    
    const SYSTEM_PROMPT = `
🚨 КРИТИЧЕСКИ ВАЖНО: НЕ ПРИДУМЫВАЙ НИЧЕГО! 🚨
Ты создаёшь тестовую модель ТОЛЬКО на основе того, что явно написано в требованиях.
ЗАПРЕЩЕНО: добавлять сценарии, действия, реакции или любые элементы, которых нет в тексте требований.
ЗАПРЕЩЕНО: додумывать пользовательские потоки, бизнес-логику или поведение системы.
ЗАПРЕЩЕНО: создавать элементы модели для функциональности, которая не описана в требованиях.
Если в требованиях нет явного описания - НЕ СОЗДАВАЙ соответствующий элемент модели.

Ты — выдающийся QA-архитектор с исключительным талантом к синтезу и декомпозиции. Твоя главная сила — видеть за разрозненными требованиями целостную картину и ценность для пользователя.

## 1. Цель
Создать иерархическую тестовую модель (Feature → Story → Scenario → Code) на основе предоставленных требований.

Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. Если требование явно про UI — интерпретируй как Angular; если про API/сервер — как .NET. Ничего не выдумывай сверх текста.

## 2. Ключевой принцип декомпозиции (САМОЕ ВАЖНОЕ!)
- **Сначала Синтез, потом Анализ.** Прочитай ВСЕ требования. Твоя первая задача — определить 1-3 **высокоуровневых пользовательских потока (Story)**, которые приносят конечную ценность.
## 2.1 Строгий запрет на домыслы и выдумки (Новый пункт)
- Если в требованиях **нет явного и однозначного описания** пользовательского сценария, действия или реакции — **не создавай** соответствующий элемент модели.
- Ни при каких обстоятельствах **не добавляй** гипотезы, догадки, предполагаемые сценарии или реакции, которых нет в требованиях.
- Лучше пропустить неопределённые или недостаточно описанные части, чем создавать искусственные данные.
- Модель должна отражать ТОЛЬКО то, что есть в требованиях, без предположений и дописок.


## 3. Структура дерева (строго соблюдать)
- **Feature (Фича):** Большой независимый блок продукта.
- **Story (C1-E2E):** **Целостный пользовательский сценарий, приносящий ценность.**
- **Scenario (C2–C3-Integration):** **Атомарное ДЕЙСТВИЕ пользователя** внутри Story, формулируется инфинитивом.
- **Code (C4-Unit):** **РЕАКЦИЯ системы** на действие пользователя, описываемое инфинитивом. **Не использовать** слово «Проверка».

## 3.1. Правила Детализации (ПРИОРИТЕТ!)
- **Если в требованиях есть раздел "Пользовательские сценарии" (или похожий по смыслу), используй его как главный источник для декомпозиции.**
- **Каждый пронумерованный шаг пользователя из этих сценариев должен стать отдельным \`Scenario\` в тестовой модели.**
- **Описание реакции системы на действие пользователя — это \`Code\` внутри этого \`Scenario\`.**

## 3.2. Принцип Абстракции Данных и Реализации (ВЫСШИЙ ПРИОРИТЕТ!)
- **Не вставляй конкретные данные из примеров** (значения, названия, тексты ошибок) в итоговую модель.
- **Не вставляй детали технической реализации.**
- Твоя задача — распознать КОНКРЕТНЫЕ ПРИМЕРЫ в требованиях, но в итоговой модели заменить их на **АБСТРАКТНЫЕ ОПИСАНИЯ ДЕЙСТВИЙ И РЕАКЦИЙ.**
- Сосредоточься на связке **"действие пользователя (Scenario) -> видимая реакция системы (Code)"**. Модель должна быть независима от конкретной технологии.

## 3.3. При недостатке информации — минимализм
- Если информации в требованиях недостаточно для создания подробного сценария, создай максимально общий и абстрактный элемент.
- Не расширяй модель за счёт непроверенных деталей.
- Предпочти короче и точнее, чем длиннее и с выдумками.

- **Примеры абстракции данных:**
  - НЕПРАВИЛЬНО: "Выбрать программу '27 LADA FREE'"
  - **ПРАВИЛЬНО:** "Выбрать значение, соответствующее условию зависимости"

- **Примеры абстракции реализации:**
  - НЕПРАВИЛЬНО (деталь): \`Scenario: "Отправить GET-запрос на /api/users"\`
  - **ПРАВИЛЬНО (действие):** \`Scenario: "Запросить список пользователей"\`
  
  - НЕПРАВИЛЬНО (деталь): \`Code: "Загрузить данные из кэша"\`
  - **ПРАВИЛЬНО (реакция):** \`Code: "Отобразить список пользователей"\`

## 4. Формат вывода (обязательно)
Выход — **ТОЛЬКО** чистый JSON-массив без комментариев и markdown.
\`\`\`json
[
  {
    "text": "Название Feature",
    "stories": [
      {
        "text": "Название Story",
        "scenarios": [
          {
            "text": "Первый Scenario",
            "codes": [
              { "text": "Первое системное действие" }
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
Основываясь на **принципах декомпозиции (п.2), детализации (п.3.1) и абстракции (п.3.2)**, проанализируй требования и сгенерируй тестовую модель в формате JSON. Ответ — **только** чистый JSON. Обязательно тестовая модель только на русском языке.

СТРОГОЕ ПРАВИЛО ДЛЯ HTTP-ЭНДПОИНТОВ: узлы \`Code\`, описывающие HTTP‑запросы (GET|POST|PUT|PATCH|DELETE "/..."), добавляй ТОЛЬКО если метод и путь явно указаны в тексте требований. Если в требованиях нет однозначного упоминания такого запроса — не добавляй его и не придумывай.
`.trim();

    try {
        // === ЧАНКОВАНИЕ БОЛЬШИХ ТРЕБОВАНИЙ ===
        const reqChunks = chunkTextBySize(reqStringForModel, 80000);
        const totalSize = reqStringForModel.length;
        
        if (reqChunks.length > 1) {
            console.log(`[generate-test-model] CHUNKING: Требования разбиты на ${reqChunks.length} чанков (общий размер: ${totalSize} символов)`);
            reqChunks.forEach((chunk, i) => {
                const preview = chunk.substring(0, 200).replace(/\n/g, ' ').trim();
                const endPreview = chunk.substring(Math.max(0, chunk.length - 100)).replace(/\n/g, ' ').trim();
                console.log(`  Чанк ${i + 1}/${reqChunks.length}: ${chunk.length} символов`);
                console.log(`    Начало: "${preview}..."`);
                console.log(`    Конец: "...${endPreview}"`);
            });
        }
        
        const partialModels = [];
        
        // === ГЕНЕРАЦИЯ ДЛЯ КАЖДОГО ЧАНКА ===
        for (let chunkIdx = 0; chunkIdx < reqChunks.length; chunkIdx++) {
            const reqChunk = reqChunks[chunkIdx];
            
            if (reqChunks.length > 1) {
                console.log(`[generate-test-model] Обработка чанка ${chunkIdx + 1}/${reqChunks.length}...`);
            }
            
            // Модифицируем промпт для чанков
            let userPrompt = reqChunk;
            if (reqChunks.length > 1) {
                userPrompt = `ВНИМАНИЕ: Это часть ${chunkIdx + 1} из ${reqChunks.length} от общего документа требований.

КРИТИЧЕСКИ ВАЖНО ДЛЯ БОЛЬШИХ ДОКУМЕНТОВ:
- Создай тестовую модель для этой части, ДАЖЕ ЕСЛИ информация кажется неполной
- Если видишь заголовки и описания действий пользователя, но НЕ видишь реакций системы → создай Scenarios с пустым массивом codes (они могут быть в другом чанке)
- Если видишь описания реакций системы, но контекст неясен → создай Codes в том разделе, который есть
- Если раздел начинается или заканчивается обрывочно → всё равно создай элементы с той информацией, которая доступна
- Итоговые модели из всех чанков будут АВТОМАТИЧЕСКИ объединены по названиям Feature/Story/Scenario/Code

При объединении системa соединит:
- Scenarios с одинаковыми названиями из разных чанков
- Codes будут добавлены к соответствующим Scenarios
- Дубликаты будут удалены

НЕ ПРОПУСКАЙ разделы из-за неполноты информации - лучше создать неполную структуру, чем пропустить.

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
                tool_choice: { type: "function", function: { name: "submit_test_model" } },
                temperature: 0.25,
                top_p: 0.9,
                max_tokens: 8192,
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
                    console.warn(`[generate-test-model] Чанк ${chunkIdx + 1}: AI не вернул результата`);
                    continue;
                }

            const firstBracket = content.indexOf('[');
            const lastBracket = content.lastIndexOf(']');
                if (firstBracket === -1 || lastBracket === -1) {
                    console.warn(`[generate-test-model] Чанк ${chunkIdx + 1}: Не найден JSON-массив`);
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
                    console.warn(`[generate-test-model] Чанк ${chunkIdx + 1}: Ошибка парсинга JSON:`, parseErr.message);
                    continue;
                }
            }
            
            if (partialModel && Array.isArray(partialModel) && partialModel.length > 0) {
                partialModels.push(partialModel);
                
                // Подробная статистика по чанку
                let totalStories = 0, totalScenarios = 0, totalCodes = 0;
                let scenariosWithoutCodes = 0;
                
                for (const feature of partialModel) {
                    console.log(`[generate-test-model] Чанк ${chunkIdx + 1}: Feature "${feature.text}"`);
                    for (const story of (feature.stories || [])) {
                        totalStories++;
                        console.log(`    Story: "${story.text}"`);
                        for (const scenario of (story.scenarios || [])) {
                            totalScenarios++;
                            const codesCount = (scenario.codes || []).length;
                            totalCodes += codesCount;
                            if (codesCount === 0) {
                                scenariosWithoutCodes++;
                                console.log(`      ⚠️ Scenario БЕЗ codes: "${scenario.text}"`);
                            } else {
                                console.log(`      ✓ Scenario с ${codesCount} codes: "${scenario.text}"`);
                            }
                        }
                    }
                }
                
                console.log(`[generate-test-model] Чанк ${chunkIdx + 1}/${reqChunks.length} СТАТИСТИКА: Features: ${partialModel.length}, Stories: ${totalStories}, Scenarios: ${totalScenarios} (БЕЗ codes: ${scenariosWithoutCodes}), Codes: ${totalCodes}`);
            }
        }
        
        // === ОБЪЕДИНЕНИЕ ВСЕХ ЧАСТИЧНЫХ МОДЕЛЕЙ ===
        if (partialModels.length === 0) {
            throw new Error('Не удалось сгенерировать тестовую модель ни из одного чанка');
        }
        
        let mergedModel = partialModels.length === 1 
            ? partialModels[0] 
            : mergeTestModels(partialModels);
        
        if (partialModels.length > 1) {
            const totalFeatures = mergedModel.length;
            const totalStories = mergedModel.reduce((sum, f) => sum + (f.stories?.length || 0), 0);
            const totalScenarios = mergedModel.reduce((sum, f) => 
                sum + (f.stories || []).reduce((s, st) => s + (st.scenarios?.length || 0), 0), 0);
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
                            console.warn(`⚠️ [generate-test-model] ПОСЛЕ СЛИЯНИЯ: Scenario БЕЗ codes в "${feature.text}" → "${story.text}" → "${scenario.text}"`);
                        }
                    }
                }
            }
            
            console.log(`[generate-test-model] MERGED: ${partialModels.length} чанков → ${totalFeatures} Features, ${totalStories} Stories, ${totalScenarios} Scenarios (БЕЗ codes: ${scenariosWithoutCodesAfterMerge}), ${totalCodes} Codes`);
        }

        const finalModel = normalizeModelStructure(mergedModel);
        // Упростили: доверяем модели, правило прописано в промпте. Возвращаем как есть.
        return res.status(200).json(finalModel);
    } catch (err) {
        console.error('ГЛОБАЛЬНАЯ ОШИБКА в /api/generate-test-model:', err);
        if (err.code === 429 || err.message === 'RATE_LIMIT') {
            const s = Number(err.waitSeconds) || 60;
            // округлим до минут, но не потеряем секунды если мало
            const msg = s >= 60
                ? `Пожалуйста, подождите ${Math.ceil(s / 60)} мин и повторите запрос.`
                : `Пожалуйста, подождите ${s} сек и повторите запрос.`;

            return res.status(429).json({ error: msg, waitSeconds: s });
        }
        return res.status(500).json({ error: err.message });
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
                console.warn('[generate-test-model-async] auto-context fetch failed:', e.message);
            }
        }

        // Приводим к строке требований, предварительно прогнав через contextRefiner
        let reqStringForModel = '';
        try {
            const { refinedText, refinedArray } = await contextRefiner({
                requirements: Array.isArray(requirements) ? requirements : (requirements ? [requirements] : undefined),
                text: baseRequirement || text,
                glossary,
                context,
                contextInstruction,
                contextPageIds: undefined,
                glossaryPageId: undefined,
                bearerToken: undefined,
                contextPages: autoPages
            });
            reqStringForModel = refinedText || (refinedArray?.join('\n\n') ?? '');
        } catch (e) {
            console.warn('[generate-test-model-async] contextRefiner warning:', e.message);
            reqStringForModel = baseRequirement || (typeof requirements === 'string' ? requirements : (Array.isArray(requirements) ? requirements.join('\n\n') : (text || '')));
        }

        console.log('[generate-test-model-async] Требования для тест модели');
        console.log('[generate-test-model-async] Размер требований:', reqStringForModel.length, 'символов');

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

        // Функция объединения моделей (копируем из основного эндпоинта)
        function mergeTestModels(models) {
            if (!models || models.length === 0) return [];
            if (models.length === 1) return models[0];
            
            const featureMap = new Map();
            
            for (const model of models) {
                if (!Array.isArray(model)) continue;
                
                for (const feature of model) {
                    if (!feature?.text) continue;
                    
                    const fKey = feature.text.toLowerCase().trim();
                    
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
                            storyMap.set(story.text.toLowerCase().trim(), story);
                        }
                    }
                    
                    for (const story of (feature.stories || [])) {
                        if (!story?.text) continue;
                        
                        const sKey = story.text.toLowerCase().trim();
                        
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
                                    scenarioMap.set(sc.text.toLowerCase().trim(), sc);
                                }
                            }
                            
                            for (const sc of (story.scenarios || [])) {
                                if (!sc?.text) continue;
                                
                                const scKey = sc.text.toLowerCase().trim();
                                
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
                                            codeMap.set(code.text.toLowerCase().trim(), code);
                                        }
                                    }
                                    
                                    for (const code of (sc.codes || [])) {
                                        if (code?.text) {
                                            const cKey = code.text.toLowerCase().trim();
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

        const SYSTEM_PROMPT = `
🚨 КРИТИЧЕСКИ ВАЖНО: НЕ ПРИДУМЫВАЙ НИЧЕГО! 🚨
Ты создаёшь тестовую модель ТОЛЬКО на основе того, что явно написано в требованиях.
ЗАПРЕЩЕНО: добавлять сценарии, действия, реакции или любые элементы, которых нет в тексте требований.
ЗАПРЕЩЕНО: додумывать пользовательские потоки, бизнес-логику или поведение системы.
ЗАПРЕЩЕНО: создавать элементы модели для функциональности, которая не описана в требованиях.
Если в требованиях нет явного описания - НЕ СОЗДАВАЙ соответствующий элемент модели.

Ты — выдающийся QA-архитектор с исключительным талантом к синтезу и декомпозиции. Твоя главная сила — видеть за разрозненными требованиями целостную картину и ценность для пользователя.

## 1. Цель
Создать иерархическую тестовую модель (Feature → Story → Scenario → Code) на основе предоставленных требований.

Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. Если требование явно про UI — интерпретируй как Angular; если про API/сервер — как .NET. Ничего не выдумывай сверх текста.

## 2. Ключевой принцип декомпозиции (САМОЕ ВАЖНОЕ!)
- **Сначала Синтез, потом Анализ.** Прочитай ВСЕ требования. Твоя первая задача — определить 1-3 **высокоуровневых пользовательских потока (Story)**, которые приносят конечную ценность.
## 2.1 Строгий запрет на домыслы и выдумки (Новый пункт)
- Если в требованиях **нет явного и однозначного описания** пользовательского сценария, действия или реакции — **не создавай** соответствующий элемент модели.
- Ни при каких обстоятельствах **не добавляй** гипотезы, догадки, предполагаемые сценарии или реакции, которых нет в требованиях.
- Лучше пропустить неопределённые или недостаточно описанные части, чем создавать искусственные данные.
- Модель должна отражать ТОЛЬКО то, что есть в требованиях, без предположений и дописок.


## 3. Структура дерева (строго соблюдать)
- **Feature (Фича):** Большой независимый блок продукта.
- **Story (C1-E2E):** **Целостный пользовательский сценарий, приносящий ценность.**
- **Scenario (C2–C3-Integration):** **Атомарное ДЕЙСТВИЕ пользователя** внутри Story, формулируется инфинитивом.
- **Code (C4-Unit):** **РЕАКЦИЯ системы** на действие пользователя, описываемое инфинитивом. **Не использовать** слово «Проверка».

## 3.1. Правила Детализации (ПРИОРИТЕТ!)
- **Если в требованиях есть раздел "Пользовательские сценарии" (или похожий по смыслу), используй его как главный источник для декомпозиции.**
- **Каждый пронумерованный шаг пользователя из этих сценариев должен стать отдельным \`Scenario\` в тестовой модели.**
- **Описание реакции системы на действие пользователя — это \`Code\` внутри этого \`Scenario\`.**

## 3.2. Принцип Абстракции Данных и Реализации (ВЫСШИЙ ПРИОРИТЕТ!)
- **Не вставляй конкретные данные из примеров** (значения, названия, тексты ошибок) в итоговую модель.
- **Не вставляй детали технической реализации.**
- Твоя задача — распознать КОНКРЕТНЫЕ ПРИМЕРЫ в требованиях, но в итоговой модели заменить их на **АБСТРАКТНЫЕ ОПИСАНИЯ ДЕЙСТВИЙ И РЕАКЦИЙ.**
- Сосредоточься на связке **"действие пользователя (Scenario) -> видимая реакция системы (Code)"**. Модель должна быть независима от конкретной технологии.

## 3.3. При недостатке информации — минимализм
- Если информации в требованиях недостаточно для создания подробного сценария, создай максимально общий и абстрактный элемент.
- Не расширяй модель за счёт непроверенных деталей.
- Предпочти короче и точнее, чем длиннее и с выдумками.

- **Примеры абстракции данных:**
  - НЕПРАВИЛЬНО: "Выбрать программу '27 LADA FREE'"
  - **ПРАВИЛЬНО:** "Выбрать значение, соответствующее условию зависимости"

- **Примеры абстракции реализации:**
  - НЕПРАВИЛЬНО (деталь): \`Scenario: "Отправить GET-запрос на /api/users"\`
  - **ПРАВИЛЬНО (действие):** \`Scenario: "Запросить список пользователей"\`
  
  - НЕПРАВИЛЬНО (деталь): \`Code: "Загрузить данные из кэша"\`
  - **ПРАВИЛЬНО (реакция):** \`Code: "Отобразить список пользователей"\`

## 4. Формат вывода (обязательно)
Выход — **ТОЛЬКО** чистый JSON-массив без комментариев и markdown.
\`\`\`json
[
  {
    "text": "Название Feature",
    "stories": [
      {
        "text": "Название Story",
        "scenarios": [
          {
            "text": "Первый Scenario",
            "codes": [
              { "text": "Первое системное действие" }
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
Основываясь на **принципах декомпозиции (п.2), детализации (п.3.1) и абстракции (п.3.2)**, проанализируй требования и сгенерируй тестовую модель в формате JSON. Ответ — **только** чистый JSON. Обязательно тестовая модель только на русском языке.

СТРОГОЕ ПРАВИЛО ДЛЯ HTTP-ЭНДПОИНТОВ: узлы \`Code\`, описывающие HTTP‑запросы (GET|POST|PUT|PATCH|DELETE "/..."), добавляй ТОЛЬКО если метод и путь явно указаны в тексте требований. Если в требованиях нет однозначного упоминания такого запроса — не добавляй его и не придумывай.
`.trim();

        // === ЧАНКОВАНИЕ БОЛЬШИХ ТРЕБОВАНИЙ ===
        const reqChunks = chunkTextBySize(reqStringForModel, 80000);
        const totalSize = reqStringForModel.length;
        
        if (reqChunks.length > 1) {
            console.log(`[generate-test-model-async] CHUNKING: Требования разбиты на ${reqChunks.length} чанков (общий размер: ${totalSize} символов)`);
            reqChunks.forEach((chunk, i) => {
                const preview = chunk.substring(0, 200).replace(/\n/g, ' ').trim();
                const endPreview = chunk.substring(Math.max(0, chunk.length - 100)).replace(/\n/g, ' ').trim();
                console.log(`  Чанк ${i + 1}/${reqChunks.length}: ${chunk.length} символов`);
                console.log(`    Начало: "${preview}..."`);
                console.log(`    Конец: "...${endPreview}"`);
            });
        }
        
        const partialModels = [];
        
        // === ГЕНЕРАЦИЯ ДЛЯ КАЖДОГО ЧАНКА ===
        for (let chunkIdx = 0; chunkIdx < reqChunks.length; chunkIdx++) {
            const reqChunk = reqChunks[chunkIdx];
            const progress = Math.round(((chunkIdx + 1) / reqChunks.length) * 100);
            
            await db('generation_tasks').where('id', taskId).update({
                progress,
                updated_at: new Date()
            });
            
            if (reqChunks.length > 1) {
                console.log(`[generate-test-model-async] Обработка чанка ${chunkIdx + 1}/${reqChunks.length}...`);
            }
            
            // Модифицируем промпт для чанков
            let userPrompt = reqChunk;
            if (reqChunks.length > 1) {
                userPrompt = `ВНИМАНИЕ: Это часть ${chunkIdx + 1} из ${reqChunks.length} от общего документа требований.

КРИТИЧЕСКИ ВАЖНО ДЛЯ БОЛЬШИХ ДОКУМЕНТОВ:
- Создай тестовую модель для этой части, ДАЖЕ ЕСЛИ информация кажется неполной
- Если видишь заголовки и описания действий пользователя, но НЕ видишь реакций системы → создай Scenarios с пустым массивом codes (они могут быть в другом чанке)
- Если видишь описания реакций системы, но контекст неясен → создай Codes в том разделе, который есть
- Если раздел начинается или заканчивается обрывочно → всё равно создай элементы с той информацией, которая доступна
- Итоговые модели из всех чанков будут АВТОМАТИЧЕСКИ объединены по названиям Feature/Story/Scenario/Code

При объединении системa соединит:
- Scenarios с одинаковыми названиями из разных чанков
- Codes будут добавлены к соответствующим Scenarios
- Дубликаты будут удалены

НЕ ПРОПУСКАЙ разделы из-за неполноты информации - лучше создать неполную структуру, чем пропустить.

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
                    tool_choice: { type: "function", function: { name: "submit_test_model" } },
                    temperature: 0.25,
                    top_p: 0.9,
                    max_tokens: 8192,
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
                    console.log(`[generate-test-model-async] Чанк ${chunkIdx + 1}: Feature "${feature.text}"`);
                    for (const story of (feature.stories || [])) {
                        totalStories++;
                        console.log(`    Story: "${story.text}"`);
                        for (const scenario of (story.scenarios || [])) {
                            totalScenarios++;
                            const codesCount = (scenario.codes || []).length;
                            if (codesCount === 0) scenariosWithoutCodes++;
                            totalCodes += codesCount;
                            console.log(`      Scenario: "${scenario.text}" (${codesCount} codes)`);
                        }
                    }
                }
                console.log(`[generate-test-model-async] Чанк ${chunkIdx + 1}/${reqChunks.length} СТАТИСТИКА: Features: ${partialModel.length}, Stories: ${totalStories}, Scenarios: ${totalScenarios} (БЕЗ codes: ${scenariosWithoutCodes}), Codes: ${totalCodes}`);
            }
        }

        // Объединяем все частичные модели
        if (partialModels.length === 0) {
            console.error('[generate-test-model-async] Не удалось получить валидные модели ни из одного чанка');
            console.error('[generate-test-model-async] Попробуем создать базовую модель...');
            
            // Создаем базовую модель как fallback
            const fallbackModel = [{
                text: "Основная функциональность",
                stories: [{
                    text: "Базовый сценарий",
                    scenarios: [{
                        text: "Основной тест",
                        codes: [{
                            text: "Проверить основную функциональность"
                        }]
                    }]
                }]
            }];
            
            partialModels.push(fallbackModel);
            console.log('[generate-test-model-async] Создана fallback модель');
        }
        
        let mergedModel = partialModels.length === 1 
            ? partialModels[0] 
            : mergeTestModels(partialModels);

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

        const finalModel = normalizeModelStructure(mergedModel);

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
        const task = await db('generation_tasks').where('id', req.params.taskId).first();
        
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json({
            id: task.id,
            status: task.status,
            progress: task.progress,
            result: task.result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        });
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


            created.push({ id: testCaseId });
        }

        res.json({ success: true, created });
    } catch (err) {
        console.error('Ошибка при массовом создании ТК:', err);
        res.status(500).json({ error: err.message });
    }
});




async function generateTestCasesAsync(taskId, inputData) {
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

        function fixAgainstModel(cases, idx) {
            console.log(`[fixAgainstModel] Обрабатываем ${cases?.length || 0} кейсов`);
            const out = [];
            const seenTitles = new Set(); // Предотвращаем дубли по названиям
            
            for (const tc of (cases || [])) {
                const layer = String(tc.layer || '');
                console.log(`[fixAgainstModel] Обрабатываем кейс:`, {
                    title: tc.title,
                    layer: tc.layer,
                    hasSteps: !!tc.steps,
                    stepsLength: tc.steps?.length,
                    hasExpected: !!tc.expected,
                    expectedLength: tc.expected?.length
                });

                // Предотвращаем дубли по названиям
                if (tc.title && seenTitles.has(tc.title.trim())) {
                    console.log(`[fixAgainstModel] Пропускаем дубликат по названию: ${tc.title}`);
                    continue;
                }
                if (tc.title) seenTitles.add(tc.title.trim());

                // ВАЖНО: НЕ отбрасываем кейсы, а ВОССТАНАВЛИВАЕМ структуру из модели
                // E2E: восстанавливаем feature по карте story->feature, но НЕ отбрасываем
                if (layer === 'E2E Tests') {
                    if (tc.story && idx.storyToFeature.has(tc.story)) {
                        const feat = idx.storyToFeature.get(tc.story);
                        if (!tc.feature || tc.feature !== feat) tc.feature = feat;
                    }
                }

                // Unit: восстанавливаем scenario/story/feature по карте code, но НЕ отбрасываем
                if (layer.startsWith('Unit')) {
                    if (tc.code && idx.codeTo.has(tc.code)) {
                        const m = idx.codeTo.get(tc.code);
                        if (!tc.scenario) tc.scenario = m.scenario;
                        if (!tc.story) tc.story = m.story;
                        if (!tc.feature) tc.feature = m.feature;
                    }
                }

                // Integration: восстанавливаем story/feature по карте scenario, но НЕ отбрасываем
                if (layer.startsWith('Integration')) {
                    if (tc.scenario && idx.scenarioToParent.has(tc.scenario)) {
                        const p = idx.scenarioToParent.get(tc.scenario);
                        if (!tc.story) tc.story = p.story;
                        if (!tc.feature) tc.feature = p.feature;
                    }
                }

                out.push(tc);
            }
            console.log(`[fixAgainstModel] Возвращаем ${out.length} кейсов (было ${cases?.length || 0})`);
            return out;
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
            
            const seenTitles = new Set(); // Предотвращаем дубли по названиям
            
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
                        feature: take(x.feature, 200),
                        story: take(x.story, 200),
                        scenario: take(x.scenario, 200),
                        code,
                        priority: take(x.priority, 50),
                        version: take(x.version, 50),
                        links: Array.isArray(x.links) ? x.links.slice(0, 10) : [],
                        jiraIssue: take(x.jiraIssue, 100)
                    };
                })
                .filter(x => {
                    // Предотвращаем дубли по названиям
                    if (x.title && seenTitles.has(x.title.trim())) {
                        console.log(`[sanitize] Пропускаем дубликат по названию: ${x.title}`);
                        return false;
                    }
                    if (x.title) seenTitles.add(x.title.trim());
                    
                    return x.title && x.layer;
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

        // === Соберём автоконтекст по ссылкам основной статьи (если есть pageId) ===
        let refinedReqs;
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

        // ====== ВСПОМОГАТЕЛЬНЫЕ ======
        function splitByStories(model) {
            const chunks = [];
            for (const f of (model || [])) {
                for (const st of (f.stories || [])) {
                    chunks.push([{ text: f.text, stories: [st] }]);
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

        function countNodes(model) {
            let stories = 0, scenarios = 0, codes = 0;
            for (const f of (model || [])) for (const st of (f.stories || [])) {
                stories++;
                for (const sc of (st.scenarios || [])) {
                    scenarios++;
                    codes += (sc.codes || []).length;
                }
            }
            return { stories, scenarios, codes };
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

        const BASE_SYSTEM_PROMPT = `
🚨 КРИТИЧЕСКИ ВАЖНО: НЕ ПРИДУМЫВАЙ НИЧЕГО! 🚨
Ты создаёшь тест-кейсы ТОЛЬКО на основе того, что явно написано в требованиях. 
ЗАПРЕЩЕНО: добавлять шаги, сценарии, ожидаемые результаты или любые детали, которых нет в тексте требований.
ЗАПРЕЩЕНО: додумывать логику, поведение системы или пользовательские действия.
ЗАПРЕЩЕНО: создавать тест-кейсы для сценариев, которые не описаны в требованиях.
ЗАПРЕЩЕНО: использовать слово "Проверка" в названиях тест-кейсов!
Если в требованиях нет явного описания - НЕ СОЗДАВАЙ тест-кейс.

🎯 КАЧЕСТВО ПРЕВЫШЕ КОЛИЧЕСТВА - КРИТИЧЕСКИ ВАЖНО! 🎯
СОЗДАВАЙ МЕНЬШЕ, НО ЛУЧШЕ! Приоритет - полезные и концентрированные тесты.
ПРАВИЛО: 1 тест-кейс = 1 проверка или 1 пользовательский сценарий.
ИСПОЛЬЗУЙ ПАРАМЕТРЫ для граничных значений и вариаций данных.
НЕ ДЕЛАЙ как начинающий тестировщик - не создавай 59 тестов для параметров кредита!
ЛУЧШЕ 10 качественных тестов, чем 50 поверхностных!

Ты — скрупулёзный SDET (Software Development Engineer in Test), создающий атомарные и исчерпывающие тест-кейсы для импорта в Allure. На основе входной тест-модели (modelStructure) и требований сгенерируй JSON-массив тест-кейсов, НЕУКОСНИТЕЛЬНО следуя Style Guide ниже.

КРИТИЧЕСКИ ВАЖНО: Каждый тест-кейс ОБЯЗАТЕЛЬНО должен содержать поле "expected" с описанием ожидаемого результата. Без этого поля тест-кейс неполный и не может быть использован.

Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. Если требования явно описывают поведение клиента, трактуй его для Angular; если описывают серверное поведение/API — трактуй для .NET. Никогда не додумывай детали вне текста.

# 1) Принцип "Один Пример из Требований -> Один Тест-Кейс" (КРАТКО И СТРОГО)
Ты создаёшь тест-кейсы исключительно на основе абсолютно явных и конкретных примеров из текста требований. Никаких домыслов, предположений или недосказанностей в шагах и expected результатах быть не должно.

Алгоритм твоих действий:
1.  Возьми один узел из \`modelStructure\` (например, \`Scenario: "Ввести недопустимое значение..."\`).
2.  Тщательно просканируй ВЕСЬ текст требований и найди ТОЛЬКО те примеры, которые явно и текстуально соответствуют этому узлу.
3.  УМНО КОНСОЛИДИРУЙ похожие примеры в один тест-кейс с параметрами.
4.  Создавай тест-кейсы только для РАЗНЫХ типов проверок, а не для каждого значения.
5.  Все поля \`title\`, \`steps\` и \`expected\` должны содержать лишь ДОСЛОВНЫЕ данные или тексты, встречающиеся в требованиях. Запрещено добавлять или интерпретировать дополнительную информацию.
6.  Если для узла отсутствуют явные примеры в требованиях — не создавай тест-кейса вовсе.
7.  При сложной логике описывай ожидаемый результат ровно так, как он изложен в соответствующем примере, ни больше, ни меньше.

# 1.1) КОНСОЛИДАЦИЯ ТЕСТ-КЕЙСОВ - КРИТИЧЕСКИ ВАЖНО! 🎯
ЗАПРЕЩЕНО создавать множественные тест-кейсы для одного функционала!
ПРАВИЛО: 1 тест-кейс = 1 проверка или 1 пользовательский сценарий.

КОНСОЛИДАЦИЯ ПО ОЖИДАЕМОМУ РЕЗУЛЬТАТУ:
- Если у нескольких примеров ОДИНАКОВЫЙ ожидаемый результат - ОБЪЕДИНИ в один тест-кейс с параметрами
- НЕ создавай отдельные тест-кейсы для "11 месяцев", "12 месяцев", "84 месяца" - это ОДИН тест с параметрами
- НЕ создавай отдельные тест-кейсы для "Физическое лицо" и "Юридическое лицо" - это ОДИН тест с параметрами

ПАРАМЕТРИЗАЦИЯ ГРАНИЧНЫХ ЗНАЧЕНИЙ:
- Для граничных значений (минимум, максимум, валидные диапазоны) используй ОДИН тест-кейс с параметрами
- НЕ создавай 59 тестов для параметров кредита - создай 3-5 тестов с параметрами
- Пример: "Ввод срока кредита" с параметрами: [11, 12, 84, 85] месяцев

ПРЕДОТВРАЩЕНИЕ ДУБЛИРОВАНИЯ:
- НЕ создавай тест-кейсы с одинаковыми названиями
- НЕ создавай тест-кейсы с одинаковыми шагами
- НЕ создавай тест-кейсы с одинаковыми ожидаемыми результатами
- Если видишь дублирование - ОБЪЕДИНИ в один тест-кейс

ОБЯЗАТЕЛЬНЫЕ ШАГИ:
- КАЖДЫЙ тест-кейс ДОЛЖЕН содержать минимум 1 шаг
- НЕ создавай тест-кейсы без шагов
- Шаги должны быть конкретными и выполнимыми

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
3) Integration (C2–C3) — взаимодействия компонент/эндпоинтов:
   • В рамках одного компонента (FE) или одного API-вызова (BE), без навигации по страницам.
   • Основная работа: классы эквивалентности, граничные значения (BVA), контракты API.
4) Unit (C4) — одна функция/метод, строгий AAA (Arrange-Act-Assert).

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
Примеры наборов тегов:
• FE E2E/Integration (десктоп): ["D"]  
• BE Integration: ["S"] или ["D","S"] если тест затрагивает интерфейсно-зависимые артефакты  

# 5) Выходной формат: СТРОГО ТОЛЬКО JSON-массив
Используй ровно один из трёх шаблонов ниже в зависимости от "layer". Никаких комментариев/markdown.

## Шаблон: "layer": "E2E Tests"
{
  "feature": "ОБЯЗАТЕЛЬНО: Название фичи из модели",
  "story": "ОБЯЗАТЕЛЬНО: Название истории из модели",
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
  "feature": "ОБЯЗАТЕЛЬНО: Название фичи из модели",
  "story": "ОБЯЗАТЕЛЬНО: Название истории из модели",
  "scenario": "ОБЯЗАТЕЛЬНО: ТОЧНОЕ название сценария из модели",
  "title": "Конкретное действие (например, 'Валидация поля «Имя» при вводе более 100 символов')",
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
  "tags": ["Unit", "‹по матрице тегов›"],
  "layer": "Unit frontend Tests",
  "priority": "‹по матрице риска›"
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
• "links": [{ "text": "...", "url": "..." }], • "jiraIssue": "ABC-123", • "version": "stable" (по умолчанию для новых), • "attachments": [...], • "parameters": "..." (использовать только если во входе явно заданы параметры; для DDT/Pairwise — но не выдумывать).

# 6) Правила генерации набора тест-кейсов
Для КАЖДОЙ Story: 
— 1–2 E2E-теста: Happy Path и (при необходимости) один ключевой Negative Path на уровне потока.

Для КАЖДОГО Scenario:
— 3–5 Integration-тестов (главный объём): позитивные/негативные случаи, BVA, классы эквивалентности, контракты API.  
— Поле "scenario" должно 1:1 совпадать с текстом узла.

Для КАЖДОГО Code:
— 2–4 Unit-теста по AAA (описательно).  
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

# 8) Чек-лист перед выводом
— Все кейсы независимы; по одному «смыслу» на кейс.  
— В E2E есть «Авторизоваться…» и «Перейти на страницу…».  
— Детальные проверки (валидации полей и т.п.) не просочились в E2E.  
— "scenario" (для Integration/Unit) совпадает с моделью.  
— Теги проставлены по правилам: D/A/M/PWA; "S" для бэкенда; номер требования — только если есть во входе.  
— "version" = "stable" для новых кейсов (если не указано иное).

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ КАСТОМНЫХ ПОЛЕЙ! 🚨
— ДЛЯ ВСЕХ ТЕСТОВ: "feature" ОБЯЗАТЕЛЬНО!
— E2E Tests: ОБЯЗАТЕЛЬНО "feature" + "story"
— Integration Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario"  
— Unit Tests: ОБЯЗАТЕЛЬНО "feature" + "story" + "scenario" + "code"
— НЕ ОСТАВЛЯЙ пустых кастомных полей - это критично для структуры!

🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ НАЗВАНИЙ ТЕСТ-КЕЙСОВ! 🚨
— ЗАПРЕЩЕНО использовать слово "Проверка" в названиях!
— Используй глаголы действия: "Валидация", "Создание", "Удаление", "Отображение"
— Примеры ХОРОШИХ названий: "Валидация поля при вводе неверных данных", "Создание заявки с корректными данными"
— Примеры ПЛОХИХ названий: "Проверка валидации поля", "Проверка создания заявки"  

# 9) Формат ответа
Выведи СТРОГО один JSON-массив кейсов без каких-либо комментариев, текста или Markdown.

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
# 6.1 Ковенанта покрытия (строго)
В модели: Stories=${S}, Scenarios=${Sc}, Codes=${C}.
Минимум по всей модели: E2E ≥ ${Math.max(1, S)}, Integration ≥ ${Sc * 3}, Unit ≥ ${C * 2}.
Если объём большой, сокращай формулировки, но НЕ снижай счётчики.
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
                                    }
                                },
                                required: ["title", "layer", "expected"]
                            }
                        }
                    },
                    required: ["cases"],
                    additionalProperties: false
                }
            }
        });

        const storyChunks = splitByStories(modelStructure);
        const genLimit = pLimit(4);
        const reqsChunks = splitRequirements(refinedReqs, 45000);
        
        const totalOperations = reqsChunks.length * storyChunks.length;
        let completedOperations = 0;

        // Функция для подсчета узлов в чанке
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

        // Генерация для одного чанка (одной Story)
        async function genForChunk(modelChunk, reqs, systemPrompt) {
            const allowedForChunk = collectAllowedCodes(modelChunk);
            const allowedScenarios = collectAllowedScenarios(modelChunk);
            const { scenarios: scCnt, codes: cdCnt } = countChunkNodes(modelChunk);

            // Обрежем "Контекст из ссылок" до безопасного размера
            const linkCtxRaw = Array.isArray(autoPages) && autoPages.length
                ? autoPages.join('\n\n---\n\n')
                : '';
            const sanitizeLinkCtx = (s) => String(s || '')
                .replace(/```[\s\S]*?```/g, '')            // убрать большие код-блоки
                .replace(/^#\s.*$/gm, '')                  // убрать H1
                .replace(/^##\s.*$/gm, '###')              // H2 → H3 (компактнее)
                .replace(/\n{3,}/g, '\n\n');
            let linkCtx = sanitizeLinkCtx(linkCtxRaw);
            const MAX_LINK_CTX = 12000; // ~12k символов на Story
            if (linkCtx.length > MAX_LINK_CTX) linkCtx = linkCtx.slice(0, MAX_LINK_CTX);

            const userPrompt = `
Сгенерируй JSON-массив тест-кейсов на русском языке для ЭТОГО куска модели (одна Story).
Модель (кусок):
${JSON.stringify(modelChunk, null, 2)}

Требования:
${reqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Контекст из ссылок исходного требования (используй только для прояснения ссылок; не придумывай новое):
${linkCtx || '—'}

ДОПУСТИМЫЕ ЗНАЧЕНИЯ ДЛЯ "code" (если используешь):
${allowedForChunk.map(c => `- ${c}`).join('\n')}

⚠️ Минимум для ЭТОГО куска:
— E2E: ≥ 1 на Story (не более 3),
— Integration: ≥ ${Math.max(0, scCnt * 3)} (по 3-5 на каждый Scenario),
— Unit: ≥ ${Math.max(0, cdCnt * 2)} (по 2 на каждый Code из списка выше).
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
                    tool_choice: { type: 'function', function: { name: 'submit_cases' } },
                    temperature: 0,
                    top_p: 1,
                    max_tokens: 32000
                }
            );

            const args = extractToolArgs(ai, 'submit_cases');
            if (args && Array.isArray(args.cases) && args.cases.length) {
                console.log(`[genForChunk] OK: Получено ${args.cases.length} кейсов через tool_call.`);
                console.log(`[genForChunk] Первый кейс:`, JSON.stringify(args.cases[0], null, 2));
                console.log(`[genForChunk] Проверка полей первого кейса:`, {
                    hasTitle: !!args.cases[0].title,
                    hasSteps: !!args.cases[0].steps,
                    stepsLength: args.cases[0].steps?.length,
                    hasExpected: !!args.cases[0].expected,
                    expectedLength: args.cases[0].expected?.length
                });
                return args.cases;
            }

            console.warn(`[genForChunk] WARN: tool_call не найден. Попытка парсинга из content.`);
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
                                    max_tokens: 32000
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

        const parts = [];
        const TIMEOUT_MS = 1500000;

        for (let reqIdx = 0; reqIdx < reqsChunks.length; reqIdx++) {
            const reqsChunk = reqsChunks[reqIdx];
            
            const promises = storyChunks.map((chunk, storyIdx) => 
                genLimit(async () => {
                    const storyName = chunk[0]?.stories[0]?.text || 'N/A';
                    
                    const result = await withTimeout(
                        genForChunk(chunk, reqsChunk, `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}`),
                        TIMEOUT_MS,
                        `Timeout for chunk ${reqIdx + 1}/${reqsChunks.length} → Story ${storyIdx + 1}/${storyChunks.length}: ${storyName}`
                    );
                    
                    completedOperations++;
                    const progress = Math.round((completedOperations / totalOperations) * 100);
                    
                    await db('generation_tasks').where('id', taskId).update({
                        progress,
                        updated_at: new Date()
                    });
                    
                    return result;
                })
            );

            const chunkResults = await Promise.all(promises);
            const validResults = chunkResults.filter(result => Array.isArray(result) && result.length > 0);
            
            if (validResults.length === 0) {
                console.warn(`[generate-test-cases-async] Чанк требований ${reqIdx + 1}: не получено валидных тест-кейсов`);
                // Добавляем fallback тест-кейс
                parts.push([{
                    title: "Базовый тест-кейс",
                    description: "Проверить основную функциональность",
                    steps: ["Выполнить базовую проверку"],
                    expectedResult: "Функциональность работает корректно",
                    type: "E2E"
                }]);
            } else {
                parts.push(...validResults.flat());
            }
        }

        const allTestCases = parts.flat();

        // === sanitize → fixAgainstModel до аудита покрытия ===
        const idx = buildModelIndex(modelStructure);
        let finalTestCases = sanitize(allTestCases);
        finalTestCases = fixAgainstModel(finalTestCases, idx);

        // Если в модели всего одна Feature — принудительно выставим её всем кейсам
        const uniqueFeatures = [...new Set((modelStructure || []).map(f => f?.text?.trim()).filter(Boolean))];
        if (uniqueFeatures.length === 1) {
            const theOnlyFeature = uniqueFeatures[0];
            finalTestCases = finalTestCases.map(tc => ({ ...tc, feature: theOnlyFeature }));
        }
        
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

app.get('/api/generate-test-cases-status/:taskId', async (req, res) => {
    try {
        const task = await db('generation_tasks').where('id', req.params.taskId).first();
        
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json({
            id: task.id,
            status: task.status,
            progress: task.progress,
            result: task.result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        });
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

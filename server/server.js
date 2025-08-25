import express from 'express';
import cors from 'cors';
import JSON5 from 'json5';
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
    addTagToTestCase,
    addLinkToTestCase,
    linkIssueToTestCase,
    setTestCaseLayer,
    setTestCasePriority,
    setTestCaseVersion,
    addParameterToTestCase,
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
import { exportStructureAllure } from './xmind-parce/export-structure-allure.mjs';
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

const DEFAULT_JIRA_INTEGRATION_ID = config.defaultJiraIntegrationId;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const app = express();
const PORT = 5000;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 20 }
});


const corsOptions = {
    origin: 'https://test-inspector.abanking.ru',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};


app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.options('*', cors(corsOptions));
//app.use(cors());
//app.options('*', cors());
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
    return Array.isArray(model) ? walk(model, 1) : walk([model], 1);
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
        await exportStructureAllure(allureData, projectId); // Передаем JSON в функцию

        res.status(200).send('Экспорт успешно завершён.');
    } catch (error) {
        console.error('Ошибка экспорта:', error.message);

        res.status(500).send('Ошибка при экспорте.');
    }
});

app.post('/api/ai-recommendation', async (req, res) => {
    try {
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
        const recommendation = await analyzeTestCaseWithAI(testCase);
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
                // Если хотите «мягкий» сценарий — замените throw на console.warn
                throw new Error(`Не удалось получить глоссарий из Confluence (pageId=${glossaryPageId}): ${e.message}`);
            }
        }

        // 3) Доп. контекст (строка ИЛИ массив строк) + страницы
        let contextText = normalizeContextInput(context);
        const ctxIds = normalizePageIds(contextPageIds);


        if (ctxIds.length) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для загрузки доп. контекста из Confluence требуется bearerToken' });
            }

            const parts = [];
            if (contextInstruction?.trim()) {
                parts.push(`**Инструкция к доп. контексту:** ${contextInstruction.trim()}\n`);
            }
            for (const cid of ctxIds) {
                try {
                    const { markdown } = await fetchConfluencePage(bearerToken, cid, { inlineTextAttachments: true });
                    parts.push(`\n---\n### Доп. контекст: Confluence pageId=${cid}\n\n${markdown}`);
                } catch (e) {
                    parts.push(`\n---\n### Доп. контекст: Confluence pageId=${cid}\n\n(Не удалось загрузить: ${e.message})`);
                }
            }
            contextText = [contextText, parts.join('\n')].filter(Boolean).join('\n\n');
        }

        // 4) Анализ (с префильтром)
        const aiResponse = await analyzeRequirementWithAI(
            requirementText,
            contextText,
            project,            // можно undefined — внутри есть дефолт '—'
            glossaryText,
            { prefilter: true, contextHint: contextInstruction || '—' }
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
    const issueKey = 'JMT-983';               // берём из вашего CURL
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
            'Epic Link': 'Epic Link'
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

        /*
        // 3) Постранично вытягиваем всех assignable пользователей
        const users = [];
        const maxResults = 100;   // Jira позволяет до 1000, но 100—более безопасно
        let startAt = 0;
        while (true) {
            const url = `${jiraBase}/rest/api/2/user/assignable/search`
                + `?project=${encodeURIComponent(projectKey)}`
                + `&startAt=${startAt}`
                + `&maxResults=${maxResults}`;
            const resp = await fetch(url, { headers });
            if (!resp.ok) break;
            const batch = await resp.json();
            users.push(...batch);
            if (batch.length < maxResults) break;  // больше страниц нет
            startAt += maxResults;
        }

        // 4) Версии проекта (возвращаются все сразу)
        const versions = await fetch(
            `${jiraBase}/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`,
            { headers }
        ).then(r => r.ok ? r.json() : []);
*/
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
    try {
        const feedback = await analyzeBugWithAI(task);
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
        const ai = await callWithBackoff(
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
        try { return JSON.parse(args); } catch { return JSON5.parse(args); }
    }
    if (msg.function_call?.arguments) {
        const raw = msg.function_call.arguments;
        try { return JSON.parse(raw); } catch { return JSON5.parse(raw); }
    }
    return null;
}



//
// Универсальная функция для повторных попыток при 5xx,
// принимающая либо строку prompt, либо массив сообщений {role, content}
//
async function callWithBackoff(url, promptOrMessages, apiKey, opts = {}) {
    const {
        model = 'qwen/qwen3-235b-a22b:free',
        tools,
        tool_choice,
        response_format,
        temperature = 0.4,
        top_p = 0.95,
        extra = {},
        maxAttempts = 8,          // больше попыток: учитываем очереди у провайдера
        minWaitMs = 1500,         // минимальный бэкофф
        maxWaitMs = 120000,       // верхняя граница ожидания между ретраями
        logRateLimit = true       // логировать лимит-хедеры для диагностики
    } = opts;

    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

    // экспоненциальный бэкофф с небольшим джиттером
    const backoff = (attemptIdx) => {
        const base = Math.min(minWaitMs * Math.pow(2, attemptIdx - 1), maxWaitMs);
        const jitter = 1 + Math.random() * 0.2; // +0..20%
        return Math.floor(base * jitter);
    };

    let attempt = 0;

    while (attempt < maxAttempts) {
        attempt++;

        const payload = {
            model,
            messages,
            temperature,
            top_p,
            ...extra
        };
        if (tools) payload.tools = tools;
        if (tool_choice) payload.tool_choice = tool_choice;
        if (response_format) payload.response_format = response_format;

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // Успешно — парсим и выходим
        if (resp.ok) {
            const text = await resp.text();
            if (!text || !/[{\[]/.test(text)) {
                throw new Error(`Empty or invalid JSON response from AI: "${text}"`);
            }
            try {
                return JSON.parse(text);
            } catch {
                // JSON5 импортирован у вас выше
                return JSON5.parse(text);
            }
        }

        // ==== 429: подождать и повторить внутри функции ====
        if (resp.status === 429) {
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
                console.warn('[callWithBackoff] 429 rate limit. Waiting ms:', waitMs, {
                    retryAfter: h('retry-after'),
                    xRateReset: h('x-ratelimit-reset'),
                    xRateResetReq: h('x-ratelimit-reset-requests'),
                    xRateResetTok: h('x-ratelimit-reset-tokens'),
                    remaining
                });
            }

            await new Promise(r => setTimeout(r, Math.min(waitMs, maxWaitMs)));
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



function buildSubmitCasesTool(allowedCodes = []) {
    return {
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
                                scenario: { type: "string" },
                                // ВАЖНО: code только из модели. Поле опционально.
                                ...(allowedCodes.length
                                    ? { code: { type: "string", enum: allowedCodes } }
                                    : { code: { type: "string" } }),
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
    };
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
    let refinedReqs = requirements;
    try {
        const { refinedArray } = await contextRefiner({
            requirements,
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
        });
        refinedReqs = refinedArray;
    } catch (e) {
        console.warn('[generate-test-cases] contextRefiner warning:', e.message);
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
            .filter(x => x.title && x.layer);
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
        for (const tc of (cases || [])) {
            const layer = String(tc.layer || '');

            // E2E: story обязателен, feature восстанавливаем по карте story->feature
            if (layer === 'E2E Tests') {
                if (!tc.story || !idx.storyToFeature.has(tc.story)) continue; // неизвестная Story — выбрасываем
                const feat = idx.storyToFeature.get(tc.story);
                if (!tc.feature || tc.feature !== feat) tc.feature = feat;
            }

            // Unit: нужен корректный code → восстанавливаем scenario/story/feature по карте
            if (layer.startsWith('Unit')) {
                if (!tc.code) continue;
                const m = idx.codeTo.get(tc.code);
                if (!m) continue; // неизвестный code — отбрасываем
                if (!tc.scenario) tc.scenario = m.scenario;
                if (!tc.story) tc.story = m.story;
                if (!tc.feature) tc.feature = m.feature;
            }

            // Integration: scenario обязателен и должен быть из модели
            if (layer.startsWith('Integration')) {
                if (!tc.scenario || !idx.scenarioSet.has(tc.scenario)) continue;
                const p = idx.scenarioToParent.get(tc.scenario);
                if (p) {
                    if (!tc.story) tc.story = p.story;
                    if (!tc.feature) tc.feature = p.feature;
                }
            }

            // Если scenario указан, но его нет в модели — выкидываем (ловим «Проверка»)
            if (tc.scenario && !idx.scenarioSet.has(tc.scenario)) continue;

            // Общая страховка: если есть Story из модели — фича должна быть ровно её родитель
            if (tc.story && idx.storyToFeature.has(tc.story)) {
                const mustFeature = idx.storyToFeature.get(tc.story);
                if (tc.feature !== mustFeature) tc.feature = mustFeature;
            }

            out.push(tc);
        }
        return out;
    }

    // ====== ПРОМПТЫ ======
    const BASE_SYSTEM_PROMPT = `
Ты — скрупулёзный SDET (Software Development Engineer in Test), создающий атомарные и исчерпывающие тест-кейсы для импорта в Allure. На основе входной тест-модели (modelStructure) и требований сгенерируй JSON-массив тест-кейсов, НЕУКОСНИТЕЛЬНО следуя Style Guide ниже.

# 1) Принцип "Один Пример из Требований -> Один Тест-Кейс" (ГЛАВНОЕ ПРАВИЛО!)
Твоя основная задача — не просто следовать структуре modelStructure, а использовать её как каркас для генерации тестов на основе КОНКРЕТНЫХ ПРИМЕРОВ из текста требований.

Алгоритм твоих действий:
1.  Возьми один узел из \`modelStructure\` (например, \`Scenario: "Ввести недопустимое значение..."\`).
2.  Просканируй ВЕСЬ текст требований и найди ВСЕ конкретные пользовательские примеры, которые соответствуют этому абстрактному узлу.
3.  Для КАЖДОГО найденного примера создай ОДИН отдельный, атомарный тест-кейс.
4.  ЗАПРЕЩЕНО объединять несколько разных примеров (например, с разными кредитными программами или разными наборами данных) в один тест-кейс.
5.  При формировании полей \`title\`, \`steps\` и \`expected\` для каждого тест-кейса, используй КОНКРЕТНЫЕ ДАННЫЕ (названия программ, цифры, тексты ошибок) из того примера, на котором основан этот кейс.
6.  Если для одного примера в требованиях описана сложная логика (например, "применится последняя подошедшая зависимость"), твой \`expected\` результат должен ТОЧНО отражать исход этой логики для данных этого примера, без выдумывания "приоритетов".

Пример работы алгоритма:
- **Абстрактный узел:** \`Scenario: "Проверить срабатывание валидации при конфликте условий"\`
- **Требования содержат пример:** "Если настроены две зависимости с одинаковым условием для '27 LADA FREE', и в поле введено значение '10', то должна сработать последняя зависимость с текстом 'Срок кредита, не может быть <12 мес. и >84 мес.'"
- **Твой результат (один тест-кейс):**
  - \`title\`: "Проверка применения последней зависимости при конфликте условий для программы '27 LADA FREE'"
  - \`steps\`: ["Выбрать значение '27 LADA FREE'", "Ввести значение '10'"]
  - \`expected\`: "Система отображает текст ошибки 'Срок кредита, не может быть <12 мес. и >84 мес.'"

# 2) Пирамида тестирования — нерушимые правила
1) Сдвигай проверки вниз: детальные проверки (валидации, границы, форматы) — в Integration/Unit, а не в E2E.
2) E2E (C1) — только сквозные бизнес-сценарии:
   • Чёрный ящик, имитация реального пользователя.
   • ВСЕГДА начинаются шагами: «Авторизоваться…», «Перейти на страницу…».
   • НЕЛЬЗЯ проверять сообщения отдельных полей и вводить невалидные данные полей — максимум 1–2 ключевых негативных сценария на уровне всего потока (например, «ошибка сервера при сохранении»).
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
— Номер требования: добавь тег с идентификатором требования (например, "REQ-123") если он явно присутствует во входе; если нет — пропусти.  
Примеры наборов тегов:
• FE E2E/Integration (десктоп): ["D"]  
• BE Integration: ["S"] или ["D","S"] если тест затрагивает интерфейсно-зависимые артефакты  
• С требованием: ["D","REQ-123"]

# 5) Выходной формат: СТРОГО ТОЛЬКО JSON-массив
Используй ровно один из трёх шаблонов ниже в зависимости от "layer". Никаких комментариев/markdown.

## Шаблон: "layer": "E2E Tests"
{
  "feature": "Название фичи из модели",
  "story": "Название истории из модели",
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
- Unit = чистая бизнес-логика: без рендера UI, без DOM, без “Открыть/Перейти/Кликнуть/Ввести”, без авторизации и навигации, без HTTP/эндпоинтов.
- Любая инициализация компонента, взаимодействие с формами/страницей/браузером = только “Integration frontend Tests”.
- Любой полноценный HTTP-вызов/контракт/статус-код = только “Integration backend Tests”.
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

        const userPrompt = `
Сгенерируй JSON-массив тест-кейсов на русском языке для ЭТОГО куска модели (одна Story).
Модель (кусок):
${JSON.stringify(modelChunk, null, 2)}

Требования:
${reqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

ДОПУСТИМЫЕ ЗНАЧЕНИЯ ДЛЯ "code" (если используешь):
${allowedForChunk.map(c => `- ${c}`).join('\n')}

⚠️ Минимум для ЭТОГО куска:
— E2E: ≥ 1 на Story (не более 2),
— Integration: ≥ ${Math.max(0, scCnt * 3)} (по 3 на каждый Scenario),
— Unit: ≥ ${Math.max(0, cdCnt * 2)} (по 2 на каждый Code из списка выше).
Ответ — ТОЛЬКО чистый JSON-массив без Markdown.
`.trim();

        const tools = [buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios)];
        const ai = await callWithBackoff(
            OPENROUTER_URL,
            [
                { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}` },
                { role: 'user', content: userPrompt }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "submit_cases" } },
                temperature: 0.25,
                top_p: 0.9,
                extra: { transforms: 'middle-out' }
            }
        );

        // tool-call путь
        const args = extractToolArgs(ai, "submit_cases");
        if (args && Array.isArray(args.cases)) return args.cases;

        // фолбэк на «сырой» текст
        const content = ai.choices?.[0]?.message?.content || '';
        const rawJsonCandidate = extractJsonArray(content);
        if (!rawJsonCandidate) return [];
        const jsonText = cleanupJsonText(rawJsonCandidate);
        const parsed = JSON5.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [];
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
        const ai = await callWithBackoff(
            OPENROUTER_URL,
            [
                { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}` },
                { role: 'user', content: userPrompt }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "submit_cases" } },
                temperature: 0.25,
                top_p: 0.9,
                extra: { transforms: 'middle-out' }
            }
        );

        const args = extractToolArgs(ai, "submit_cases");
        if (args && Array.isArray(args.cases)) return args.cases;

        const content = ai.choices?.[0]?.message?.content || '';
        const rawJsonCandidate = extractJsonArray(content);
        if (!rawJsonCandidate) return [];
        const jsonText = cleanupJsonText(rawJsonCandidate);
        const parsed = JSON5.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [];
    }

    try {
        // Разбиваем на story-чанки
        const storyChunks = splitByStories(modelStructure);

        // Не спамим API: free-модель часто с лимитом — гоняем последовательно
        const genLimit = pLimit(1);

        // Генерация по кускам
        const parts = [];
        for (const chunk of storyChunks) {
            const chunkCases = await genLimit(() => genForChunk(chunk, refinedReqs, BASE_SYSTEM_PROMPT));
            parts.push(chunkCases);
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
            let extra = await genLimit(() => gapFill(modelStructure, refinedReqs, missing, BASE_SYSTEM_PROMPT));
            extra = sanitize(extra);
            extra = fixAgainstModel(extra, idx);
            allCases = allCases.concat(extra);
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
        requirements,          // string | string[]
        // новые поля:
        text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
    } = req.body;
    if (!requirements && !text && !pageId) {
        return res.status(400).json({ error: 'Нужно передать requirements (строка/массив), либо text, либо pageId' });
    }

    // Приводим к строке требований, предварительно прогнав через contextRefiner
    let reqStringForModel = '';
    try {
        const { refinedText, refinedArray } = await contextRefiner({
            requirements: Array.isArray(requirements) ? requirements : (requirements ? [requirements] : undefined),
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
        });
        // Если был массив — лучше собрать одну строку для модели
        reqStringForModel = refinedText || (refinedArray?.join('\n\n') ?? '');
    } catch (e) {
        console.warn('[generate-test-model] contextRefiner warning:', e.message);
        reqStringForModel = typeof requirements === 'string' ? requirements : (Array.isArray(requirements) ? requirements.join('\n\n') : (text || ''));
    }

    console.log('Требования для тест модели')
    console.log(reqStringForModel)
    const SYSTEM_PROMPT = `
Ты — выдающийся QA-архитектор с исключительным талантом к синтезу и декомпозиции. Твоя главная сила — видеть за разрозненными требованиями целостную картину и ценность для пользователя.

## 1. Цель
Создать иерархическую тестовую модель (Feature → Story → Scenario → Code) на основе предоставленных требований.

## 2. Ключевой принцип декомпозиции (САМОЕ ВАЖНОЕ!)
- **Сначала Синтез, потом Анализ.** Прочитай ВСЕ требования. Твоя первая задача — определить 1-3 **высокоуровневых пользовательских потока (Story)**, которые приносят конечную ценность.

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
`.trim();



    try {
        const tools = [buildSubmitModelTool()];
        const ai = await callWithBackoff(
            OPENROUTER_URL,
            [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: reqStringForModel }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "submit_test_model" } },
                temperature: 0.3,
                top_p: 0.9,
                extra: { transforms: 'middle-out' }
            }
        );

        // 1) Пытаемся забрать tool-call
        let args = extractToolArgs(ai, "submit_test_model");
        let model;

        if (args && Array.isArray(args.model)) {
            model = args.model;
        } else {
            // 2) Фолбэк: из content вырезаем массив
            let content = ai.choices?.[0]?.message?.content?.trim();
            if (!content) throw new Error('AI не вернул результата');

            const firstBracket = content.indexOf('[');
            const lastBracket = content.lastIndexOf(']');
            if (firstBracket === -1 || lastBracket === -1) throw new Error('Не найден JSON-массив');
            let jsonText = content.slice(firstBracket, lastBracket + 1);
            jsonText = jsonText.replace(/"(\s*)"code":/g, '", "code":');

            let parsed = JSON5.parse(jsonText);
            // если плоская структура — поднимем
            const isFlat = parsed.length > 0 && parsed[0].hasOwnProperty('Feature');
            model = isFlat ? transformToHierarchy(parsed) : parsed;
        }

        const finalModel = normalizeModelStructure(model);
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




// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

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
import { customProjectField } from '../server/xmind-parce/customProjectField.js';

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

/**
 * POST /analyze/solution
 * Тело: { text: string, context?: string, project?: string }
 */
app.post('/api/analyze/solution', async (req, res) => {
    try {
        const { text, pageId, context, project, glossary, bearerToken } = req.body;

        if (!text && !pageId) {
            throw new Error('Параметр text или pageId обязателен.');
        }

        let requirementText = text;
        if (pageId) {
            if (!bearerToken) {
                throw new Error('Для получения страницы Confluence требуется bearerToken');
            }
            try {
                requirementText = await fetchConfluencePage(bearerToken, pageId);
            } catch (e) {
                throw new Error(`Не удалось получить страницу Confluence: ${e.message}`);
            }
        }

        const aiResponse = await analyzeRequirementWithAI(
            requirementText,
            context,
            project,
            glossary
        );

        const result = {
            ai: {
                success: true,
                response: aiResponse
            }
        };

        res.json({ success: true, data: result });

    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
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
                top_p: 0.95
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
        extra = {}
    } = opts;

    const maxAttempts = 3;
    let attempt = 0;
    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

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
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (resp.ok) {
            const bodyText = await resp.text();
            if (!bodyText || !/[{\[]/.test(bodyText)) {
                throw new Error(`Empty or invalid JSON response from AI: "${bodyText}"`);
            }
            try {
                return JSON.parse(bodyText);
            } catch {
                return JSON5.parse(bodyText);
            }
        }

        if (resp.status === 429) {
            // пробуем достать время ожидания
            const retryAfter = resp.headers.get('retry-after'); // сек
            const resetHdr = resp.headers.get('x-ratelimit-reset'); // иногда timestamp (сек или мс)
            let waitMs = 60_000; // дефолт: минута

            if (retryAfter && !Number.isNaN(Number(retryAfter))) {
                waitMs = Number(retryAfter) * 1000;
            } else if (resetHdr && !Number.isNaN(Number(resetHdr))) {
                const n = Number(resetHdr);
                // бывает Unix sec, бывает ms — определим по величине
                const resetMs = n > 1e12 ? n : n * 1000;
                waitMs = Math.max(0, resetMs - Date.now());
            } else {
                // если в теле есть метаданные — парсим на всякий
                const text = await resp.text().catch(() => '');
                const m = text.match(/"X-RateLimit-Reset":"?(\d+)"?/i);
                if (m) {
                    const n = Number(m[1]);
                    const resetMs = n > 1e12 ? n : n * 1000;
                    waitMs = Math.max(0, resetMs - Date.now());
                }
            }

            const err = new Error(`Пожалуйста, повторите запрос через 1 минуту, есть небольшая очередь`);
            err.code = 429;
            err.waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));
            throw err;
        }

        if (resp.status >= 500 && resp.status < 600 && attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
        }
        const text = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${text}`);
    }

    throw new Error('OpenRouter: превышено максимальное число попыток');
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
    const { requirements, modelStructure: rawModel } = req.body;
    const modelStructure = normalizeModelStructure(rawModel);
    const allowedCodes = Array.from(new Set(
        (modelStructure || []).flatMap(f =>
            (f.stories || []).flatMap(st =>
                (st.scenarios || []).flatMap(sc =>
                    (sc.codes || []).map(cd => (cd?.text || '').trim()).filter(Boolean)
                )
            )
        )
    ));
    if (!Array.isArray(requirements) || !modelStructure) {
        return res.status(400).json({ error: 'requirements и modelStructure обязательны' });
    }

    const SYSTEM_PROMPT = `
Ты — скрупулёзный SDET (Software Development Engineer in Test), создающий атомарные и исчерпывающие тест-кейсы для импорта в Allure. На основе входной тест-модели (modelStructure) и требований сгенерируй JSON-массив тест-кейсов, НЕУКОСНИТЕЛЬНО следуя Style Guide ниже.

# 1) Главная директива
Преобразуй КАЖДЫЙ значимый узел из modelStructure (Story, Scenario, Code) в набор соответствующих тест-кейсов (E2E, Integration, Unit). Не пропускай узлы и не выдумывай новые.

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
— Приоритет и версия:
   • Версия по умолчанию — "stable" для новых кейсов.  
   • При доработках — клонировать кейс и указать нужную версию.  

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
  "tags": ["D"],
  "layer": "E2E Tests",
  "priority": "High"
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
  "tags": ["D"],
  "layer": "Integration frontend Tests",
  "priority": "Medium"
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
  "tags": ["Unit"],
  "layer": "Unit frontend Tests",
  "priority": "Low"
}
Правила для Unit:
— НЕ придумывать имена функций/классов и не использовать синтаксис языков.  
— "code" заполняется СТРОГО из codes[].text, иначе это поле опускается.

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

# 8) Чек-лист перед выводом
— Все кейсы независимы; по одному «смыслу» на кейс.  
— В E2E есть «Авторизоваться…» и «Перейти на страницу…».  
— Детальные проверки (валидации полей и т.п.) не просочились в E2E.  
— "scenario" (для Integration/Unit) совпадает с моделью.  
— Теги проставлены по правилам: D/A/M/PWA; "S" для бэкенда; номер требования — только если есть во входе.  
— "version" = "stable" для новых кейсов (если не указано иное).  

# 9) Формат ответа
Выведи СТРОГО один JSON-массив кейсов без каких-либо комментариев, текста или Markdown.`


    const userPrompt = `
Сгенерируй JSON-массив тест-кейсов на русском языке.
Модель:
${JSON.stringify(modelStructure, null, 2)}

Требования:
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

ДОПУСТИМЫЕ ЗНАЧЕНИЯ ДЛЯ "code" (если используешь):
${allowedCodes.map(c => `- ${c}`).join('\n')}

⚠️ ВАЖНО: 
- Ответ только чистый JSON–массив, без markdown и пояснений.
- Все строки в двойных кавычках.
- Для Unit: "code" можно указывать только из списка выше. Если не подходит — не указывай "code".
`.trim();

    // мелкая санитация/валидация результата
    const sanitize = (arr) => {
        const ALLOWED_LAYERS = new Set([
            "E2E Tests",
            "Integration frontend Tests", "Integration backend Tests",
            "Unit frontend Tests", "Unit backend Tests"
        ]);
        const trimText = (s, n = 1200) => String(s ?? '').trim().slice(0, n);
        const allowedCodeSet = new Set(allowedCodes);
        return (arr || [])
            .filter(x => x && typeof x === 'object')
            .map(x => {
                const steps = Array.isArray(x.steps) ? x.steps.map(s => trimText(s, 600)).slice(0, 40) : [];
                const tags = Array.isArray(x.tags) ? Array.from(new Set(x.tags.map(t => String(t).trim()).filter(Boolean))) : [];
                const layer = ALLOWED_LAYERS.has(x.layer) ? x.layer : null;

                const codeRaw = trimText(x.code, 200);
                const code = allowedCodeSet.has(codeRaw) ? codeRaw : undefined; // ← важно

                return {
                    feature: trimText(x.feature, 300),
                    story: trimText(x.story, 300),
                    scenario: trimText(x.scenario, 400),
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

    try {
        const tools = [buildSubmitCasesTool(allowedCodes)];

        const ai = await callWithBackoff(
            OPENROUTER_URL,
            [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "submit_cases" } },
                temperature: 0.25,
                top_p: 0.9
            }
        );

        // 1) Основной путь — tool call
        let args = extractToolArgs(ai, "submit_cases");
        let cases;

        if (args && Array.isArray(args.cases)) {
            cases = args.cases;
        } else {
            // 2) Фолбэк на «сырой» JSON из content
            const content = ai.choices?.[0]?.message?.content || '';
            const rawJsonCandidate = extractJsonArray(content);
            if (!rawJsonCandidate) throw new Error('Не удалось найти JSON-массив в ответе AI');
            const jsonText = cleanupJsonText(rawJsonCandidate);
            let parsed = JSON5.parse(jsonText);
            if (!Array.isArray(parsed)) throw new Error('AI вернул не массив');
            cases = parsed;
        }

        return res.json({ cases: sanitize(cases) });
    } catch (err) {
        console.error('Ошибка в /api/generate-test-cases:', err);
        res.status(500).json({ error: err.message });
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
    const { requirements } = req.body;
    if (!requirements || typeof requirements !== 'string') {
        return res.status(400).json({ error: 'Поле "requirements" обязательно и должно быть строкой' });
    }
    const SYSTEM_PROMPT = `
Ты — выдающийся QA-архитектор с исключительным талантом к синтезу и декомпозиции. Твоя главная сила — видеть за разрозненными требованиями целостную картину и ценность для пользователя.

## 1. Цель
Создать иерархическую тестовую модель (Feature → Story → Scenario → Code) на основе предоставленных требований.

## 2. Ключевой принцип декомпозиции (САМОЕ ВАЖНОЕ!)
- **Сначала Синтез, потом Анализ.** Прочитай ВСЕ требования. Твоя первая задача — определить 1-3 **высокоуровневых пользовательских потока (Story)**, которые приносят конечную ценность.
- **Ценность важнее действия.** Story — это то, **зачем** пользователь пришел (например, «Ввести и проверить реквизиты»), а не то, **как** он это делает («Вставить из буфера»).
- **НЕ СОЗДАВАЙ** новую Story для каждого "Целевого действия" или "Вида сценария" из текста требований. Это всего лишь шаги (Scenarios) внутри одной большой Story.

## 3. Структура дерева (строго соблюдать)
- **Feature (Фича):** Большой независимый блок продукта.
  • Если требования описывают единственный блок — генерировать ровно один Feature и вложить в него все Stories.
- **Story (C1-E2E):** **Целостный пользовательский сценарий, приносящий ценность.** Формулируется как завершенное действие.
  • Пример: «Ввести и валидировать реквизиты в поле», «Настроить виджет в конструкторе».
  • **НЕ дробить** на отдельные случаи ввода (ввод с клавиатуры, вставка из буфера, очистка — это всё Scenarios внутри одной Story).
- **Scenario (C2–C3-Integration):** **Атомарное ДЕЙСТВИЕ пользователя** внутри Story, формулируется инфинитивом.
  • Пример: «Ввести символы вручную», «Вставить номер из буфера», «Очистить поле», «Выбрать режим 'карта'».
  • Не описывать здесь поведение системы.
- **Code (C4-Unit):** **РЕАКЦИЯ системы** на действие пользователя, описываемое инфинитивом.
  • Пример: «Применить маску ввода», «Отобразить иконку платежной системы», «Рассчитать контрольную сумму», «Отправить API запрос».
  • **Не использовать** слово «Проверка» или «Проверить».

## 4. Формат вывода (обязательно)
Выход — **ТОЛЬКО** чистый JSON-массив без комментариев и markdown. ❗️ Строго: выводи **только** JSON-массив, без лишних пробелов внутри строк, без комментариев и без markdown.  
Все ключи и строки должны быть в кавычках, между элементами — запятые. 
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

## 5. Пример для понимания логики
**Feature:** «Управление виджетами»
**Story:** «Добавить новый виджет» (Это целостный поток, дающий ценность — новый виджет в системе)
  - **Scenarios:** (Это атомарные шаги пользователя для достижения цели)
    - «Открыть форму создания»
    - «Заполнить поле 'Название'»
    - «Выбрать тип виджета»
    - «Нажать кнопку 'Сохранить'»
  - **Code:** (Это реакции системы на последнее действие 'Нажать кнопку')
    - «Отправить POST-запрос на /api/widgets»
    - «Отобразить уведомление об успехе»
    - «Закрыть форму создания»

## 6. Входные данные: Требования к продукту
${requirements}

## 7. Задание
Основываясь на **ключевом принципе декомпозиции (п.2)** и всех правилах, проанализируй требования и сгенерируй тестовую модель в формате JSON. Ответ — **только** чистый JSON. Обязательно тестовая модель только на русском языке
`.trim();


    try {
        const tools = [buildSubmitModelTool()];
        const ai = await callWithBackoff(
            OPENROUTER_URL,
            [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: requirements }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "submit_test_model" } },
                temperature: 0.3,
                top_p: 0.9
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

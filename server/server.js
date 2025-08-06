import express from 'express';
import cors from 'cors';
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
const PORT = 5001;
const upload = multer({
    limits: {
        fileSize: 50 * 1024 * 1024,
        files: 20
    }
});

/*
const corsOptions = {
    origin: 'https://test-inspector.abanking.ru',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
*/

//app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
//app.options('*', cors(corsOptions));
app.use(cors());
app.options('*', cors());
const limit = pLimit(100);


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

        // 1) Справочники из Jira
        const options = await fetchJiraMeta(pat, projectKey);
        const { Severity: sevOptions, Platform: platOptions, Symptom: sympOptions } = options;

        // 2) Построим карту кода→ID
        const platMap = buildPlatformMap(platOptions);

        // 3) Определим коды окружения
        const codes = detectPlatforms(summary, env);

        // 4) Откорректируем «M» по env: если только мобильная и нет других кодов
        let platformIds = [];
        if (codes.length === 1 && codes[0] === 'M') {
            const txt = (env || '').toLowerCase();
            // Ищем в platOptions именно «Native-Android» или «Native-IOS»
            if (txt.includes('android')) {
                const opt = platOptions.find(o => o.name.toLowerCase().includes('native-android'));
                if (opt) platformIds = [opt.id];
            } else if (txt.includes('ios')) {
                const opt = platOptions.find(o => o.name.toLowerCase().includes('native-ios'));
                if (opt) platformIds = [opt.id];
            }
            // По умолчанию — Android
            if (platformIds.length === 0) {
                const opt = platOptions.find(o => o.name.toLowerCase().includes('native-android'));
                if (opt) platformIds = [opt.id];
            }
        } else {
            // Обычное кодовое мапирование
            platformIds = codes.map(c => platMap[c]).filter(Boolean);
        }

        const prompt = `
Ты — эксперт по баг‑репортам. Твоя задача — на основании переданных полей выбрать наиболее подходящие значения severity, platform и symptom, а также сгенерировать actual и expected результаты.

**Документация по классификации Severity (тип задачи: Ошибка кода):**
Серьезность дефекта указывается один раз при заведении задачи и потом может менять только Lead of QA.  
- **Критическая (critical)**  
  Массовая блокировка ключевого функционала, потеря данных, утечка конфиденциальной информации.  
  Примеры:
  - Потеря паспортных данных клиента при подписании.
  - Не работает авторизация клиента.
  - Не проходит оплата на экране эквайринга.
- **Высокая (major)**  
  Ощутимые неудобства многим пользователям.  
  Примеры:
  - Перезапуск приложения при типичных сценариях.
  - Разлогин каждые 5 минут.
- **Средняя (medium)**  
  Слабое влияние на работу, есть обходные пути.  
  Примеры:
  - Диалоговое окно не закрывается автоматически.
  - Перепутаны направления сортировки.
- **Низкая (minor)**  
  Редко обнаруживается, не влияет на основные сценарии.  
  Примеры:
  - Опечатка в глубоко вложенном меню.
  - Неточно отображается время копирования.

**Документация по классификации Symptom:**
Позволяет классифицировать дефекты по их проявлению (black/grey box) и управлять приоритетом.  
Типы симптомов:
- **Вёрстка** — расхождение интерфейса с макетами.
- **Повреждение/потеря данных** — дефект искажает или уничтожает данные.
- **Проблема инсталляции** — не собирается сборка или стенд.
- **Нереализованная функциональность** — часть функционала не реализована.
- **Краш приложения** — полная остановка или блокировка функционала.
- **Расхождение с требованиями** — поведение не по спецификации.
- **Ошибка локализации/в тексте** — орфография, пунктуация, перевод.
- **Некорректное/неожиданное поведение** — отклонение от неявных требований.
- **Сбой под нагрузкой** — HTTP‑ошибки, деградация SLA.
- **Безопасность** — уязвимости, XSS, SQL‑инъекции и т.п.

Верни **чистый JSON** со структурой:
\`\`\`json
{
  "actual": "...",
  "expected": "...",
  "severity": "<одно из: ${sevOptions.map(x => x.name).join(', ')}>",
  "platform": [${platOptions.map(x => `"${x.name}"`).join(', ')}],
  "symptom": [${sympOptions.map(x => `"${x.name}"`).join(', ')}]
}
\`\`\`

Данные для анализа:
\`\`\`
SUMMARY: ${summary}
DESCRIPTION: ${description}
STEPS: ${steps}
STAND: ${stand}
ENV: ${env}
\`\`\`
        `;

        // 6) Обращаемся к OpenRouter / OpenAI…
        const aiJson = await callWithBackoff(OPENROUTER_URL, prompt, config.openRouterAiKey);

        // 7) Парсим JSON из ответа
        const content = aiJson.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI не вернул JSON');
        const parsed = JSON.parse(match[0]);

        // 8) Ищем ID для severity и symptom
        const severityId = sevOptions.find(o =>
            o.name.toLowerCase() === parsed.severity.toLowerCase()
        )?.id || null;

        const symptomIds = sympOptions
            .filter(o => parsed.symptom.map(s => s.toLowerCase()).includes(o.name.toLowerCase()))
            .map(o => o.id);

        // 9) Возвращаем итог
        return res.json({
            actual: parsed.actual,
            expected: parsed.expected,
            severity: severityId,
            platform: platformIds,
            symptom: symptomIds
        });
    } catch (e) {
        console.error('AI fill error:', e);
        return res.status(500).json({ error: e.message });
    }
});

//
// Универсальная функция для повторных попыток при 5xx,
// принимающая либо строку prompt, либо массив сообщений {role, content}
//
async function callWithBackoff(url, promptOrMessages, apiKey) {
    const maxAttempts = 3;
    let attempt = 0;
    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

    while (attempt < maxAttempts) {
        attempt++;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'deepseek/deepseek-chat-v3-0324:free',
                messages: messages
            })
        });

        if (resp.ok) {
            return await resp.json();
        }

        if (resp.status >= 500 && resp.status < 600 && attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
        }
        const text = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${text}`);
    }

    // Если все попытки исчерпаны без успеха
    throw new Error('OpenRouter: превышено максимальное число попыток');
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
    const { requirements, modelStructure } = req.body;
    if (!Array.isArray(requirements) || !modelStructure) {
        return res.status(400).json({ error: 'requirements и modelStructure обязательны' });
    }

    // 1. Не меняем исходный промт — выносим его в system
    const SYSTEM_PROMPT = `
Ты — опытный QA-инженер, специализирующийся на разработке тестовой документации. Твоя задача — на основе предоставленной тест-модели и требований сгенерировать полный JSON-массив тест-кейсов, строго следуя Style Guide и принципам «пирамиды тестирования».

## 1. Мы используем сценарный подход с четкой иерархией:
- **Feature (Фича):** Крупный блок продукта. (Из дерева модели)
- **Story (Пользовательский сценарий, C1 - E2E):** Полный путь пользователя для достижения цели. (Из дерева модели)
- **Scenario (Подсценарий, C2-C3 - Integration):** Атомарный шаг или логическая часть внутри Story. (Из дерева модели)
- **Code (C4 - Unit):** Проверка на уровне кода, не используется в этой генерации.

## 2. Философия «пирамиды»
1. **Сдвигаем проверки вниз**  
   - Всё, что можно надёжно покрыть интеграционно (валидация поля, проверка API-контракта, классы эквивалентности, граничные значения), выносим в Integration.  
   - **E2E (C1) оставляем только**:  
     - полную «чёрную» happy-path от авторизации до финального результата,  
     - 1–2 ключевых негативных блока (отказ/прерывание) и альтернативный поток.
     - Должна иметь feature и story  
   - **Удалить из E2E** все подробные проверки форматов полей — такие проверки уходят в integration.  
2. **E2E (C1)**  
   - **Обязательно** первые шаги:  
     1. «Авторизоваться»  
     2. «Перейти на …» и т. д.  
   - Не повторять атомарные проверки полей в E2E.  
3. **Integration (C2–C3)**  
   - Начинается с **инициализации**: «Замокать/смонтировать компонент», «Выполнить API-запрос».  
   - Один тест = одна атомарная проверка + единый \`expected\`.  
   - **Integration не ездит по страницам** — изоляция компонента или API-вызова.  
   - Теги для фронта: D/A/M/PWA, для бэка: S.
   - Должна иметь feature и story и scenario
   - ОБЯЗАТЕЛЬНО включать поле "scenario": точный текст узла Scenario из модели.   

## 3. Формат
Выход — **только** JSON-массив без обёрток:
\`\`\`json
[
  {
    "feature": "...",
    "story": "...",
    "scenario": "...",              // Если тест integration
    "title": "...",
    "precondition": "...",          // опционально, для integration: инициализация или мок
    "steps": ["Авторизоваться", …], // E2E: всегда начинается с Авторизоваться
    "expected": "...",
    "tags": ["D","PWA"],            // front: D/A/M/PWA, back: S
    "layer": "E2E Tests",           // или "Integration frontend Tests"/"Integration backend Tests"
    "priority": "High"              // опционально
  }
]
\`\`\`

## 4. Генерация
1. Для **каждой Story**  
   - Сгенерировать минимум 2–3 E2E-теста:
     1. Позитивный путь (авторизация → полная happy-flow)  
     2. Один ключевой негативный отказ (ошибка API или прерывание)  
     3. Альтернативный поток (например rollback или отмена).  
2. Для **каждого Scenario**  
   - Сгенерировать набор интеграционных тестов (минимум 3–5 шт.):
     - Позитивный (валидные данные)  
     - Негативный (невалидный формат, пустое, превышение лимита)  
     - Контрактное (status codes, error payload)
     - **Каждый Integration-тест ОБЯЗАТЕЛЬНО** имеет поле "scenario" со значением из modelStructure  
   - В \`precondition\` описать мок/инициализацию.  
   - Шаги — только «Выполнить запрос» или «Смонтировать компонент и вызвать метод».  

## 5. Входные данные
**Модель:**
\${JSON.stringify(modelStructure, null, 2)}

**Требования:**
\${requirements.map((r, i) => \`\${i + 1}. \${r}\`).join('\\n')}

## 6. Тест-дизайн
- Использовать классы эквивалентности и BVA (Boundary Value Analysis).  
- Формировать decision-tables и state-transition tests.  
- Применять pairwise / orthogonal массивы для комбинаций данных.  
- Выполнять error-guessing на основе бизнес-правил.   

## 7. Дополнительные паттерны
- Проверять REST-контракты: content-type, schema, CORS, error payload.  
- Покрывать асинхронные UI-виджеты (тайм-ау́ты, retry-механизмы).  
- Применять чек-листы из лучших статей по QA (например, Куликова).  

Тесты должны быть только на русском языке.
`;

    // 2. Передаём модель и требования отдельно в user
    const userPrompt = `
Сгенерируй JSON-массив тест-кейсов на русском языке.

Модель:
${JSON.stringify(modelStructure, null, 2)}

Требования:
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}
`;

    try {
        // Отправляем в OpenRouter / OpenAI двумя сообщениями
        const ai = await callWithBackoff(
            OPENROUTER_URL,
            [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            config.openRouterAiKey
        );

        const content = ai.choices?.[0]?.message?.content || '';

        // Парсим JSON как раньше
        let jsonText = null;
        const jsonFence = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonFence) {
            jsonText = jsonFence[1];
        } else {
            const arrMatch = content.match(/(\[[\s\S]*\])/);
            if (arrMatch) {
                jsonText = arrMatch[1];
            }
        }

        if (!jsonText) {
            throw new Error('AI не вернул JSON-массив в ожидаемом формате');
        }

        // Обрезаем лишние запятые и парсим
        jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');
        const cases = JSON.parse(jsonText);

        res.json({ cases });
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
    const prompt = `
Ты — выдающийся QA-архитектор, мастер декомпозиции требований. Твоя задача — проанализировать предоставленные требования к продукту и создать исчерпывающую, иерархическую тестовую модель.

## 1. Цель
Создать структуру для тестовой документации, которая позволит точно оценивать тестовое покрытие, декомпозировать тесты и визуализировать их.

## 2. Структура дерева (Обязательный формат)
Ты должен строго следовать этой иерархии:
- **Feature (Фича / Блок продукта):** Крупный, независимый блок функциональности.
  - **Story (Пользовательский сценарий - C1 - E2E):** Полный путь пользователя для достижения конкретной цели. Описывает "что" пользователь хочет сделать.
    - **Scenario (Подсценарий / шаг сценария - C2-C3 - Integration):** Атомарный шаг, действие или логическая часть внутри Story. Описывает "как" пользователь это делает.
## Структура и поля (ОБЯЗАТЕЛЬНО К СОБЛЮДЕНИЮ)
Ты должен сгенерировать JSON-массив. Каждый объект в массиве представляет собой "Feature" и должен иметь следующую структуру:
{
  "text": "Название фичи",
  "stories": [
    {
      "text": "Название пользовательской истории (Story)",
      "scenarios": [
        { "text": "Текст первого сценария (Scenario)" },
        { "text": "Текст второго сценария (Scenario)" }
      ]
    }
  ]
}
## 3. Правила декомпозиции
- **Будь исчерпывающим:** Продумай позитивные (happy path), негативные и граничные сценарии на основе требований.
- **Логическая группировка:** Сгруппируй связанные пользовательские сценарии (Story) под одной общей фичей (Feature).
- **Атомарность:** Каждый \`Scenario\` должен представлять собой одно логическое действие или проверку.
- **Тестовая модель должна описывать функциональную логику:** Нефункциональное нужно отбрасывать и делать тестовую модель так, чтобы она была максимальна коротка и максимально описывала test coverage.

## Пример: 
Feature - "Авторизация и регистрация";
Story - "Регистрация пользователя"
Scenario - "Ввести номер телефона", "Ввести email", "Прожать чекбоксы согласия", "Нажать кнопку 'Зарегистрироваться'"

## 4. Входные данные: Требования к продукту
${requirements}

## 5. Задание и формат вывода
Проанализируй приведённые выше требования и сгенерируй тестовую модель.
Твой ответ должен быть **ТОЛЬКО чистым JSON-массивом** без каких-либо пояснений, комментариев или markdown-обёрток.
`;

    try {
        const ai = await callWithBackoff(OPENROUTER_URL, prompt, config.openRouterAiKey);
        let content = ai.choices?.[0]?.message?.content?.trim();

        // --- ОТЛАДКА ---
        console.log("--- 1. СЫРОЙ ОТВЕТ ОТ AI ---");
        console.log(content);
        // -----------------

        if (!content) {
            throw new Error('AI не вернул содержимого');
        }

        if (content.startsWith('```')) {
            content = content.replace(/^```json\s*|\s*```$/g, '');
        }

        let parsedJson;
        try {
            parsedJson = JSON.parse(content);
        } catch (parseErr) {
            console.error('ОШИБКА ПАРСИНГА JSON:', parseErr.message);
            throw new Error('Не удалось распарсить JSON от AI');
        }

        // --- ОТЛАДКА ---
        console.log("--- 2. JSON ПОСЛЕ ПАРСИНГА ---");
        console.log(JSON.stringify(parsedJson, null, 2));
        // -----------------

        // Проверяем, вернул ли AI уже вложенную структуру или старую плоскую.
        const isFlat = parsedJson.length > 0 && parsedJson[0].hasOwnProperty('Feature');

        // --- ОТЛАДКА ---
        console.log(`--- 3. РЕЗУЛЬТАТ ПРОВЕРКИ isFlat: ${isFlat} ---`);
        // -----------------

        const finalModel = isFlat ? transformToHierarchy(parsedJson) : parsedJson;

        // --- ОТЛАДКА ---
        console.log("--- 4. ФИНАЛЬНАЯ МОДЕЛЬ ДЛЯ ОТПРАВКИ ---");
        console.log(JSON.stringify(finalModel, null, 2));
        // -----------------

        return res.status(200).json(finalModel);

    } catch (err) {
        console.error('ГЛОБАЛЬНАЯ ОШИБКА в /api/generate-test-model:', err);
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
        const cfKeyToId = schema.reduce((m, e) => {
            m[e.key] = e.customField.id;
            return m;
        }, {});

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
            if (c.jiraIssueOption?.value) {
                const integrationId = c.jiraIssueOption.integrationId || config.defaultJiraIntegrationId;
                await linkIssueToTestCase(
                    testCaseId,
                    integrationId,
                    c.jiraIssueOption.value
                );
            }

            // 10) Слой
            if (c.layer && layerMap[c.layer] != null) {
                await setTestCaseLayer(testCaseId, layerMap[c.layer]);
            }

            // 11) Кастомные поля
            const cfv = [];
            if (c.feature && cfKeyToId.feature) {
                cfv.push({ customField: { id: cfKeyToId.feature }, name: c.feature });
            }
            if (c.story && cfKeyToId.story) {
                cfv.push({ customField: { id: cfKeyToId.story }, name: c.story });
            }
            if (c.scenario && cfKeyToId.scenario) {
                cfv.push({ customField: { id: cfKeyToId.scenario }, name: c.scenario });
            }
            if (c.version && cfKeyToId.version) {
                cfv.push({ customField: { id: cfKeyToId.version }, name: c.version });
            }
            if (c.priority && cfKeyToId.priority) {
                cfv.push({ customField: { id: cfKeyToId.priority }, name: c.priority });
            }
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

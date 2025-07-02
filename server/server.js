import express from 'express';
import cors from 'cors';
import { getAllTestCases, getTestCaseOverview, getTestCaseExpectedResult, getTestCaseLayer, getCaseIssue, getCaseTags, getTestCasePrecondition, getTestCaseStatus, getTestCaseSteps, getTestCaseCustomFields } from './http-service.mjs';
import { spinningLoader } from './spinning-loader.mjs';
import pLimit from 'p-limit';
import { formatTestCase } from './format-testcase.mjs';
import { formatTestCaseAsJson } from './generate-json.mjs';
import { staticAnalysis } from './static-analysis.mjs';
import { exportStructureAllure } from './xmind-parce/export-structure-allure.mjs';
import { analyzeTestCaseWithAI } from './ai-testcase.mjs';
import { fetchConfluencePage } from './confluenceFetcher.mjs';
import { analyzeRequirementWithAI } from './analyzeRequirementWithAI.mjs';

//const PROJECT_ID = config.projectId;
//const JIRA_ISSUE = config.jiraIssue; 

const app = express();
const PORT = 5001;

// Настройка CORS
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Ограничение на количество параллельных запросов
const limit = pLimit(100);

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

app.post('/ai-recommendation', async (req, res) => {
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
app.post('/analyze/solution', async (req, res) => {
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
app.post('/jira/create-issue', async (req, res) => {
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
app.post('/jira/meta', async (req, res) => {
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
app.get('/jira/users', async (req, res) => {
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
app.get('/jira/versions', async (req, res) => {
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
app.get('/jira/transitions', async (req, res) => {
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

app.post('/jira/transition-issues', async (req, res) => {
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

    // дальше — ваш код
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




// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

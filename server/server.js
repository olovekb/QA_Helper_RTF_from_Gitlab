import express from 'express';
import cors from 'cors';
import { getAllTestCases, getTestCaseExpectedResult, getTestCaseLayer, getCaseIssue, getCaseTags, getTestCasePrecondition, getTestCaseStatus, getTestCaseSteps, getTestCaseCustomFields } from './http-service.mjs';
import { spinningLoader } from './spinning-loader.mjs';
import config from './config.json' assert { type: 'json' };
import pLimit from 'p-limit';
import { formatTestCase } from './format-testcase.mjs';
import { formatTestCaseAsJson } from './generate-json.mjs';
import { staticAnalysis } from './static-analysis.mjs';

//const PROJECT_ID = config.projectId;
//const JIRA_ISSUE = config.jiraIssue;

const app = express();
const PORT = 5000;

// Настройка CORS
app.use(cors());
app.use(express.json());

// Ограничение на количество параллельных запросов
const limit = pLimit(100);

// Функция фильтрации тест-кейсов
async function filterCases(allCases, jiraIssue, projectId) {
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
        const htmlReport = await staticAnalysis(jsonResult); // Генерация анализа

        // Возвращаем форматированный результат в ответе
        res.json(htmlReport);

    } catch (error) {
        console.error(`Ошибка: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

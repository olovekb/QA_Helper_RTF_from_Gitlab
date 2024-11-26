import {
  getAllTestCases,
  getTestCaseExpectedResult,
  getTestCaseLayer,
  getCaseIssue,
  getCaseTags,
  getTestCasePrecondition,
  getTestCaseStatus,
  getTestCaseSteps,
  getTestCaseCustomFields
} from "./http-service.mjs";
import { spinningLoader } from './spinning-loader.mjs'
import config from './config.json' assert { type: 'json' };
import pLimit from "p-limit";
import { formatTestCase } from './format-testcase.mjs'
import { formatTestCaseAsJson } from './generate-json.mjs'
import { staticAnalysis } from './static-analysis.mjs'


const PROJECT_ID = config.projectId;
const JIRA_ISSUE = config.jiraIssue;

/**
 * Функция фильтрации тест-кейсов по связям с задачей Jira
 * @param {*} allCases - результат функции getAllTestCases
 * @returns filteredCases - отфильтрованные по условиям набор тест-кейсов
 */
const limit = pLimit(100); // Ограничиваем количество параллельных запросов до 10

async function filterCases(allCases) {
  const filteredCases = [];

  const promises = allCases.map((testCase) =>
    limit(async () => {
      const { id, name } = testCase;

      // Условие: Связь с Jira
      const issue = await getCaseIssue(id);
      if (!issue.some(issue => issue.name === `${JIRA_ISSUE}`)) {
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
        getTestCaseCustomFields(id, PROJECT_ID)
      ]);
      filteredCases.push({ id, name, issue, tags, steps, expectedResult, layer, status, precondition, customFields });
    })
  );

  // Ждем завершения всех промисов
  await Promise.all(promises);

  return filteredCases.filter(caseItem => caseItem !== undefined);
}
// Основная функция
async function main() {
  try {
    let spinnerInterval = spinningLoader('Получение всех тест-кейсов проекта...');
    const allCases = await getAllTestCases(PROJECT_ID);
    clearInterval(spinnerInterval);
    console.log(`Всего кейсов в проекте: ${allCases.length}`);
    // Запускаем анимацию перед фильтрацией
    spinnerInterval = spinningLoader(`Фильтрация тест-кейсов по задаче ${JIRA_ISSUE}...`);
    const filteredCases = await filterCases(allCases);
    clearInterval(spinnerInterval);
    console.log(`Отсортированные тест-кейсы по выбранной задаче Jira: ${filteredCases.length}`);

    // Вывод результатов
    let result = '';
    let jsonResult = [];
    for (const caseItem of filteredCases) {
      result += await formatTestCase(caseItem);
      jsonResult.push(await formatTestCaseAsJson(caseItem)); // Ждём результат от каждой функции
    }
    console.log(result);
    await staticAnalysis(jsonResult)

  } catch (error) {
    console.error(`Ошибка: ${error.message}`);
  }
}

main();

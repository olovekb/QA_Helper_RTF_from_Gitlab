import databasePool from './db/pool.js';

/**
 * Сохранение результатов статанализа в БД.
 * @param projectId - ID проекта в ТестОпсе
 * @param jiraIssue - номер задачи в Jira
 * @param metadata - { testCasesWithIssues: [{ testCaseId, issues: [{ title, message, severity, category }] }] }
 */
export async function saveAnalysisResults (projectId, jiraIssue, metadata)
{
  if (!metadata?.testCasesWithIssues?.length) return;

  const trx = await databasePool.transaction();
  try {
    const [run] = await trx('static_analysis_runs').insert({
      project_id: projectId,
      jira_issue: jiraIssue
    }).returning('id');

    const runId = run.id;
    const issuesToInsert = [];

    for (const { testCaseId, issues } of metadata.testCasesWithIssues) {
      if (!issues?.length) continue;
      for (const issue of issues) {
        issuesToInsert.push({
          run_id: runId,
          test_case_id: String(testCaseId),
          title: issue.title || null,
          message: issue.message || '',
          severity: issue.severity || 'warning',
          category: issue.category || 'other'
        });
      }
    }

    if (issuesToInsert.length > 0) {
      await trx('static_analysis_issues').insert(issuesToInsert);
    }

    await trx.commit();
    console.log(`[static-analysis-db] Сохранено: run ${runId}, ${issuesToInsert.length} issues для ${jiraIssue}`);
  } catch (err) {
    await trx.rollback();
    console.error('[static-analysis-db] Ошибка сохранения:', err.message);
    throw err;
  }
}

/**
 * Возвращает последние замечания ИИ по задаче
 * @param jiraIssue - номер задачи
 */
export async function getLatestIssuesByJiraIssue (jiraIssue)
{
  const run = await databasePool('static_analysis_runs')
    .where('jira_issue', jiraIssue)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();

  if (!run) return null;

  const rows = await databasePool('static_analysis_issues')
    .where('run_id', run.id)
    .select('test_case_id', 'title', 'message', 'severity', 'category');

  const issuesByTestCase = new Map();
  const idsWithIssues = new Set();

  for (const row of rows) {
    const tcId = String(row.test_case_id);
    idsWithIssues.add(tcId);
    if (!issuesByTestCase.has(tcId)) {
      issuesByTestCase.set(tcId, []);
    }
    issuesByTestCase.get(tcId).push({
      title: row.title,
      message: row.message,
      severity: row.severity,
      category: row.category
    });
  }

  if (idsWithIssues.size === 0) return null;

  return { issuesByTestCase, idsWithIssues };
}

/**
 * Возвращает информацию о времени последнего ревью задачи
 * @param jiraIssue - номер задачи
 */
export async function getLatestRunInfo (jiraIssue)
{
  const run = await databasePool('static_analysis_runs')
    .where('jira_issue', jiraIssue)
    .select('created_at')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();

  if (!run?.created_at) return null;
  return { createdAt: run.created_at };
}

/**
 * Удаляет все результаты анализа по задаче
 * @param jiraIssue - номер задачи
 */
export async function deleteAnalysisResultsByJiraIssue (jiraIssue)
{
  const deleted = await databasePool('static_analysis_runs')
    .where('jira_issue', jiraIssue)
    .del();

  if (deleted > 0) {
    console.log(`[static-analysis-db] Удалено ${deleted} run(s) для ${jiraIssue}`);
  }
}

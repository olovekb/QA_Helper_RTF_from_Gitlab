import databasePool from './db/pool.js';

/**
 * Сохранение результатов статанализа в БД.
 * @param projectId - ID проекта в ТестОпсе
 * @param jiraIssue - номер задачи в Jira
 * @param metadata - { testCasesWithIssues, cleanTestCaseIds?: string[] }
 */
export async function saveAnalysisResults (projectId, jiraIssue, metadata)
{
  const cleanTestCaseIds = Array.isArray(metadata?.cleanTestCaseIds)
    ? metadata.cleanTestCaseIds.map((id) => String(id))
    : [];

  const trx = await databasePool.transaction();
  try {
    const [run] = await trx('static_analysis_runs').insert({
      project_id: projectId,
      jira_issue: jiraIssue,
      clean_test_case_ids: trx.raw('?::jsonb', [JSON.stringify(cleanTestCaseIds)])
    }).returning('id');

    const runId = run.id;
    const issuesToInsert = [];

    for (const { testCaseId, issues } of metadata.testCasesWithIssues || []) {
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
    console.log(`[static-analysis-db] Сохранено: run ${runId}, ${issuesToInsert.length} issues, clean_ids=${cleanTestCaseIds.length} для ${jiraIssue}`);
  } catch (err) {
    await trx.rollback();
    console.error('[static-analysis-db] Ошибка сохранения:', err.message);
    throw err;
  }
}

/**
 * Возвращает последний прогон анализа ТК по задаче: замечания ИИ и id кейсов без замечаний
 * @param jiraIssue - номер задачи
 */
export async function getLatestIssuesByJiraIssue (jiraIssue)
{
  const run = await databasePool('static_analysis_runs')
    .where('jira_issue', jiraIssue)
    .select('id', 'clean_test_case_ids')
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

  const rawClean = run.clean_test_case_ids;
  const cleanTestCaseIds = new Set(
    Array.isArray(rawClean) ? rawClean.map((id) => String(id)) : []
  );

  return { issuesByTestCase, idsWithIssues, cleanTestCaseIds };
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

const DELETE_ANALYSIS_TABLE = {
  cases: 'static_analysis_runs',
  model: 'static_analysis_model_runs'
};

/**
 * Удаляет все прогоны анализа по задаче Jira.
 * @param jiraIssue - номер задачи
 * @param analysisType - 'cases' | 'model'
 */
export async function deleteAnalysisResultsByJiraIssue (jiraIssue, analysisType)
{
  const type = String(analysisType || '').trim().toLowerCase();
  const table = DELETE_ANALYSIS_TABLE[type];
  if (!table) {
    throw new Error(`Неизвестный analysisType: ${analysisType}`);
  }

  const deleted = await databasePool(table)
    .where('jira_issue', jiraIssue)
    .del();

  if (deleted > 0) {
    const label = type === 'model' ? 'model run(s)' : 'cases run(s)';
    console.log(`[static-analysis-db] Удалено ${deleted} ${label} для ${jiraIssue}`);
  }
}

const MODEL_ISSUE_FALLBACK_RE = /^Произошла ошибка при AI-анализе|^Ошибка парсинга AI ответа/i;

function isModelIssueReal (rec)
{
  const msg = rec?.recommendation || rec?.message || '';
  return msg && !MODEL_ISSUE_FALLBACK_RE.test(String(msg));
}

/**
 * Сохранение результатов AI-анализа тестовой модели
 * @param projectId - ID проекта в ТестОпсе
 * @param jiraIssue - номер задачи Jira
 * @param modelFileName - имя файла модели
 * @param aiRecommendations - массив { title, recommendation, severity, category, ruleId, nodeName }
 */
export async function saveModelAnalysisResults (projectId, jiraIssue, modelFileName, aiRecommendations)
{
  const jiraTrim = typeof jiraIssue === 'string' && jiraIssue.trim() ? jiraIssue.trim() : null;
  if (!Array.isArray(aiRecommendations) || aiRecommendations.length === 0) return;

  const rows = aiRecommendations.filter(isModelIssueReal).map((r) => ({
    title: r.title || null,
    message: String(r.recommendation || r.message || ''),
    severity: r.severity === 'error' ? 'error' : 'warning',
    category: r.category || 'other',
    rule_id: r.ruleId != null && String(r.ruleId).trim() !== '' ? String(r.ruleId).trim() : null,
    node_name: r.nodeName != null && String(r.nodeName).trim() !== '' ? String(r.nodeName).trim() : null
  }));

  if (rows.length === 0) return;

  const trx = await databasePool.transaction();
  try {
    const [run] = await trx('static_analysis_model_runs').insert({
      project_id: projectId,
      jira_issue: jiraTrim,
      model_file_name: modelFileName && String(modelFileName).trim() ? String(modelFileName).trim().slice(0, 512) : null
    }).returning('id');

    const runId = run.id;
    const issuesToInsert = rows.map((row) => ({
      run_id: runId,
      title: row.title,
      message: row.message,
      severity: row.severity,
      category: row.category,
      rule_id: row.rule_id,
      node_name: row.node_name
    }));

    await trx('static_analysis_model_issues').insert(issuesToInsert);
    await trx.commit();
    console.log(`[static-analysis-db] Модель: сохранен run ${runId}, ${issuesToInsert.length} замечаний (project=${projectId}, jira=${jiraTrim})`);
  } catch (err) {
    await trx.rollback();
    console.error('[static-analysis-db] Ошибка сохранения анализа модели:', err.message);
    throw err;
  }
}

/**
 * Последний прогон анализа модели по задаче Jira
 */
export async function getLatestModelRunInfo (jiraIssue)
{
  const run = await databasePool('static_analysis_model_runs')
    .where('jira_issue', jiraIssue)
    .select('created_at')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();

  if (!run?.created_at) return null;
  return { createdAt: run.created_at };
}

/**
 * Все замечания последнего прогона анализа модели
 */
export async function getLatestModelIssuesForRecheck (projectId, jiraIssue = null)
{
  const jiraTrim = typeof jiraIssue === 'string' && jiraIssue.trim() ? jiraIssue.trim() : null;
  if (!jiraTrim) return null;

  const run = await databasePool('static_analysis_model_runs')
    .where('project_id', String(projectId))
    .where('jira_issue', jiraTrim)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();
  if (!run) return null;

  const rows = await databasePool('static_analysis_model_issues')
    .where('run_id', run.id)
    .select('title', 'message', 'severity', 'category', 'rule_id', 'node_name')
    .orderBy('id', 'asc');

  if (rows.length === 0) return null;

  return {
    runId: run.id,
    issues: rows.map((r) => ({
      title: r.title,
      message: r.message,
      severity: r.severity,
      category: r.category,
      ruleId: r.rule_id != null ? String(r.rule_id) : '',
      nodeName: r.node_name != null && String(r.node_name).trim() !== '' ? String(r.node_name) : 'Общее'
    }))
  };
}

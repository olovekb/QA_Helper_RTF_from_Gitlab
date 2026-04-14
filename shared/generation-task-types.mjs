export const GENERATION_TASK_TYPES = Object.freeze([
  'test_cases',
  'test_model',
  'bdd_tests',
  'cleanup_duplicates',
  'qa_agent_review',
  'test_impact_analysis',
  'test_case_comparison'
]);

function toSqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildGenerationTaskTypeCheckClause(types = GENERATION_TASK_TYPES) {
  const values = types.map(toSqlStringLiteral).join(', ');
  return `CHECK (type IN (${values}))`;
}

const CURRENT_TASK_TYPES = [
  'test_cases',
  'test_model',
  'bdd_tests',
  'cleanup_duplicates',
  'test_case_comparison'
];

const PREVIOUS_TASK_TYPES = [
  'test_cases',
  'test_model',
  'bdd_tests',
  'cleanup_duplicates'
];

function buildTypeConstraint(types) {
  return `CHECK (type IN (${types.map((type) => `'${type}'`).join(', ')}))`;
}

export async function up(knex) {
  const tableExists = await knex.schema.hasTable('generation_tasks');
  if (!tableExists) {
    return;
  }

  const hasMetricsColumn = await knex.schema.hasColumn('generation_tasks', 'metrics');
  if (!hasMetricsColumn) {
    await knex.schema.alterTable('generation_tasks', (table) => {
      table.jsonb('metrics');
    });
  }

  await knex.raw('ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_type_check');
  await knex.raw(`
    ALTER TABLE generation_tasks
    ADD CONSTRAINT generation_tasks_type_check
    ${buildTypeConstraint(CURRENT_TASK_TYPES)}
  `);
}

export async function down(knex) {
  const tableExists = await knex.schema.hasTable('generation_tasks');
  if (!tableExists) {
    return;
  }

  await knex.raw('ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_type_check');
  await knex.raw(`
    ALTER TABLE generation_tasks
    ADD CONSTRAINT generation_tasks_type_check
    ${buildTypeConstraint(PREVIOUS_TASK_TYPES)}
  `);

  const hasMetricsColumn = await knex.schema.hasColumn('generation_tasks', 'metrics');
  if (hasMetricsColumn) {
    await knex.schema.alterTable('generation_tasks', (table) => {
      table.dropColumn('metrics');
    });
  }
}

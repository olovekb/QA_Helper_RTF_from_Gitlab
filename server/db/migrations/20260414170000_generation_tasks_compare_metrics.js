const LEGACY_TASK_TYPES = Object.freeze([
  'test_cases',
  'test_model',
  'bdd_tests',
  'cleanup_duplicates',
  'qa_agent_review',
  'test_impact_analysis'
]);

const GENERATION_TASK_TYPES = Object.freeze([
  ...LEGACY_TASK_TYPES,
  'test_case_comparison'
]);

function toSqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildGenerationTaskTypeCheckClause(types) {
  const values = types.map(toSqlStringLiteral).join(', ');
  return `CHECK (type IN (${values}))`;
}

async function syncGenerationTasksConstraint(knex, types) {
  await knex.raw('ALTER TABLE "generation_tasks" DROP CONSTRAINT IF EXISTS "generation_tasks_type_check"');
  await knex.raw(`
    ALTER TABLE "generation_tasks"
    ADD CONSTRAINT "generation_tasks_type_check"
    ${buildGenerationTaskTypeCheckClause(types)}
  `);
}

export async function up(knex) {
  const exists = await knex.schema.hasTable('generation_tasks');

  if (!exists) {
    await knex.schema.createTable('generation_tasks', (table) => {
      table.uuid('id').primary();
      table.string('type', 50).notNullable();
      table.string('status', 20).notNullable().defaultTo('processing');
      table.integer('progress').defaultTo(0);
      table.jsonb('input_data');
      table.jsonb('result');
      table.jsonb('metrics');
      table.text('error_message');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at').nullable();
    });
  } else {
    const hasMetricsColumn = await knex.schema.hasColumn('generation_tasks', 'metrics');
    if (!hasMetricsColumn) {
      await knex.schema.alterTable('generation_tasks', (table) => {
        table.jsonb('metrics');
      });
    }
  }

  await syncGenerationTasksConstraint(knex, GENERATION_TASK_TYPES);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status)');
}

export async function down(knex) {
  const exists = await knex.schema.hasTable('generation_tasks');
  if (!exists) {
    return;
  }

  await syncGenerationTasksConstraint(knex, LEGACY_TASK_TYPES);

  const hasMetricsColumn = await knex.schema.hasColumn('generation_tasks', 'metrics');
  if (hasMetricsColumn) {
    await knex.schema.alterTable('generation_tasks', (table) => {
      table.dropColumn('metrics');
    });
  }
}

export async function up(knex) {
  await knex.schema.createTable('static_analysis_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('project_id', 50).notNullable();
    table.string('jira_issue', 50).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('static_analysis_issues', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('run_id').notNullable().references('id').inTable('static_analysis_runs').onDelete('CASCADE');
    table.string('test_case_id', 100).notNullable();
    table.string('title', 255);
    table.text('message').notNullable();
    table.string('severity', 20).notNullable();
    table.string('category', 50);
    table.jsonb('extra');
  });

  await knex.raw(`
    CREATE INDEX idx_static_analysis_runs_jira_created ON static_analysis_runs(jira_issue, created_at DESC);
    CREATE INDEX idx_static_analysis_issues_run_id ON static_analysis_issues(run_id);
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('static_analysis_issues');
  await knex.schema.dropTableIfExists('static_analysis_runs');
}

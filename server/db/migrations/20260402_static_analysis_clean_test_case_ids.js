export async function up (knex) {
  await knex.schema.alterTable('static_analysis_runs', (table) => {
    table.jsonb('clean_test_case_ids').nullable();
  });
}

export async function down (knex) {
  await knex.schema.alterTable('static_analysis_runs', (table) => {
    table.dropColumn('clean_test_case_ids');
  });
}

export async function up (knex) {
  await knex.schema.alterTable('static_analysis_issues', (table) => {
    table.string('category', 64).alter();
  });
}

export async function down (knex) {
  await knex.schema.alterTable('static_analysis_issues', (table) => {
    table.string('category', 50).alter();
  });
}

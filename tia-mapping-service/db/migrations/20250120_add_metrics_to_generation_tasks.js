export async function up(knex) {
  await knex.schema.alterTable('generation_tasks', (table) => {
    table.jsonb('metrics').nullable(); // Метрики генерации (опционально)
  });
}

export async function down(knex) {
  await knex.schema.alterTable('generation_tasks', (table) => {
    table.dropColumn('metrics');
  });
}


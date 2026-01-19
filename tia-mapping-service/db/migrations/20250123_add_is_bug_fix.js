export async function up(knex) {
  // Добавляем поле is_bug_fix в таблицу component_mappings
  await knex.schema.alterTable('component_mappings', (table) => {
    table.boolean('is_bug_fix').defaultTo(false).notNullable(); // Флаг анализа компонентов из бага
    table.index(['project_id', 'is_bug_fix'], 'idx_component_mappings_project_bug_fix');
  });
}

export async function down(knex) {
  // Удаляем индекс
  await knex.raw(`
    DROP INDEX IF EXISTS idx_component_mappings_project_bug_fix;
  `);

  // Удаляем поле
  await knex.schema.alterTable('component_mappings', (table) => {
    table.dropColumn('is_bug_fix');
  });
}


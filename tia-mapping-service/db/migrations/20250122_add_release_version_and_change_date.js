export async function up(knex) {
  // Добавляем поля release_version и change_date в таблицу component_mappings
  await knex.schema.alterTable('component_mappings', (table) => {
    table.string('release_version', 100).nullable(); // Версия релиза (например, "npp-2.214.0")
    table.timestamp('change_date').nullable(); // Дата изменения компонента
    table.index(['project_id', 'release_version'], 'idx_component_mappings_project_release');
  });
}

export async function down(knex) {
  // Удаляем индекс
  await knex.raw(`
    DROP INDEX IF EXISTS idx_component_mappings_project_release;
  `);

  // Удаляем поля
  await knex.schema.alterTable('component_mappings', (table) => {
    table.dropColumn('release_version');
    table.dropColumn('change_date');
  });
}


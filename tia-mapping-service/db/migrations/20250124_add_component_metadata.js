export async function up(knex) {
  // Создаём таблицу для хранения метаданных компонентов без привязки к функциональным блокам
  await knex.schema.createTable('component_metadata', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('project_id', 255).notNullable();
    table.string('component_type', 50).notNullable(); // frontend, backend, page, component
    table.string('component_name', 255).notNullable();
    table.string('release_version', 100).nullable();
    table.timestamp('change_date').nullable();
    table.boolean('is_bug_fix').defaultTo(false).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Уникальный индекс по комбинации project_id, component_type, component_name
    table.unique(['project_id', 'component_type', 'component_name'], 'idx_component_metadata_unique');
    
    // Индексы для быстрого поиска
    table.index(['project_id', 'release_version'], 'idx_component_metadata_project_release');
    table.index(['project_id', 'is_bug_fix'], 'idx_component_metadata_project_bug_fix');
    table.index(['project_id', 'change_date'], 'idx_component_metadata_project_date');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('component_metadata');
}




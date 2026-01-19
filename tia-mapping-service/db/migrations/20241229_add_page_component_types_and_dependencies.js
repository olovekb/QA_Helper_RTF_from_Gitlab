export async function up(knex) {
  // 1. Обновляем ограничение checkIn для component_type, добавляя 'page' и 'component'
  await knex.raw(`
    ALTER TABLE component_mappings 
    DROP CONSTRAINT IF EXISTS component_mappings_component_type_check;
  `);
  
  await knex.raw(`
    ALTER TABLE component_mappings 
    ADD CONSTRAINT component_mappings_component_type_check 
    CHECK (component_type IN ('frontend', 'backend', 'page', 'component'));
  `);

  // 2. Создаём таблицу для хранения связей Page -> компоненты
  await knex.schema.createTable('page_component_dependencies', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('project_id', 255).notNullable();
    table.string('page_name', 255).notNullable(); // Имя страницы (page_meta.name)
    table.string('page_route', 500); // Route страницы (page_meta.route)
    table.string('component_name', 255).notNullable(); // Имя компонента из depends_on_components
    table.string('component_type', 50).defaultTo('component'); // Тип компонента
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Индексы для быстрого поиска
    table.index(['project_id', 'page_name'], 'idx_page_deps_project_page');
    table.index(['project_id', 'component_name'], 'idx_page_deps_project_component');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('page_component_dependencies');
  
  // Возвращаем старое ограничение
  await knex.raw(`
    ALTER TABLE component_mappings 
    DROP CONSTRAINT IF EXISTS component_mappings_component_type_check;
  `);
  
  await knex.raw(`
    ALTER TABLE component_mappings 
    ADD CONSTRAINT component_mappings_component_type_check 
    CHECK (component_type IN ('frontend', 'backend'));
  `);
}





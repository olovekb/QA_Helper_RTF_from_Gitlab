export async function up(knex) {
  // Создаём таблицу для явной связи: функциональный блок -> Page -> дочерний компонент
  await knex.schema.createTable('functional_block_page_component_links', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    
    // Связь с функциональным блоком
    table.uuid('functional_block_id')
      .references('id')
      .inTable('functional_blocks')
      .onDelete('CASCADE')
      .notNullable();
    
    // Связь с Page (через component_mappings, где component_type = 'page')
    table.uuid('page_mapping_id')
      .references('id')
      .inTable('component_mappings')
      .onDelete('CASCADE')
      .notNullable();
    
    // Связь с дочерним компонентом (через page_component_dependencies)
    table.uuid('page_component_dependency_id')
      .references('id')
      .inTable('page_component_dependencies')
      .onDelete('CASCADE')
      .notNullable();
    
    // Дополнительные поля для удобства
    table.string('project_id', 255).notNullable();
    table.string('page_name', 255).notNullable(); // Имя Page для быстрого поиска
    table.string('component_name', 255).notNullable(); // Имя дочернего компонента для быстрого поиска
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Индексы для быстрого поиска
    table.index(['project_id', 'functional_block_id'], 'idx_fbpc_project_fb');
    table.index(['project_id', 'page_name'], 'idx_fbpc_project_page');
    table.index(['project_id', 'component_name'], 'idx_fbpc_project_component');
    table.index(['functional_block_id', 'page_mapping_id', 'page_component_dependency_id'], 'idx_fbpc_unique_link');
    
    // Уникальное ограничение: одна связь функциональный блок -> Page -> компонент
    table.unique(['functional_block_id', 'page_mapping_id', 'page_component_dependency_id'], 'uq_fbpc_link');
  });
  
  // Создаём функцию для автоматического создания связей при сохранении маппинга Page
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sync_functional_block_page_component_links()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Если это маппинг Page компонента, создаём связи с дочерними компонентами
      IF NEW.component_type = 'page' THEN
        INSERT INTO functional_block_page_component_links (
          functional_block_id,
          page_mapping_id,
          page_component_dependency_id,
          project_id,
          page_name,
          component_name
        )
        SELECT 
          NEW.functional_block_id,
          NEW.id,
          pcd.id,
          NEW.project_id,
          NEW.component_name,
          pcd.component_name
        FROM page_component_dependencies pcd
        WHERE pcd.project_id = NEW.project_id
          AND pcd.page_name = NEW.component_name
        ON CONFLICT (functional_block_id, page_mapping_id, page_component_dependency_id) 
        DO NOTHING;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  
  // Создаём триггер для автоматической синхронизации при создании маппинга Page
  await knex.raw(`
    CREATE TRIGGER trigger_sync_fbpc_links_on_page_mapping
    AFTER INSERT ON component_mappings
    FOR EACH ROW
    WHEN (NEW.component_type = 'page')
    EXECUTE FUNCTION sync_functional_block_page_component_links();
  `);
  
  // Создаём функцию для синхронизации при создании зависимости Page -> компонент
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sync_fbpc_links_from_page_deps()
    RETURNS TRIGGER AS $$
    BEGIN
      -- При создании зависимости Page -> компонент, создаём связи с функциональными блоками
      INSERT INTO functional_block_page_component_links (
        functional_block_id,
        page_mapping_id,
        page_component_dependency_id,
        project_id,
        page_name,
        component_name
      )
      SELECT 
        cm.functional_block_id,
        cm.id,
        NEW.id,
        NEW.project_id,
        NEW.page_name,
        NEW.component_name
      FROM component_mappings cm
      WHERE cm.project_id = NEW.project_id
        AND cm.component_type = 'page'
        AND cm.component_name = NEW.page_name
      ON CONFLICT (functional_block_id, page_mapping_id, page_component_dependency_id) 
      DO NOTHING;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  
  // Создаём триггер для автоматической синхронизации при создании зависимости Page -> компонент
  await knex.raw(`
    CREATE TRIGGER trigger_sync_fbpc_links_from_deps
    AFTER INSERT ON page_component_dependencies
    FOR EACH ROW
    EXECUTE FUNCTION sync_fbpc_links_from_page_deps();
  `);
}

export async function down(knex) {
  // Удаляем триггеры
  await knex.raw(`DROP TRIGGER IF EXISTS trigger_sync_fbpc_links_from_deps ON page_component_dependencies;`);
  await knex.raw(`DROP TRIGGER IF EXISTS trigger_sync_fbpc_links_on_page_mapping ON component_mappings;`);
  
  // Удаляем функции
  await knex.raw(`DROP FUNCTION IF EXISTS sync_fbpc_links_from_page_deps();`);
  await knex.raw(`DROP FUNCTION IF EXISTS sync_functional_block_page_component_links();`);
  
  // Удаляем таблицу
  await knex.schema.dropTableIfExists('functional_block_page_component_links');
}


export async function up(knex) {
  // Проверяем, существует ли уже таблица components (для идемпотентности)
  const hasComponentsTable = await knex.schema.hasTable('components');
  
  // 1. Создаём таблицу components (основная, уникальные компоненты)
  if (!hasComponentsTable) {
    await knex.schema.createTable('components', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('project_id', 255).notNullable();
    table.string('component_type', 50).notNullable(); // 'component', 'service', 'page'
    table.string('component_name', 255).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Уникальный индекс по комбинации project_id, component_type, component_name
    table.unique(['project_id', 'component_type', 'component_name'], 'idx_components_unique');
    
    // Индексы для быстрого поиска
    table.index(['project_id'], 'idx_components_project');
    table.index(['project_id', 'component_type'], 'idx_components_project_type');
    });
  }

  // 2. Создаём таблицу component_functional_blocks (связь компонент-блоки)
  const hasCfbTable = await knex.schema.hasTable('component_functional_blocks');
  if (!hasCfbTable) {
    await knex.schema.createTable('component_functional_blocks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('component_id')
      .references('id')
      .inTable('components')
      .onDelete('CASCADE')
      .notNullable();
    table.uuid('functional_block_id')
      .references('id')
      .inTable('functional_blocks')
      .onDelete('CASCADE')
      .notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Уникальное ограничение: одна связь компонент-блок
    table.unique(['component_id', 'functional_block_id'], 'idx_cfb_unique');
    
    // Индексы
    table.index(['component_id'], 'idx_cfb_component');
    table.index(['functional_block_id'], 'idx_cfb_functional_block');
    });
  }

  // 3. Создаём таблицу component_defects (дефекты от CI/CD)
  const hasDefectsTable = await knex.schema.hasTable('component_defects');
  if (!hasDefectsTable) {
    await knex.schema.createTable('component_defects', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('component_id')
      .references('id')
      .inTable('components')
      .onDelete('CASCADE')
      .notNullable();
    table.string('release_version', 100).nullable();
    table.timestamp('change_date').nullable(); // TIMESTAMP WITH TIME ZONE (полная дата+время из JSON)
    table.timestamp('created_at').defaultTo(knex.fn.now()); // Когда загрузили в БД
    
    // Уникальное ограничение: дедупликация по (component_id, release_version, change_date)
    table.unique(['component_id', 'release_version', 'change_date'], 'idx_component_defects_unique');
    
    // Индексы для быстрого поиска
    table.index(['component_id', 'change_date'], 'idx_component_defects_component_date');
    table.index(['component_id', 'release_version'], 'idx_component_defects_component_release');
    });
  }

  // 4. Мигрируем данные из component_mappings в новую структуру
  // Сначала создаём компоненты из уникальных комбинаций (project_id, component_type, component_name)
  await knex.raw(`
    INSERT INTO components (project_id, component_type, component_name, created_at, updated_at)
    SELECT DISTINCT 
      project_id,
      component_type,
      component_name,
      MIN(created_at) as created_at,
      MAX(updated_at) as updated_at
    FROM component_mappings
    GROUP BY project_id, component_type, component_name
    ON CONFLICT ON CONSTRAINT idx_components_unique DO NOTHING;
  `);

  // 5. Создаём связи component_functional_blocks из component_mappings
  await knex.raw(`
    INSERT INTO component_functional_blocks (component_id, functional_block_id, created_at)
    SELECT DISTINCT
      c.id as component_id,
      cm.functional_block_id,
      cm.created_at
    FROM component_mappings cm
    JOIN components c ON 
      c.project_id = cm.project_id 
      AND c.component_type = cm.component_type 
      AND c.component_name = cm.component_name
    WHERE cm.functional_block_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT idx_cfb_unique DO NOTHING;
  `);

  // 6. Мигрируем дефекты из component_mappings (где is_bug_fix = true) в component_defects
  await knex.raw(`
    INSERT INTO component_defects (component_id, release_version, change_date, created_at)
    SELECT DISTINCT
      c.id as component_id,
      cm.release_version,
      cm.change_date,
      cm.created_at
    FROM component_mappings cm
    JOIN components c ON 
      c.project_id = cm.project_id 
      AND c.component_type = cm.component_type 
      AND c.component_name = cm.component_name
    WHERE cm.is_bug_fix = true
      AND (cm.release_version IS NOT NULL OR cm.change_date IS NOT NULL)
    ON CONFLICT ON CONSTRAINT idx_component_defects_unique DO NOTHING;
  `);

  // 7. Добавляем component_id в component_mappings (если еще не существует)
  const hasComponentIdInMappings = await knex.raw(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'component_mappings' 
    AND column_name = 'component_id'
  `);
  
  if (!hasComponentIdInMappings.rows || hasComponentIdInMappings.rows.length === 0) {
    await knex.schema.alterTable('component_mappings', (table) => {
      table.uuid('component_id')
        .references('id')
        .inTable('components')
        .onDelete('CASCADE')
        .nullable(); // Временно nullable для миграции данных
    });
  }

  // 8. Заполняем component_id в component_mappings
  await knex.raw(`
    UPDATE component_mappings cm
    SET component_id = c.id
    FROM components c
    WHERE c.project_id = cm.project_id
      AND c.component_type = cm.component_type
      AND c.component_name = cm.component_name;
  `);

  // 9. Делаем component_id NOT NULL (если еще не NOT NULL)
  const isComponentIdNullable = await knex.raw(`
    SELECT is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'component_mappings' 
    AND column_name = 'component_id'
  `);
  
  if (isComponentIdNullable.rows && isComponentIdNullable.rows.length > 0 && isComponentIdNullable.rows[0].is_nullable === 'YES') {
    await knex.raw(`
      ALTER TABLE component_mappings 
      ALTER COLUMN component_id SET NOT NULL;
    `);
  }

  // 10. Добавляем индекс на component_id в component_mappings
  await knex.schema.alterTable('component_mappings', (table) => {
    table.index(['component_id'], 'idx_component_mappings_component_id');
  });

  // 11. Добавляем component_id в page_component_dependencies (если еще не существует)
  const hasComponentIdInDeps = await knex.raw(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'page_component_dependencies' 
    AND column_name = 'component_id'
  `);
  
  if (!hasComponentIdInDeps.rows || hasComponentIdInDeps.rows.length === 0) {
    await knex.schema.alterTable('page_component_dependencies', (table) => {
      table.uuid('component_id')
        .references('id')
        .inTable('components')
        .onDelete('CASCADE')
        .nullable(); // Временно nullable для миграции данных
    });
  }

  // 12. Создаём недостающие компоненты из page_component_dependencies
  await knex.raw(`
    INSERT INTO components (project_id, component_type, component_name, created_at, updated_at)
    SELECT DISTINCT 
      pcd.project_id,
      pcd.component_type,
      pcd.component_name,
      MIN(pcd.created_at) as created_at,
      MAX(pcd.updated_at) as updated_at
    FROM page_component_dependencies pcd
    WHERE NOT EXISTS (
      SELECT 1 FROM components c
      WHERE c.project_id = pcd.project_id
        AND c.component_type = pcd.component_type
        AND c.component_name = pcd.component_name
    )
    GROUP BY pcd.project_id, pcd.component_type, pcd.component_name
    ON CONFLICT ON CONSTRAINT idx_components_unique DO NOTHING;
  `);

  // 13. Заполняем component_id в page_component_dependencies
  await knex.raw(`
    UPDATE page_component_dependencies pcd
    SET component_id = c.id
    FROM components c
    WHERE c.project_id = pcd.project_id
      AND c.component_type = pcd.component_type
      AND c.component_name = pcd.component_name
      AND pcd.component_id IS NULL;
  `);

  // 14. Удаляем записи, для которых не удалось найти компонент (они не могут быть связаны)
  await knex.raw(`
    DELETE FROM page_component_dependencies
    WHERE component_id IS NULL;
  `);

  // 15. Делаем component_id NOT NULL в page_component_dependencies (если еще не NOT NULL)
  const isComponentIdNullableInDeps = await knex.raw(`
    SELECT is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'page_component_dependencies' 
    AND column_name = 'component_id'
  `);
  
  if (isComponentIdNullableInDeps.rows && isComponentIdNullableInDeps.rows.length > 0 && isComponentIdNullableInDeps.rows[0].is_nullable === 'YES') {
    await knex.raw(`
      ALTER TABLE page_component_dependencies 
      ALTER COLUMN component_id SET NOT NULL;
    `);
  }

  // 14. Добавляем индекс на component_id в page_component_dependencies
  await knex.schema.alterTable('page_component_dependencies', (table) => {
    table.index(['component_id'], 'idx_page_component_deps_component_id');
  });

  // 15. Удаляем старые поля из component_mappings (оставляем только для обратной совместимости на время)
  // Пока оставим их, но они больше не будут использоваться в новой логике
  // Можно будет удалить в следующей миграции после полного перехода на новую структуру
}

export async function down(knex) {
  // Удаляем индексы
  await knex.schema.alterTable('page_component_dependencies', (table) => {
    table.dropIndex(['component_id'], 'idx_page_component_deps_component_id');
  });
  
  await knex.schema.alterTable('component_mappings', (table) => {
    table.dropIndex(['component_id'], 'idx_component_mappings_component_id');
  });

  // Удаляем component_id из page_component_dependencies
  await knex.schema.alterTable('page_component_dependencies', (table) => {
    table.dropColumn('component_id');
  });

  // Удаляем component_id из component_mappings
  await knex.schema.alterTable('component_mappings', (table) => {
    table.dropColumn('component_id');
  });

  // Удаляем таблицы в обратном порядке
  await knex.schema.dropTableIfExists('component_defects');
  await knex.schema.dropTableIfExists('component_functional_blocks');
  await knex.schema.dropTableIfExists('components');
}


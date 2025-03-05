export async function up(knex) {
  await knex.schema.createTable('functional_blocks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор блока (UUID)
    table.string('allure_id').unique().notNullable();
    table.string('project_id').notNullable();
    table.string('name').notNullable();
    table.integer('custom_field_id');
    table.string('custom_field_name');
    table.uuid('parent_id').references('id').inTable('functional_blocks'); // UUID для parent_id
    table.integer('count').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('component_mappings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор маппинга
    table.string('project_id', 255).notNullable(); // Идентификатор проекта
    table.string('component_type', 50).notNullable().checkIn(['frontend', 'backend']); // Тип компонента
    table.string('component_name', 255).notNullable(); // Название компонента
    table.uuid('functional_block_id').references('id').inTable('functional_blocks').notNullable(); // Ссылка на функциональный блок
    table.timestamp('created_at').defaultTo(knex.fn.now()); // Дата создания
    table.timestamp('updated_at').defaultTo(knex.fn.now()); // Дата обновления
  });

  await knex.schema.createTable('test_plans', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор тест-плана
    table.uuid('project_id').notNullable(); // Идентификатор проекта (UUID)
    table.string('jira_task_url', 255).notNullable(); // URL задачи Jira
    table.jsonb('functional_blocks').notNullable(); // Список функциональных блоков и компонентов
    table.timestamp('created_at').defaultTo(knex.fn.now()); // Дата создания
    table.string('allure_link', 255); // Ссылка на тест-план в Allure (опционально)
  });

  await knex.schema.createTable('errors_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор лога
    table.string('error_type', 50).notNullable(); // Тип ошибки
    table.text('description').notNullable(); // Описание ошибки
    table.timestamp('timestamp').defaultTo(knex.fn.now()); // Время возникновения
    table.uuid('user_id'); // Идентификатор пользователя (опционально)
  });

  // Создание индексов для ускорения запросов
  await knex.raw(`
    CREATE INDEX idx_functional_blocks_project_id ON functional_blocks(project_id);
    CREATE INDEX idx_components_project_id_type ON component_mappings(project_id, component_type);
    CREATE INDEX idx_test_plans_project_id ON test_plans(project_id);
    CREATE INDEX idx_errors_log_timestamp ON errors_log(timestamp);
  `);
}

export async function down(knex) {
  await knex.schema.dropTable('errors_log');
  await knex.schema.dropTable('test_plans');
  await knex.schema.dropTable('component_mappings');
  await knex.schema.dropTable('functional_blocks');
}
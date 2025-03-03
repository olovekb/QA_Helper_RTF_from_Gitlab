exports.up = async function (knex) {
    await knex.schema.createTable('functional_blocks', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор блока (автоматическая генерация UUID)
        table.uuid('project_id').notNullable(); // Идентификатор проекта
        table.string('name', 255).notNullable(); // Название блока
        table.text('description'); // Описание блока (опционально)
        table.timestamp('created_at').defaultTo(knex.fn.now()); // Дата создания
        table.timestamp('updated_at').defaultTo(knex.fn.now()); // Дата обновления
    });

    await knex.schema.createTable('components', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор компонента
        table.uuid('project_id').notNullable(); // Идентификатор проекта
        table.string('component_type', 50).notNullable().checkIn(['frontend', 'backend']); // Тип компонента
        table.string('name', 255).notNullable(); // Название компонента
        table.uuid('functional_block_id').references('id').inTable('functional_blocks'); // Ссылка на функциональный блок
        table.timestamp('created_at').defaultTo(knex.fn.now()); // Дата создания
        table.timestamp('updated_at').defaultTo(knex.fn.now()); // Дата обновления
    });

    await knex.schema.createTable('test_plans', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); // Уникальный идентификатор тест-плана
        table.uuid('project_id').notNullable(); // Идентификатор проекта
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
      CREATE INDEX idx_components_project_id_type ON components(project_id, component_type);
      CREATE INDEX idx_test_plans_project_id ON test_plans(project_id);
      CREATE INDEX idx_errors_log_timestamp ON errors_log(timestamp);
    `);
};

exports.down = async function (knex) {
    await knex.schema.dropTable('errors_log');
    await knex.schema.dropTable('test_plans');
    await knex.schema.dropTable('components');
    await knex.schema.dropTable('functional_blocks');
};
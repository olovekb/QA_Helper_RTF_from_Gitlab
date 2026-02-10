export async function up(knex) {
    // Увеличиваем размер колонки error_type с 50 до 255 символов
    await knex.schema.alterTable('errors_log', (table) => {
        table.string('error_type', 255).alter();
    });
}

export async function down(knex) {
    // Возвращаем обратно 50 символов (с возможной потерей данных, если они длиннее)
    // В реальной ситуации down миграции с потерей данных делают с осторожностью, 
    // но здесь это логи, так что допустимо.
    await knex.schema.alterTable('errors_log', (table) => {
        table.string('error_type', 50).alter();
    });
}

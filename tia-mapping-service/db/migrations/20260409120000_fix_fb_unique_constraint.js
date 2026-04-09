/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    // Удаляем старое уникальное ограничение по allure_id
    await knex.schema.alterTable('functional_blocks', table => {
        table.dropUnique(['allure_id']);
        // Добавляем новое уникальное ограничение по связке allure_id + project_id
        table.unique(['allure_id', 'project_id']);
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable('functional_blocks', table => {
        table.dropUnique(['allure_id', 'project_id']);
        table.unique(['allure_id']);
    });
}

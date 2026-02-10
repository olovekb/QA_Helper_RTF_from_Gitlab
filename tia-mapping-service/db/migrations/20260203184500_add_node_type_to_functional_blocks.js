export async function up(knex) {
    await knex.schema.alterTable('functional_blocks', (table) => {
        table.string('node_type', 50).defaultTo('GROUP').notNullable();
        table.string('layer', 100).nullable();
    });

    // Создаем индекс для быстрого разделения при создании запуска
    await knex.raw(`
    CREATE INDEX idx_functional_blocks_node_type ON functional_blocks(node_type);
  `);
}

export async function down(knex) {
    await knex.schema.alterTable('functional_blocks', (table) => {
        table.dropIndex([], 'idx_functional_blocks_node_type');
        table.dropColumn('layer');
        table.dropColumn('node_type');
    });
}

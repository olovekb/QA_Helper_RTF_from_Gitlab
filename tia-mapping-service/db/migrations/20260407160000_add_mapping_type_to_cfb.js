
export async function up(knex) {
    const hasColumn = await knex.schema.hasColumn('component_functional_blocks', 'mapping_type');
    if (!hasColumn) {
        await knex.schema.alterTable('component_functional_blocks', (table) => {
            table.string('mapping_type', 20).defaultTo('direct').notNullable();
            table.index(['mapping_type'], 'idx_cfb_mapping_type');
        });
    }
}

export async function down(knex) {
    await knex.schema.alterTable('component_functional_blocks', (table) => {
        table.dropIndex(['mapping_type'], 'idx_cfb_mapping_type');
        table.dropColumn('mapping_type');
    });
}

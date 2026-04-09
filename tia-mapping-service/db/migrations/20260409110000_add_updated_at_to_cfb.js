export async function up(knex) {
    const hasColumn = await knex.schema.hasColumn('component_functional_blocks', 'updated_at');
    if (!hasColumn) {
        await knex.schema.alterTable('component_functional_blocks', (table) => {
            table.timestamp('updated_at').defaultTo(knex.fn.now());
        });
    }

    // Также добавим в component_defects для консистентности, хотя там сейчас merge не используется
    const hasDefectsColumn = await knex.schema.hasColumn('component_defects', 'updated_at');
    if (!hasDefectsColumn) {
        await knex.schema.alterTable('component_defects', (table) => {
            table.timestamp('updated_at').defaultTo(knex.fn.now());
        });
    }
}

export async function down(knex) {
    await knex.schema.alterTable('component_functional_blocks', (table) => {
        table.dropColumn('updated_at');
    });
    
    await knex.schema.alterTable('component_defects', (table) => {
        table.dropColumn('updated_at');
    });
}

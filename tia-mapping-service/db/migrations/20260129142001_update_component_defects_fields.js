export async function up(knex) {
    await knex.schema.alterTable('component_defects', (table) => {
        table.string('issue_key', 50).nullable();
        table.boolean('is_bug_fix').defaultTo(true);
        table.integer('mr_iid').nullable();
        table.text('mr_title').nullable();
        table.string('source_branch', 255).nullable();
        table.string('target_branch', 255).nullable();
        table.timestamp('merged_at').nullable();
        table.text('web_url').nullable();

        // Удаляем старый уникальный индекс
        table.dropUnique(['component_id', 'release_version', 'change_date'], 'idx_component_defects_unique');

        // Создаем новый более точный уникальный индекс
        // Мы включаем mr_iid для разделения дефектов по Merge Request
        table.unique(['component_id', 'mr_iid', 'change_date', 'release_version'], 'idx_component_defects_unique_v2');

        // Дополнительные индексы
        table.index(['issue_key'], 'idx_component_defects_issue');
        table.index(['mr_iid'], 'idx_component_defects_mr');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('component_defects', (table) => {
        table.dropIndex([], 'idx_component_defects_mr');
        table.dropIndex([], 'idx_component_defects_issue');
        table.dropUnique([], 'idx_component_defects_unique_v2');

        // Возвращаем старый индекс
        table.unique(['component_id', 'release_version', 'change_date'], 'idx_component_defects_unique');

        table.dropColumn('web_url');
        table.dropColumn('merged_at');
        table.dropColumn('target_branch');
        table.dropColumn('source_branch');
        table.dropColumn('mr_title');
        table.dropColumn('mr_iid');
        table.dropColumn('is_bug_fix');
        table.dropColumn('issue_key');
    });
}

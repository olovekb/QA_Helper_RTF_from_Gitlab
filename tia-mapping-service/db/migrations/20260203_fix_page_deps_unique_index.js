/**
 * Миграция: Очистка дубликатов и создание нового уникального индекса для связей страниц и компонентов.
 * Также безопасно объединяет типы 'component' и 'frontend'.
 */
export async function up(knex) {
    // 1. Обработка связей страниц: Удаляем дубликаты
    await knex.raw(`
        DELETE FROM page_component_dependencies
        WHERE id IN (
            SELECT id FROM (
                SELECT 
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY 
                            project_id, 
                            component_id, 
                            page_name,
                            page_route
                        ORDER BY created_at ASC, id
                    ) as rn
                FROM page_component_dependencies
            ) duplicates
            WHERE rn > 1
        )
    `);

    // 2. Исправление индексов для связей страниц
    await knex.raw('DROP INDEX IF EXISTS idx_page_deps_unique');
    await knex.raw('ALTER TABLE page_component_dependencies DROP CONSTRAINT IF EXISTS page_component_dependencies_component_id_page_name_page_rout_key');

    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_page_deps_unique_v2 
        ON page_component_dependencies (
            project_id,
            component_id,
            page_name,
            page_route
        )
        NULLS NOT DISTINCT
    `);

    // 3. БЕЗОПАСНОЕ ОБЪЕДИНЕНИЕ ТИПОВ 'component' -> 'frontend'
    // Находим все пары (component, frontend) для одного и того же имени и проекта
    const duplicates = await knex.raw(`
        SELECT 
            c1.id as old_id, 
            c2.id as new_id,
            c1.project_id,
            c1.component_name
        FROM components c1
        JOIN components c2 ON c1.project_id = c2.project_id AND c1.component_name = c2.component_name
        WHERE c1.component_type = 'component' AND c2.component_type = 'frontend'
    `);

    for (const row of duplicates.rows) {
        const { old_id, new_id } = row;

        // Перепривязываем все зависимые записи к новому ID
        await knex('component_defects').where({ component_id: old_id }).update({ component_id: new_id }).onConflict(['component_id', 'change_date', 'issue_key', 'mr_iid', 'release_version']).ignore();
        await knex('component_functional_blocks').where({ component_id: old_id }).update({ component_id: new_id }).onConflict(['component_id', 'functional_block_id']).ignore();
        await knex('page_component_dependencies').where({ component_id: old_id }).update({ component_id: new_id }).onConflict(['project_id', 'component_id', 'page_name', 'page_route']).ignore();
        await knex('component_mappings').where({ component_id: old_id }).update({ component_id: new_id });

        // Удаляем старый компонент
        await knex('components').where({ id: old_id }).del();
    }

    // 4. Теперь, когда дубликаты устранены, можем смело обновить оставшиеся 'component' -> 'frontend'
    await knex('components')
        .where({ component_type: 'component' })
        .update({ component_type: 'frontend' });
}

export async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS idx_page_deps_unique_v2');
}

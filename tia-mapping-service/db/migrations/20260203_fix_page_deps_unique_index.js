/**
 * Миграция: Очистка дубликатов и создание нового уникального индекса для связей страниц и компонентов.
 * Также БЕЗОПАСНО объединяет типы 'component' и 'frontend', учитывая уникальные ограничения в других таблицах.
 */
export async function up(knex) {
    // 1. Обработка связей страниц: Удаляем дубликаты (простая дедупликация внутри таблицы)
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

        // Порядок важен: сначала удаляем то, что вызовет конфликт при UPDATE

        // A. component_functional_blocks (unique: component_id, functional_block_id)
        await knex.raw(\`
            DELETE FROM component_functional_blocks 
            WHERE component_id = ? 
            AND functional_block_id IN (
                SELECT functional_block_id FROM component_functional_blocks WHERE component_id = ?
            )
        \`, [old_id, new_id]);
        await knex('component_functional_blocks').where({ component_id: old_id }).update({ component_id: new_id });

        // B. component_defects (unique v3: component_id, change_date, issue_key, mr_iid, release_version)
        // Используем COALESCE для обработки NULL значений в PARTITION/JOIN если бы делали через SQL, 
        // но здесь проще удалить точное совпадение всех полей.
        await knex.raw(\`
            DELETE FROM component_defects cd_old
            WHERE component_id = ?
            AND EXISTS (
                SELECT 1 FROM component_defects cd_new
                WHERE cd_new.component_id = ?
                AND (cd_new.change_date IS NOT DISTINCT FROM cd_old.change_date)
                AND (cd_new.issue_key IS NOT DISTINCT FROM cd_old.issue_key)
                AND (cd_new.mr_iid IS NOT DISTINCT FROM cd_old.mr_iid)
                AND (cd_new.release_version IS NOT DISTINCT FROM cd_old.release_version)
            )
        \`, [old_id, new_id]);
        await knex('component_defects').where({ component_id: old_id }).update({ component_id: new_id });

        // C. page_component_dependencies (unique v2: project_id, component_id, page_name, page_route)
        await knex.raw(\`
            DELETE FROM page_component_dependencies pcd_old
            WHERE component_id = ?
            AND EXISTS (
                SELECT 1 FROM page_component_dependencies pcd_new
                WHERE pcd_new.component_id = ?
                AND pcd_new.project_id = pcd_old.project_id
                AND (pcd_new.page_name IS NOT DISTINCT FROM pcd_old.page_name)
                AND (pcd_new.page_route IS NOT DISTINCT FROM pcd_old.page_route)
            )
        \`, [old_id, new_id]);
        await knex('page_component_dependencies').where({ component_id: old_id }).update({ component_id: new_id });

        // D. component_mappings (обычно нет жесткого уникального индекса по ID, просто обновляем)
        await knex('component_mappings').where({ component_id: old_id }).update({ component_id: new_id });

        // Удаляем старый компонент
        await knex('components').where({ id: old_id }).del();
    }

    // 4. Переводим оставшиеся 'component' -> 'frontend' (для тех, у кого не было дубликата-фронтенда)
    await knex('components')
        .where({ component_type: 'component' })
        .update({ component_type: 'frontend' });
}

export async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS idx_page_deps_unique_v2');
}

/**
 * Миграция: Обновление уникального индекса для возможности UPSERT (обогащения данных)
 * 
 * Убираем release_version из уникального ключа, чтобы при повторном импорте 
 * тех же дефектов (но с добавленной версией) они не дублировались, а обновлялись.
 * 
 * Уникальность теперь: component_id + change_date + issue_key + mr_iid
 */
export async function up(knex) {
    // 1. Удаляем дубликаты, которые могут возникнуть при удалении release_version из ключа.
    // Оставляем ту запись, где версия заполнена (если такие есть).
    await knex.raw(`
        DELETE FROM component_defects
        WHERE id IN (
            SELECT id FROM (
                SELECT 
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY 
                            component_id, 
                            change_date,
                            issue_key,
                            mr_iid
                        ORDER BY release_version DESC NULLS LAST, created_at ASC, id
                    ) as rn
                FROM component_defects
            ) duplicates
            WHERE rn > 1
        )
    `);

    // 2. Удаляем старый уникальный индекс v3
    await knex.raw('DROP INDEX IF EXISTS idx_component_defects_unique_v3');

    // 3. Создаём новый уникальный индекс v4 без release_version
    await knex.raw(`
        CREATE UNIQUE INDEX idx_component_defects_unique_v4 
        ON component_defects (
            component_id,
            change_date,
            issue_key,
            mr_iid
        )
        NULLS NOT DISTINCT
    `);
}

export async function down(knex) {
    // Возвращаем как было в v3
    await knex.raw('DROP INDEX IF EXISTS idx_component_defects_unique_v4');
    await knex.raw(`
        CREATE UNIQUE INDEX idx_component_defects_unique_v3 
        ON component_defects (
            component_id,
            change_date,
            issue_key,
            mr_iid,
            release_version
        )
        NULLS NOT DISTINCT
    `);
}

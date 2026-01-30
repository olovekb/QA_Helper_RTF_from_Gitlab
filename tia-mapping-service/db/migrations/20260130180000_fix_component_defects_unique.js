/**
 * Миграция: Очистка дубликатов и создание нового уникального индекса
 * 
 * Уникальность определяется по:
 * - component_id + change_date + issue_key + mr_iid + release_version
 * Используем NULLS NOT DISTINCT для PostgreSQL 15+ чтобы NULL = NULL при сравнении
 */
export async function up(knex) {
    // 1. Удаляем дубликаты, оставляя только одну запись для каждой уникальной комбинации
    // Используем CTE с ROW_NUMBER() для UUID id
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
                            mr_iid,
                            release_version
                        ORDER BY created_at ASC NULLS LAST, id
                    ) as rn
                FROM component_defects
            ) duplicates
            WHERE rn > 1
        )
    `);

    // 2. Удаляем старый уникальный constraint
    await knex.raw('ALTER TABLE component_defects DROP CONSTRAINT IF EXISTS idx_component_defects_unique_v2');

    // 3. Создаём новый уникальный индекс с NULLS NOT DISTINCT
    // Это позволяет считать NULL = NULL при сравнении уникальности
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

    console.log('Migration complete: Duplicates removed and new unique index created');
}

export async function down(knex) {
    // 1. Удаляем новый индекс
    await knex.raw('DROP INDEX IF EXISTS idx_component_defects_unique_v3');

    // 2. Восстанавливаем старый уникальный индекс
    await knex.schema.alterTable('component_defects', (table) => {
        table.unique(['component_id', 'mr_iid', 'change_date', 'release_version'], 'idx_component_defects_unique_v2');
    });
}


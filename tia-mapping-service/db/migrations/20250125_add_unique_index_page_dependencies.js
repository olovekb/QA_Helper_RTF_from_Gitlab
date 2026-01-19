export async function up(knex) {
  // Сначала удаляем дубликаты, оставляя только одну запись для каждой комбинации (project_id, page_name, component_name)
  // Используем ROW_NUMBER() для определения записей, которые нужно оставить (самые старые по created_at)
  await knex.raw(`
    DELETE FROM page_component_dependencies
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY project_id, page_name, component_name ORDER BY created_at ASC) as rn
        FROM page_component_dependencies
      ) t
      WHERE rn > 1
    );
  `);

  // Теперь создаём уникальный индекс для предотвращения дублирования связей Page -> компоненты
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_page_deps_unique 
    ON page_component_dependencies(project_id, page_name, component_name);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_page_deps_unique;
  `);
}


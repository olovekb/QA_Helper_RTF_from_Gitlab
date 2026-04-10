export async function up(knex) {
  // 1. Создаем таблицу, если её нет (на случай если bdd-server её не создал)
  const exists = await knex.schema.hasTable('generation_tasks');
  if (!exists) {
    await knex.schema.createTable('generation_tasks', (table) => {
      table.uuid('id').primary();
      table.string('type', 50).notNullable();
      table.string('status', 20).notNullable().defaultTo('processing');
      table.integer('progress').defaultTo(0);
      table.jsonb('input_data');
      table.jsonb('result');
      table.text('error_message');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at').nullable();
    });
  }

  // 2. Исправляем CHECK constraint
  // Сначала удаляем старый, если он есть
  await knex.raw('ALTER TABLE "generation_tasks" DROP CONSTRAINT IF EXISTS "generation_tasks_type_check"');
  
  // Добавляем расширенный список типов
  await knex.raw(`
    ALTER TABLE "generation_tasks" 
    ADD CONSTRAINT "generation_tasks_type_check" 
    CHECK (type IN ('test_cases', 'test_model', 'bdd_tests', 'cleanup_duplicates', 'qa_agent_review'))
  `);

  // 3. Создаем индексы для ускорения поиска статусов
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status)');
}

export async function down(knex) {
  // Мы не удаляем таблицу в down, так как она используется другими сервисами
  // Но можем вернуть старый констрейнт если нужно (но лучше не надо)
  await knex.raw('ALTER TABLE "generation_tasks" DROP CONSTRAINT IF EXISTS "generation_tasks_type_check"');
  await knex.raw(`
    ALTER TABLE "generation_tasks" 
    ADD CONSTRAINT "generation_tasks_type_check" 
    CHECK (type IN ('test_cases', 'test_model', 'bdd_tests'))
  `);
}

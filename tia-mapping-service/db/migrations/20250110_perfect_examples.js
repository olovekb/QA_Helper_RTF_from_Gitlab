export async function up(knex) {
  await knex.schema.createTable('perfect_examples', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('layer', 50).notNullable(); // E2E Tests, Integration frontend Tests, Integration backend Tests, Unit frontend Tests
    table.jsonb('test_case').notNullable(); // Полный JSON тест-кейса
    table.string('project_id', 255); // ID проекта Allure (опционально, для фильтрации по проекту)
    table.integer('usage_count').defaultTo(0); // Счётчик использования в генерации
    table.integer('quality_score').defaultTo(100); // Оценка качества (0-100, по умолчанию 100 для идеальных)
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('last_used_at'); // Когда последний раз использовался в генерации
  });

  await knex.raw(`
    CREATE INDEX idx_perfect_examples_layer ON perfect_examples(layer);
    CREATE INDEX idx_perfect_examples_project_id ON perfect_examples(project_id);
    CREATE INDEX idx_perfect_examples_quality_score ON perfect_examples(quality_score DESC);
    CREATE INDEX idx_perfect_examples_usage_count ON perfect_examples(usage_count DESC);
    CREATE INDEX idx_perfect_examples_last_used_at ON perfect_examples(last_used_at DESC);
  `);
}

export async function down(knex) {
  await knex.schema.dropTable('perfect_examples');
}


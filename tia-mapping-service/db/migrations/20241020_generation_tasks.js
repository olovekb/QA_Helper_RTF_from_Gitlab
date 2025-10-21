export async function up(knex) {
  await knex.schema.createTable('generation_tasks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('type', 50).notNullable().checkIn(['test_cases', 'test_model']);
    table.string('status', 20).notNullable().defaultTo('processing').checkIn(['processing', 'completed', 'failed']);
    table.integer('progress').defaultTo(0);
    table.jsonb('input_data');
    table.jsonb('result');
    table.text('error_message');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at');
  });

  await knex.raw(`
    CREATE INDEX idx_generation_tasks_status ON generation_tasks(status);
    CREATE INDEX idx_generation_tasks_created_at ON generation_tasks(created_at);
  `);
}

export async function down(knex) {
  await knex.schema.dropTable('generation_tasks');
}

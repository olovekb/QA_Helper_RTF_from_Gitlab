export async function up(knex) {
  const exists = await knex.schema.hasTable('confluence_chunk_index_cache');
  if (!exists) {
    await knex.schema.createTable('confluence_chunk_index_cache', (table) => {
      table.increments('id').primary();
      table.string('doc_id', 255).notNullable();
      table.string('source_type', 50).notNullable().defaultTo('linked');
      table.string('chunking_model', 255).notNullable();
      table.string('content_hash', 128).notNullable();
      table.integer('chunk_count').notNullable().defaultTo(0);
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_confluence_chunk_index_cache_unique
    ON confluence_chunk_index_cache (doc_id, source_type, chunking_model);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_confluence_chunk_index_cache_updated_at
    ON confluence_chunk_index_cache (updated_at DESC);
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('confluence_chunk_index_cache');
}

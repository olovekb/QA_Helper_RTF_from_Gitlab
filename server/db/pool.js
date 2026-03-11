import knex from 'knex';
import knexfile from './knexfile.js';

const databasePool = knex({
  client: 'pg',
  connection: knexfile.connection,
  pool: {
    min: 1,
    max: 10,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
  }
});

export default databasePool;

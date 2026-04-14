import knex from 'knex';
import config from '../config/index.js';

/**
 * Создание подключения к базе данных через Knex
 * Использует URL из конфигурации или переменной окружения
 */
const dbConnection = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL || config.databaseUrl || {
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName
  },
  pool: {
    min: 2,
    max: 50,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 100
  },
  migrations: {
    directory: './db/migrations'
  }
});

export default dbConnection;

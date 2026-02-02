import knex from 'knex'; // Импорт Knex для работы с PostgreSQL
import config from '../config/index.js'; // Импорт конфигурации

/**
 * Создание подключения к базе данных через Knex
 * Использует URL из конфигурации или переменной окружения
 */
const dbConnection = knex({
  client: 'pg', // Используем PostgreSQL
  connection: process.env.DATABASE_URL || config.databaseUrl || {
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName
  },
  pool: {
    min: 2, // Минимальное количество подключений в пуле
    max: 50,// Максимальное количество подключений
    acquireTimeoutMillis: 60000, // Дай больше времени на получение коннекта
    createTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 100
  },
  migrations: {
    directory: './db/migrations'
  }
});

// Примечание: удалён тестовый запрос с dbConnection.destroy(),
// который уничтожал пул соединений при каждом импорте

export default dbConnection;

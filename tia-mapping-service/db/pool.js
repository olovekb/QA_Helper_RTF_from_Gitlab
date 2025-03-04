// db/pool.js
import knex from 'knex';
import config from '../config/index.js'; // Импорт конфигурации базы данных

/**
 * Создаёт пул подключений к базе данных с использованием строки подключения DATABASE_URL
 * или отдельных параметров, если DATABASE_URL отсутствует
 * @returns {Object} - Экземпляр пула подключений Knex
 */
const databasePool = knex({
    client: config.databaseUrl ? 'pg' : config.dbClient, // Используем 'pg' для DATABASE_URL или dbClient (по умолчанию 'pg')
    connection: config.databaseUrl || {
        host: config.dbHost,
        port: config.dbPort,
        user: config.dbUser,
        password: config.dbPassword,
        database: config.dbName,
    },
    pool: {
        min: 2, // Минимальное количество подключений в пуле
        max: 10, // Максимальное количество подключений в пуле
    },
});

export default databasePool;
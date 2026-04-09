import knex from 'knex';
import config from '../config/index.js'; // Импорт конфигурации базы данных

/**
 * Создаёт пул подключений к базе данных с использованием строки подключения DATABASE_URL
 * или отдельных параметров, если DATABASE_URL отсутствует
 * @returns {Object} - Экземпляр пула подключений Knex
 */
const databasePool = knex({
    client: config.databaseUrl ? 'pg' : config.dbClient,
    connection: config.databaseUrl || {
        host: config.dbHost,
        port: config.dbPort,
        user: config.dbUser,
        password: config.dbPassword,
        database: config.dbName,
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
});

export default databasePool;
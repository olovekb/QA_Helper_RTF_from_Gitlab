import { Pool } from 'pg'; // Импорт клиента PostgreSQL для работы с базой данных
import config from '../config/index.js'; // Импорт конфигурации проекта

/**
 * Создание пула подключений к базе данных PostgreSQL
 * Использует URL из конфигурации или переменной окружения
 */
const databasePool = new Pool({
    connectionString: config.databaseUrl, // Строка подключения к БД из .env
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false // Настройка SSL для продакшена
});

/**
 * Экспортируем пул подключений для использования в других модулях
 * Это позволяет выполнять SQL-запросы к базе данных
 */
export default databasePool;
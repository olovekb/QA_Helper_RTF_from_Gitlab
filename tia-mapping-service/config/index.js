import dotenv from 'dotenv'; // Импорт библиотеки для работы с переменными окружения

// Загрузка переменных окружения из файла .env
dotenv.config();

/**
 * Объект конфигурации для микросервиса TIA Mapping Service
 * Содержит настройки порта, URL базы данных, Allure API, токен авторизации и параметры подключения к базе данных
 */
const config = {
    // Порт, на котором будет запускаться микросервис (по умолчанию 5001, если не указан в .env)
    port: process.env.PORT || 5001,

    // URL подключения к базе данных PostgreSQL (берётся из .env, если доступен)
    databaseUrl: process.env.DATABASE_URL || "postgres://tia_user:password@localhost:5432/tia_mapping_db",

    // Отдельные параметры подключения к базе данных (используются, если DATABASE_URL отсутствует)
    dbClient: 'pg', // Клиент по умолчанию для PostgreSQL (можно переопределить через DB_CLIENT в .env)
    dbHost: process.env.DB_HOST || 'localhost',
    dbPort: process.env.DB_PORT || 5432, // Порт по умолчанию для PostgreSQL
    dbUser: process.env.DB_USER || 'tia_user',
    dbPassword: process.env.DB_PASSWORD || 'password',
    dbName: process.env.DB_NAME || 'tia_mapping_db',

    // Базовый URL API Allure (берётся из .env или используется значение по умолчанию)
    allureBaseUrl: process.env.ALLURE_BASE_URL || 'https://abanking.qatools.cloud',

    // Токен авторизации для Allure API (берётся из .env)
    allureToken: process.env.ALLURE_TOKEN || 'cc865667-ca13-4f69-a5c9-77579586f571',
};

export default config; // Экспорт конфигурации для использования в других модулях
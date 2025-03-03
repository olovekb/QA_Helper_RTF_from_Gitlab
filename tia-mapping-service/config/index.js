import dotenv from 'dotenv'; // Импорт библиотеки для работы с переменными окружения

// Загрузка переменных окружения из файла .env
dotenv.config();

/**
 * Объект конфигурации для микросервиса TIA Mapping Service
 * Содержит настройки порта, URL базы данных, Allure API и токен авторизации
 */
const config = {
    // Порт, на котором будет запускаться микросервис (по умолчанию 5001, если не указан в .env)
    port: process.env.PORT || 5001,
    // URL подключения к базе данных PostgreSQL (берётся из .env)
    databaseUrl: process.env.DATABASE_URL,
    // Базовый URL API Allure (берётся из .env или используется значение по умолчанию)
    allureBaseUrl: process.env.ALLURE_BASE_URL || 'https://abanking.qatools.cloud/api',
    // Токен авторизации для Allure API (берётся из .env)
    allureToken: process.env.ALLURE_TOKEN
};

export default config; // Экспорт конфигурации для использования в других модулях
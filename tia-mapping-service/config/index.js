/**
 * Объект конфигурации для микросервиса TIA Mapping Service
 * Содержит настройки порта, URL базы данных, Allure API, токен авторизации и параметры подключения к базе данных
 * 
 */
const config = {
    port: process.env.PORT || 5001,

    databaseUrl: process.env.DATABASE_URL || null,

    dbClient: 'pg',
    dbHost: process.env.DB_HOST || 'localhost',
    dbPort: process.env.DB_PORT || 5432,
    dbUser: process.env.DB_USER || 'tia_user',
    dbPassword: process.env.DB_PASSWORD || 'password',
    dbName: process.env.DB_NAME || 'tia_mapping_db',

    allureBaseUrl: (process.env.ALLURE_BASE_URL || 'https://abanking.qatools.cloud').replace(/\/api$/, '').replace(/\/$/, ''),

    allureToken: process.env.ALLURE_TOKEN || 'cc865667-ca13-4f69-a5c9-77579586f571',
};

export default config;

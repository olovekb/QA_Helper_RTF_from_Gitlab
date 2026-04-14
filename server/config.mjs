/**
 * Объект конфигурации сервера с поддержкой переопределений через переменные окружения.
 * @type {Object}
 */
import config from './config.json' assert { type: 'json' };

const serverConfig = {
    ...config,
    baseUrl: process.env.ALLURE_BASE_URL || config.baseUrl,
    serverUrl: process.env.SERVER_URL || config.serverUrl,
    TIAUrl: process.env.TIA_URL || config.TIAUrl,
    bddServerUrl: process.env.BDD_SERVER_URL || config.bddServerUrl
};

export default serverConfig;

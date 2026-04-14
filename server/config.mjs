/**
 * Объект конфигурации сервера с поддержкой переопределений через переменные окружения.
 * @type {Object}
 */
import config from './config.json' assert { type: 'json' };

function normalizeBaseUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');

    if (!trimmed) {
        return trimmed;
    }

    const deduplicatedApi = trimmed.replace(/\/api(?:\/api)+$/i, '/api');

    if (deduplicatedApi.endsWith('/api') || deduplicatedApi.includes('/api/')) {
        return deduplicatedApi;
    }

    return `${deduplicatedApi}/api`;
}

const serverConfig = {
    ...config,
    baseUrl: normalizeBaseUrl(process.env.ALLURE_BASE_URL || config.baseUrl),
    serverUrl: process.env.SERVER_URL || config.serverUrl,
    TIAUrl: process.env.TIA_URL || config.TIAUrl,
    bddServerUrl: process.env.BDD_SERVER_URL || config.bddServerUrl
};

export default serverConfig;

// Обертка для переопределения serverUrl и TIAUrl

import rawConfig from './config.json';

function normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function normalizeServerUrl(url) {
    const trimmed = normalizeBaseUrl(url);

    if (!trimmed) {
        return trimmed;
    }

    return trimmed.replace(/\/api(?:\/api)+$/i, '/api');
}

const config = {
    ...rawConfig,
    serverUrl: normalizeServerUrl(process.env.REACT_APP_SERVER_URL || rawConfig.serverUrl),
    TIAUrl: normalizeBaseUrl(process.env.REACT_APP_TIA_URL || rawConfig.TIAUrl),
    bddServerUrl: normalizeBaseUrl(process.env.REACT_APP_BDD_SERVER_URL || rawConfig.bddServerUrl)
};

export default config;

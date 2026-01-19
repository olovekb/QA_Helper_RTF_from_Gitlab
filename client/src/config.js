// обертка для переопределения serverUrl и TIAUrl

import rawConfig from './config.json';

const config = {
    ...rawConfig,
    serverUrl: process.env.REACT_APP_SERVER_URL || rawConfig.serverUrl,
    TIAUrl: process.env.REACT_APP_TIA_URL || rawConfig.TIAUrl
};

export default config;

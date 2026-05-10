import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

test('getJwtToken prefers ALLURE_TOKEN env over redacted config token', async () => {
    const originalPost = axios.post;
    const originalEnvToken = process.env.ALLURE_TOKEN;
    const captured = {};

    process.env.ALLURE_TOKEN = 'env-allure-token';
    axios.post = async (url, data) => {
        captured.url = url;
        captured.body = String(data);
        return { data: { access_token: 'jwt-token' } };
    };

    try {
        const module = await import(`../http-service.mjs?auth-config-${Date.now()}`);
        const token = await module.getJwtToken();

        assert.equal(token, 'jwt-token');
        assert.equal(captured.url, 'https://abanking.qatools.cloud/api/uaa/oauth/token');
        assert.match(captured.body, /token=env-allure-token/);
        assert.doesNotMatch(captured.body, /token=__REDACTED__/);
    } finally {
        axios.post = originalPost;
        if (originalEnvToken === undefined) {
            delete process.env.ALLURE_TOKEN;
        } else {
            process.env.ALLURE_TOKEN = originalEnvToken;
        }
    }
});

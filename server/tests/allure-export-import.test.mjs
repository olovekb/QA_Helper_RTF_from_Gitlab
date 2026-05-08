import test from 'node:test';
import assert from 'node:assert/strict';

test('Allure export module imports without authenticating during startup', async () => {
    const module = await import('../xmind-parce/export-structure-allure.mjs');

    assert.equal(typeof module.exportStructureAllure, 'function');
    assert.equal(typeof module.exportStructureAllureNocode, 'function');
});

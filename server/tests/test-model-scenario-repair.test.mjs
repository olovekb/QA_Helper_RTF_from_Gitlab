import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GENERIC_FALLBACK_SCENARIO_TEXT,
    deriveFallbackScenarioText
} from '../test-model-scenario-repair.mjs';

test('fallback scenario is derived from story instead of generic placeholder', () => {
    const scenarioText = deriveFallbackScenarioText({
        story: {
            text: 'Отображение названия ведомости в списке ведомостей'
        },
        codes: [
            { text: 'Отображается название ведомости', type: 'frontend' }
        ]
    });

    assert.notEqual(scenarioText, GENERIC_FALLBACK_SCENARIO_TEXT);
    assert.equal(
        scenarioText,
        'Открыть список ведомостей для проверки отображения названия ведомости в списке ведомостей'
    );
});

test('fallback scenario preserves explicit button action when story contains one', () => {
    const scenarioText = deriveFallbackScenarioText({
        story: {
            text: "При клике на кнопку 'Повторить' в action-меню"
        },
        codes: [
            { text: 'Ведомость повторяется', type: 'frontend' }
        ]
    });

    assert.equal(scenarioText, 'Нажать кнопку "Повторить"');
});

test('fallback scenario can derive subject from code when story is empty', () => {
    const scenarioText = deriveFallbackScenarioText({
        story: {},
        codes: [
            { text: 'Отображается алерт ошибки ведомости', type: 'frontend' }
        ]
    });

    assert.equal(scenarioText, 'Открыть экран для проверки отображается алерт ошибки ведомости');
});

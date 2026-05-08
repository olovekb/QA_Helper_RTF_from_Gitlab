import test from 'node:test';
import assert from 'node:assert/strict';

import {
    coerceModelArrayFromToolArgs,
    parseToolArgsContent
} from '../tool-args-parser.mjs';

function createFeature(id = 'feature-1') {
    return {
        id,
        text: 'Платежи',
        stories: [
            {
                id: `${id}-story-1`,
                text: 'Оплата счета',
                scenarios: [
                    {
                        id: `${id}-scenario-1`,
                        text: 'Нажать кнопку "Оплатить"',
                        codes: [
                            { id: `${id}-code-1`, text: 'Отправляется запрос на оплату', type: 'frontend' }
                        ]
                    }
                ]
            }
        ]
    };
}

test('parseToolArgsContent wraps raw JSON arrays as submit_test_model args', () => {
    const model = [createFeature('feature-1'), createFeature('feature-2')];
    const args = parseToolArgsContent(JSON.stringify(model), 'submit_test_model');

    assert.deepEqual(args, { model });
});

test('parseToolArgsContent extracts fenced JSON arrays for submit_test_model', () => {
    const model = [createFeature()];
    const args = parseToolArgsContent(`\`\`\`json\n${JSON.stringify(model)}\n\`\`\``, 'submit_test_model');

    assert.deepEqual(args, { model });
});

test('parseToolArgsContent salvages model array from malformed inline tool call wrapper', () => {
    const model = [createFeature('feature-from-tpro')];
    const malformedToolCall = `<tool_call>
{"name":"submit_test_model","arguments":{"model":${JSON.stringify(model)}}}]}
</tool_call>`;

    const args = parseToolArgsContent(malformedToolCall, 'submit_test_model');

    assert.deepEqual(args, { model });
});

test('coerceModelArrayFromToolArgs accepts raw model arrays', () => {
    const model = [createFeature()];

    assert.deepEqual(coerceModelArrayFromToolArgs(model), model);
});

test('coerceModelArrayFromToolArgs accepts a single root Feature object from GigaChat content', () => {
    const feature = createFeature('feature-root-object');

    assert.deepEqual(coerceModelArrayFromToolArgs(feature), [feature]);
});

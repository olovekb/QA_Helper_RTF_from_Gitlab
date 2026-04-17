import test from 'node:test';
import assert from 'node:assert/strict';

import { parseValidationResultContent } from '../agents/post-generation-validator.mjs';

test('parseValidationResultContent accepts fenced json responses', () => {
    const parsed = parseValidationResultContent(`\`\`\`json
{
  "hasErrors": false,
  "errors": [],
  "fixes": [],
  "summary": "ok"
}
\`\`\``);

    assert.equal(parsed.hasErrors, false);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.summary, 'ok');
});

test('parseValidationResultContent extracts json object from surrounding prose', () => {
    const parsed = parseValidationResultContent(`Проверка завершена.

{
  "hasErrors": true,
  "errors": [{ "testCaseId": "tc-1", "field": "title" }],
  "fixes": [],
  "summary": "found"
}

Спасибо.`);

    assert.equal(parsed.hasErrors, true);
    assert.equal(parsed.errors[0].testCaseId, 'tc-1');
    assert.equal(parsed.summary, 'found');
});

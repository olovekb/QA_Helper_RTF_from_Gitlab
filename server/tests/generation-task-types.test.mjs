import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGenerationTaskTypeCheckClause,
  GENERATION_TASK_TYPES
} from '../../shared/generation-task-types.mjs';

test('generation task types include test_case_comparison', () => {
  assert.ok(GENERATION_TASK_TYPES.includes('test_case_comparison'));
});

test('generation task type check clause includes every supported type', () => {
  const clause = buildGenerationTaskTypeCheckClause();

  assert.ok(clause.startsWith('CHECK (type IN ('));
  for (const type of GENERATION_TASK_TYPES) {
    assert.ok(clause.includes(`'${type}'`), `missing ${type} in ${clause}`);
  }
});

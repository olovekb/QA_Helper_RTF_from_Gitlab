import test from 'node:test';
import assert from 'node:assert/strict';

import { solveAssignment } from '../metrics/hungarian.mjs';

test('hungarian solver finds the minimum-cost assignment', () => {
  const result = solveAssignment([
    [0.1, 0.8, 0.9],
    [0.7, 0.2, 0.3]
  ]);

  assert.deepEqual(result.assignment, [0, 1]);
  assert.ok(Math.abs(result.totalCost - 0.3) < 1e-9);
});

test('hungarian solver can prefer dummy columns when all real matches are worse', () => {
  const result = solveAssignment([
    [0.9, 0.95, 0.3, 0.3],
    [0.92, 0.94, 0.3, 0.3]
  ]);

  assert.deepEqual(result.assignment, [2, 3]);
  assert.ok(Math.abs(result.totalCost - 0.6) < 1e-9);
});

test('hungarian solver rejects matrices with more rows than columns', () => {
  assert.throws(
    () => solveAssignment([
      [0.1],
      [0.2]
    ]),
    /rows <= columns/
  );
});

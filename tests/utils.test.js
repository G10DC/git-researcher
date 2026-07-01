// tests/utils.test.js
// Unit test on the core/utils helpers (focusing on withRetry and runPool).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, runPool, cleanJsonString, safeJsonParse, getTimestamp } from '../src/core/utils.js';

test('withRetry returns on the first attempt', async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls++; return 'ok'; }, { retries: 3, delayMs: 1 });
  assert.equal(r, 'ok');
  assert.equal(calls, 1);
});

test('withRetry retries and then succeeds', async () => {
  let calls = 0;
  const r = await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw new Error('x');
      return 'ok';
    },
    { retries: 3, delayMs: 1 }
  );
  assert.equal(r, 'ok');
  assert.equal(calls, 2);
});

test('withRetry returns null if all attempts fail', async () => {
  const r = await withRetry(async () => { throw new Error('always'); }, { retries: 2, delayMs: 1 });
  assert.equal(r, null);
});

test('runPool preserves result order', async () => {
  const r = await runPool([1, 2, 3, 4], async (x) => x * 10, 2);
  assert.deepEqual(r, [10, 20, 30, 40]);
});

test('runPool handles an empty array', async () => {
  const r = await runPool([], async (x) => x, 3);
  assert.deepEqual(r, []);
});

test('cleanJsonString strips markdown fences and trims', () => {
  assert.equal(cleanJsonString('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(cleanJsonString('  {"a":1}  '), '{"a":1}');
});

test('safeJsonParse throws on invalid JSON, ok on valid', () => {
  assert.throws(() => safeJsonParse('{bad'), /JSON parse/);
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
});

test('getTimestamp format YYYYMMDD_HHMMSS', () => {
  assert.match(getTimestamp(), /^\d{8}_\d{6}$/);
});

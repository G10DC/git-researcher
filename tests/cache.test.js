// tests/cache.test.js
// Unit test on the on-disk cache (offline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeKey, getCache, setCache } from '../src/io/cache.js';
import { CACHE_DIR } from '../src/core/config.js';

test('makeKey is deterministic', () => {
  assert.equal(makeKey('ddg', 'site:github.com rust'), makeKey('ddg', 'site:github.com rust'));
  assert.notEqual(makeKey('a'), makeKey('b'));
});

test('setCache/getCache roundtrip', async () => {
  const key = makeKey('test-roundtrip', String(Date.now()));
  await setCache(key, { hello: 'world' });
  const v = await getCache(key);
  assert.deepEqual(v, { hello: 'world' });
  // cleanup
  fs.rmSync(path.join(CACHE_DIR, `${key}.json`), { force: true });
});

test('getCache miss on unknown key', async () => {
  const v = await getCache(makeKey('does-not-exist', String(Date.now())));
  assert.equal(v, null);
});

test('expired entry returns null', async () => {
  const key = makeKey('test-expired', String(Date.now()));
  // manually writes an entry with a very old timestamp
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify({ ts: 0, value: 'old' }));
  const v = await getCache(key);
  assert.equal(v, null, 'expired -> null');
  fs.rmSync(path.join(CACHE_DIR, `${key}.json`), { force: true });
});

test('cleanup: removes the test cache dir', () => {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

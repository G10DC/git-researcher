// tests/duckBlocked.test.js
//
// DuckDuckGo answers a client it treats as a bot with HTTP 202 and a challenge page -- a 2xx,
// so `res.ok` is true. Measured on 2026-09-15: an honest User-Agent got 202 and zero results
// on both endpoints, the browser one got 200 and seven. The challenge page used to be cached
// for CACHE_TTL_HOURS, parsed as "no results", and never reported as a block: for 72 hours
// "blocked" and "nothing there" looked the same.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as duck from '../src/discovery/duckSearch.js';
import { REQUEST_DELAY_MS } from '../src/core/config.js';

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/ddg_site_github.html');

const spyCache = (seed = null) => {
  const writes = [];
  return { writes, get: async () => seed, set: async (k) => { writes.push(k); } };
};

test('a 202 challenge page is a block: not retried, not cached, and the remaining queries are skipped', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, status: 202, text: async () => '<html><body>challenge</body></html>' };
  };
  const cache = spyCache();
  const found = await duck.searchRepos({ keywords: ['a', 'b', 'c'] }, { fetchImpl, cache });
  assert.deepEqual(found, []);
  assert.equal(cache.writes.length, 0, 'a challenge page was cached as a search result');
  // one request to /html/, one to /lite/, then stop -- not three queries of retries
  assert.equal(calls, 2, `DuckDuckGo was asked again after it had already blocked us (${calls} requests)`);
});

test('a block declares itself final, so withRetry does not retry it', () => {
  assert.equal(typeof duck.SerpBlockedError, 'function', 'no error type distinguishes a block from a failure');
  assert.equal(new duck.SerpBlockedError('html', 202).noRetry, true);
});

test('a SERP with zero results is not cached', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body></body></html>' });
  const cache = spyCache();
  await duck.searchRepos({ keywords: ['a'] }, { fetchImpl, cache });
  assert.equal(cache.writes.length, 0, 'an empty page would be served back for 72 hours');
});

test('a real SERP with results is still cached', async () => {
  const html = fs.readFileSync(FIXTURE, 'utf-8');
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const cache = spyCache();
  const found = await duck.searchRepos({ keywords: ['a'] }, { fetchImpl, cache });
  assert.ok(found.length > 0);
  assert.equal(cache.writes.length, 1);
});

test('queries served from the cache do not wait for the rate-limit delay', async () => {
  const html = fs.readFileSync(FIXTURE, 'utf-8');
  const fetchImpl = async () => { throw new Error('the network was used despite a cache hit'); };
  const started = Date.now();
  const found = await duck.searchRepos({ keywords: ['a', 'b', 'c'] }, { fetchImpl, cache: spyCache(html) });
  assert.ok(found.length > 0);
  assert.ok(Date.now() - started < REQUEST_DELAY_MS, 'three cache hits slept as if they had asked the network');
});

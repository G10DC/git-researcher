// Regressions for the robustness fixes (uddg encoding, runPool, CRLF, dork topics).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeUddg, parseGithubUrl } from '../src/discovery/serpParser.js';
import { buildQueries } from '../src/discovery/duckSearch.js';
import { runPool, cleanJsonString } from '../src/core/utils.js';

test('decodeUddg returns null on malformed percent encoding', () => {
  assert.equal(decodeUddg('//duckduckgo.com/l/?uddg=%ZZ'), null);
});

test('decodeUddg still decodes valid encodings correctly', () => {
  assert.equal(
    decodeUddg('//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fa%2Fb'),
    'https://github.com/a/b'
  );
});

test('runPool with zero concurrency still runs all items', async () => {
  assert.deepEqual(await runPool([1, 2, 3], async (x) => x * 10, 0), [10, 20, 30]);
});

test('runPool with zero concurrency preserves order', async () => {
  assert.deepEqual(await runPool([5, 4, 3, 2, 1], async (x) => x, 0), [5, 4, 3, 2, 1]);
});

test('cleanJsonString cleans fenced blocks with CRLF terminators', () => {
  assert.equal(cleanJsonString('```\r\n{"a":1}\r\n```'), '{"a":1}');
  assert.equal(cleanJsonString('```json\r\n{"a":1}\r\n```'), '{"a":1}');
});

test('buildQueries alternates site:github.com {kw} and the inurl:topics variant', () => {
  const q = buildQueries({ keywords: ['vector database', 'rust', 'hnsw'], technologies: [] });
  assert.equal(q[0].q, 'site:github.com vector database');
  assert.equal(q[1].q, 'site:github.com rust inurl:topics');
  assert.equal(q[2].q, 'site:github.com hnsw');
  assert.ok(q.some((e) => e.q.includes('inurl:topics')));
});

test('parseGithubUrl normalizes deep paths to the repo', () => {
  const r = parseGithubUrl('https://github.com/qdrant/qdrant/issues/42');
  assert.equal(r.fullName, 'qdrant/qdrant');
  assert.equal(r.url, 'https://github.com/qdrant/qdrant');
});

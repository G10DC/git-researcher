// tests/duckSearch.test.js
// - Unit test on the decode logic (always active): decodeUddg, parseGithubUrl,
//   parseSerp on synthetic HTML with uddg redirect, buildQueries.
// - Integration on a CAPTURED REAL SERP (tests/fixtures/ddg_site_github.html):
//   SKIP if the fixture is missing (capture it with curl, see SPEC sec. 8).
//   A synthetic fixture would pass but would not protect against the real case: that needs the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { searchRepos, buildQueries } from '../src/discovery/duckSearch.js';
import { decodeUddg, parseGithubUrl, parseSerp } from '../src/discovery/serpParser.js';
import { NOOP_CACHE } from '../src/io/cache.js';

test('decodeUddg resolves the DDG redirect (uddg param)', () => {
  assert.equal(
    decodeUddg('//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fqdrant%2Fqdrant&rut=x'),
    'https://github.com/qdrant/qdrant'
  );
  assert.equal(decodeUddg('https://github.com/a/b'), 'https://github.com/a/b');
  assert.equal(decodeUddg(''), null);
  assert.equal(decodeUddg(null), null);
});

test('parseGithubUrl extracts owner/repo and excludes non-repo paths', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/qdrant/qdrant'), {
    fullName: 'qdrant/qdrant',
    url: 'https://github.com/qdrant/qdrant',
  });
  assert.equal(parseGithubUrl('https://github.com/trending'), null);
  assert.equal(parseGithubUrl('https://github.com/features/actions'), null);
  assert.equal(parseGithubUrl('https://example.com/x/y'), null);
  assert.equal(parseGithubUrl('not a url'), null);
});

test('parseSerp decodes uddg and extracts title+snippet from a synthetic SERP', () => {
  const html = `
  <html><body>
    <div class="result">
      <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fqdrant%2Fqdrant&rut=x">qdrant/qdrant - GitHub</a></h2>
      <a class="result__snippet" href="#">Qdrant - vector search engine and vector database</a>
    </div>
    <div class="result">
      <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fweaviate%2Fweaviate">weaviate/weaviate</a></h2>
      <a class="result__snippet">Weaviate is a vector database</a>
    </div>
    <div class="result">
      <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx">not github</a></h2>
    </div>
  </body></html>`;
  const res = parseSerp(html);
  assert.equal(res.length, 2, 'only github results');
  assert.equal(res[0].fullName, 'qdrant/qdrant');
  assert.equal(res[0].url, 'https://github.com/qdrant/qdrant');
  assert.match(res[0].snippet, /vector/i);
  assert.equal(res[1].fullName, 'weaviate/weaviate');
});

test('buildQueries builds single-keyword queries, MAX_KEYWORDS cap, no AND-grouping', () => {
  const intent = { keywords: ['vector database', 'rust', 'hnsw', 'a', 'b', 'c', 'd'], technologies: ['tokio'] };
  const q = buildQueries(intent);
  assert.ok(q.length <= 6, 'respects the MAX_KEYWORDS budget');
  assert.equal(q[0], 'site:github.com vector database');
  // each query contains at most one user keyword (phrase), not an AND of distinct keywords
  q.forEach((query) => assert.ok(query.startsWith('site:github.com ')));
});

test('parseSerp on a CAPTURED REAL SERP (skip if fixture missing)', { skip: !fs.existsSync(path.resolve('tests/fixtures/ddg_site_github.html')) }, () => {
  const html = fs.readFileSync(path.resolve('tests/fixtures/ddg_site_github.html'), 'utf-8');
  const res = parseSerp(html);
  assert.ok(res.length >= 1, 'the real SERP contains at least one github repo');
  res.forEach((r) => assert.match(r.fullName, /^[^/]+\/[^/]+$/));
});

test('searchRepos end-to-end with mock fetchImpl (POST -> decode uddg -> dedup)', async () => {
  const html = `<html><body>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fa%2Fb">a/b</a><a class="result__snippet">vector database rust</a></div>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fa%2Fb">duplicate</a></div>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx">not github</a></div>
  </body></html>`;
  const fetchImpl = async () => ({ ok: true, text: async () => html });
  const res = await searchRepos({ keywords: ['vector database'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.equal(res.length, 1, 'dedup by fullName + github filter');
  assert.equal(res[0].fullName, 'a/b');
  assert.match(res[0].snippet, /vector/i);
});

test('searchRepos: empty SERP does not block the flow', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => '<html><body>no results</body></html>' });
  const res = await searchRepos({ keywords: ['vector database'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.deepEqual(res, []);
});

test('searchRepos: falls back to the /lite/ endpoint if /html/ always fails', async () => {
  const fetchImpl = async (endpoint) => {
    if (endpoint.includes('/html/')) throw new Error('blocked');
    return {
      ok: true,
      text: async () =>
        '<html><body><div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fc%2Fd">c/d</a></div></body></html>',
    };
  };
  const res = await searchRepos({ keywords: ['vector'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.equal(res.length, 1);
  assert.equal(res[0].fullName, 'c/d');
});

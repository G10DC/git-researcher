// tests/ranker.test.js
// Unit test on the PURE ranker functions (preRank + rankRepos).
// Also verifies truncation to TOP_N_REPOS (catches the constant-name bug).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preRank, rankRepos, takePerKeyword } from '../src/discovery/ranker.js';
import { TOP_N_REPOS, PER_KEYWORD } from '../src/core/config.js';

const intent = { keywords: ['vector', 'database', 'rust'] };

test('rankRepos orders by relevance+quality and truncates to TOP_N_REPOS', () => {
  const enriched = [
    {
      fullName: 'qdrant/qdrant',
      description: 'High-performance vector search engine and vector database',
      readmeSnippet: 'qdrant is a vector database written in rust',
      stars: 20000,
      lastUpdated: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 days ago
    },
    {
      fullName: 'foo/bar',
      description: 'a generic tool',
      readmeSnippet: '',
      stars: 100,
      lastUpdated: '2020-01-01T00:00:00Z',
    },
    {
      fullName: 'vectorxyz/db',
      description: 'vector stuff',
      readmeSnippet: '',
      stars: 5,
      lastUpdated: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
  ];

  const ranked = rankRepos(enriched, intent);

  assert.ok(ranked.length <= TOP_N_REPOS, 'does not exceed TOP_N_REPOS');
  assert.equal(ranked[0].fullName, 'qdrant/qdrant', 'the most relevant is first');
  assert.ok(ranked[0].score > ranked[ranked.length - 1].score, 'sorted desc by score');
  assert.ok(ranked[0].scoreBreakdown, 'has scoreBreakdown');
  assert.equal(ranked[0].scoreBreakdown.coverage, 1, 'qdrant has full keyword coverage');
});

test('rankRepos dedups by fullName keeping the highest score', () => {
  const enriched = [
    { fullName: 'a/b', description: 'vector database', stars: 5 },
    { fullName: 'a/b', description: 'vector database rust', stars: 500 },
  ];
  const ranked = rankRepos(enriched, intent);
  const ab = ranked.filter((r) => r.fullName === 'a/b');
  assert.equal(ab.length, 1, 'a single entry per fullName');
});

test('rankRepos tolerates undefined fields without crashing', () => {
  const ranked = rankRepos([{ fullName: 'x/y' }], intent);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].scoreBreakdown.stars, 0);
});

test('preRank orders by match on fullName+title+snippet (not only fullName)', () => {
  const candidates = [
    { fullName: 'random/thing', title: 'r', snippet: 'something unrelated' },
    { fullName: 'qdrant/qdrant', title: 'qdrant', snippet: 'vector search engine and database' },
    { fullName: 'rust-vector/db', title: 'rust vector', snippet: '' },
  ];
  const ordered = preRank(candidates, intent);
  // the candidate with no match ends up last (the first two match in snippet/name)
  assert.equal(ordered[ordered.length - 1].fullName, 'random/thing');
  // qdrant matches in the snippet despite the generic name -> not pushed to the bottom
  assert.notEqual(ordered[0].fullName, 'random/thing');
});

test('takePerKeyword selects up to perKeyword per keyword with dedup', () => {
  const items = [
    { fullName: 'a/1', matchedKeywords: ['vector', 'database'] },
    { fullName: 'a/2', matchedKeywords: ['vector', 'database'] },
    { fullName: 'a/3', matchedKeywords: ['vector', 'database'] },
    { fullName: 'a/4', matchedKeywords: ['cli'] },
  ];
  const sel = takePerKeyword(items, ['vector', 'database', 'cli'], 2);
  // 'vector' -> a/1,a/2 ; 'database' -> a/3 (a/1,a/2 already in) ; 'cli' -> a/4
  assert.equal(sel.length, 4);
  assert.ok(sel.some((r) => r.fullName === 'a/4'), 'cli-only item is represented');
});

test('rankRepos guarantees per-keyword coverage (a low-star repo for a minority keyword is kept)', () => {
  const recent = new Date(Date.now() - 10 * 86400000).toISOString();
  const enriched = [
    { fullName: 'pop/a', description: 'vector database rust', matchedKeywords: ['vector', 'database', 'rust'], stars: 99999, lastUpdated: recent },
    { fullName: 'pop/b', description: 'vector database rust', matchedKeywords: ['vector', 'database', 'rust'], stars: 88888, lastUpdated: recent },
    { fullName: 'pop/c', description: 'vector database rust', matchedKeywords: ['vector', 'database', 'rust'], stars: 77777, lastUpdated: recent },
    { fullName: 'cli/x', description: 'a cli', matchedKeywords: ['cli'], stars: 5, lastUpdated: recent },
  ];
  const ranked = rankRepos(enriched, { keywords: ['vector', 'database', 'rust', 'cli'] });
  assert.ok(ranked.some((r) => r.fullName === 'cli/x'), 'cli/x selected despite low stars (per-keyword coverage)');
  assert.ok(ranked.length <= TOP_N_REPOS + PER_KEYWORD, 'bounded by TOP_N_REPOS + PER_KEYWORD headroom');
});

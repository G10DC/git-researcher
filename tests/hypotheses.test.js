// Module behaviors not covered by the base tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeUddg, parseGithubUrl, parseSerp } from '../src/discovery/serpParser.js';
import { rankRepos } from '../src/discovery/ranker.js';
import { buildQueries } from '../src/discovery/duckSearch.js';
import { parseGithub } from '../src/discovery/repoEnricher.js';
import { cleanJsonString } from '../src/core/utils.js';
import { TOP_N_REPOS, MAX_KEYWORDS } from '../src/core/config.js';

const DAY = 86400000;
const intent = { keywords: ['vector', 'database', 'rust'] };

test('parseGithubUrl strips the .git suffix', () => {
  const r = parseGithubUrl('https://github.com/qdrant/qdrant.git');
  assert.equal(r.fullName, 'qdrant/qdrant');
  assert.equal(r.url, 'https://github.com/qdrant/qdrant');
});

test('parseGithubUrl excludes non-repo paths case-insensitively', () => {
  assert.equal(parseGithubUrl('https://github.com/Trending'), null);
  assert.equal(parseGithubUrl('https://github.com/FEATURES/actions'), null);
  assert.equal(parseGithubUrl('https://github.com/Topics/foo'), null);
});

test('parseGithubUrl rejects owner-only URLs', () => {
  assert.equal(parseGithubUrl('https://github.com/soloowner'), null);
  assert.equal(parseGithubUrl('https://github.com/'), null);
});

test('decodeUddg returns direct http(s) links as-is', () => {
  assert.equal(decodeUddg('http://github.com/a/b'), 'http://github.com/a/b');
  assert.equal(decodeUddg('https://github.com/a/b'), 'https://github.com/a/b');
});

test('parseSerp deduplicates by fullName', () => {
  const html = `
  <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fa%2Fb">a/b</a><a class="result__snippet">x</a></div>
  <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fa%2Fb">a/b again</a><a class="result__snippet">y</a></div>`;
  assert.equal(parseSerp(html).length, 1);
});

test('rankRepos excludes candidates marked _failed', () => {
  const enriched = [
    { fullName: 'ok/repo', description: 'vector database rust', stars: 10 },
    { fullName: 'bad/repo', _failed: true, description: 'vector database rust', stars: 9999 },
  ];
  const ranked = rankRepos(enriched, intent);
  assert.ok(!ranked.some((r) => r.fullName === 'bad/repo'));
  assert.equal(ranked.some((r) => r.fullName === 'ok/repo'), true);
});

test('rankRepos truncates exactly to TOP_N_REPOS', () => {
  const enriched = Array.from({ length: TOP_N_REPOS + 4 }, (_, i) => ({
    fullName: `owner${i}/repo${i}`,
    description: 'vector database rust',
    stars: i * 10,
  }));
  assert.equal(rankRepos(enriched, intent).length, TOP_N_REPOS);
});

test('rankRepos with no keywords does not produce NaN', () => {
  const ranked = rankRepos([{ fullName: 'a/b', description: 'x', stars: 5 }], { keywords: [] });
  assert.equal(ranked.length, 1);
  assert.equal(Number.isFinite(ranked[0].score), true);
  assert.equal(ranked[0].scoreBreakdown.coverage, 0);
  assert.equal(ranked[0].scoreBreakdown.name, 0);
});

test('normRecency maps to the correct tiers', () => {
  const rec = (lastUpdated) =>
    rankRepos([{ fullName: 'a/b', description: 'vector database', stars: 5, lastUpdated }], intent)[0]
      .scoreBreakdown.recency;
  assert.equal(rec(new Date(Date.now() - 10 * DAY).toISOString()), 1);
  assert.equal(rec(new Date(Date.now() - 400 * DAY).toISOString()), 0.5);
  assert.equal(rec(new Date(Date.now() - 900 * DAY).toISOString()), 0);
  assert.equal(rec(undefined), 0.3);
});

test('normStars maps 0 and 1M+ to 0..1', () => {
  const stars = (n) =>
    rankRepos([{ fullName: 'a/b', description: 'vector database', stars: n }], intent)[0].scoreBreakdown.stars;
  assert.equal(stars(0), 0);
  assert.equal(stars(1_000_000), 1);
  assert.equal(stars(5_000_000), 1);
});

test('rankRepos sorts by score and rounds to 3 decimals', () => {
  const ranked = rankRepos(
    [
      { fullName: 'lo/lo', description: 'generic', stars: 1 },
      { fullName: 'hi/hi', description: 'vector database rust engine', stars: 50000 },
    ],
    intent
  );
  assert.equal(ranked[0].fullName, 'hi/hi');
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.match(String(ranked[0].score), /^\d+(\.\d{1,3})?$/);
});

test('buildQueries respects the MAX_KEYWORDS budget', () => {
  const q = buildQueries({
    keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    technologies: ['tokio', 'rpc'],
  });
  assert.ok(q.length <= MAX_KEYWORDS);
});

test('buildQueries does not combine multiple user keywords in one query', () => {
  const keywords = ['vector database', 'rust'];
  const q = buildQueries({ keywords, technologies: ['tokio'] });
  assert.ok(q.length > 0);
  q.forEach((query) => {
    assert.ok(query.startsWith('site:github.com '));
    const hits = keywords.filter((k) => query.includes(k)).length;
    assert.ok(hits <= 1);
  });
});

test('buildQueries does not add the tech dork with three or more keywords', () => {
  const q = buildQueries({ keywords: ['a', 'b', 'c'], technologies: ['tokio'] });
  assert.equal(q.some((x) => x.includes('tokio')), false);
});

test('parseCount handles k/M suffixes and separators', () => {
  const stars = (counter) =>
    parseGithub(
      `<!doctype html><html><head><meta name="description" content="x"></head><body>
       <a id="repo-stars-counter-star">${counter}</a></body></html>`,
      { fullName: 'a/b', url: 'https://github.com/a/b' }
    ).stars;
  assert.equal(stars('20.1k'), 20100);
  assert.equal(stars('1.2m'), 1_200_000);
  assert.equal(stars('1,234'), 1234);
  assert.equal(stars('456'), 456);
});

test('parseGithub uses the title as description when meta description is missing', () => {
  const r = parseGithub(
    `<html><head><title>GitHub - foo/bar: amazing vector database</title></head><body></body></html>`,
    { fullName: 'foo/bar', url: 'https://github.com/foo/bar' }
  );
  assert.match(r.description, /amazing vector database/);
});

test('parseGithub uses the regex fallback on the description when the star counter is missing', () => {
  const r = parseGithub(
    `<!doctype html><html><head>
      <meta name="description" content="fast vector database, 15.2k stars on github">
     </head><body></body></html>`,
    { fullName: 'a/b', url: 'https://github.com/a/b' }
  );
  assert.equal(r.stars, 15200);
});

test('cleanJsonString strips a ``` fence without a json label', () => {
  assert.equal(cleanJsonString('```\n{"a":1}\n```'), '{"a":1}');
});

test('cleanJsonString leaves non-fenced text intact', () => {
  assert.equal(cleanJsonString('  {"a":1,"b":2}  '), '{"a":1,"b":2}');
});

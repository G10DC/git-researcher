// tests/inspiration.test.js
// Multi-source inspiration layer (ROADMAP near-term).
// - Unit on each source (hn/npm/so/paper): mapping + no-keyword guard + HTTP error.
// - formatInspiration (pure): rendering + empty handling.
// - gatherInspiration: parallel fan-out + fail non-fatal degradation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchHn } from '../src/discovery/hnSearch.js';
import { searchNpm } from '../src/discovery/npmSearch.js';
import { searchSo } from '../src/discovery/soSearch.js';
import { searchPapers } from '../src/discovery/paperSearch.js';
import { formatInspiration } from '../src/analysis/synthesizer.js';
import { gatherInspiration } from '../src/pipeline.js';
import { NOOP_CACHE } from '../src/io/cache.js';

const jsonFetch = (data) => async () => ({ ok: true, json: async () => data });

test('searchHn maps Algolia hits to Result[]', async () => {
  const fetchImpl = jsonFetch({
    hits: [
      { title: 'Show HN: vecdb', url: 'https://example.com', points: 10, num_comments: 2, objectID: '1', author: 'a' },
      { title: 'No URL', url: '', points: 0, num_comments: 0, objectID: '2' },
    ],
  });
  const res = await searchHn({ keywords: ['vector database'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.equal(res.length, 2);
  assert.equal(res[0].source, 'hn');
  assert.equal(res[0].title, 'Show HN: vecdb');
  assert.equal(res[0].url, 'https://example.com');
  assert.equal(res[1].url, 'https://news.ycombinator.com/item?id=2', 'fallback to HN item URL');
});

test('searchHn returns [] without keywords', async () => {
  const res = await searchHn({ keywords: [] }, { fetchImpl: jsonFetch({}), cache: NOOP_CACHE });
  assert.deepEqual(res, []);
});

test('searchNpm maps registry objects to Result[]', async () => {
  const fetchImpl = jsonFetch({
    objects: [
      { package: { name: 'vec', description: 'vectors', version: '1.0.0', links: { npm: 'https://www.npmjs.com/package/vec' } }, score: { final: 0.5 } },
      { package: { name: 'nodec', description: null }, score: {} },
    ],
  });
  const res = await searchNpm({ keywords: ['vector'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.equal(res.length, 2);
  assert.equal(res[0].source, 'npm');
  assert.equal(res[1].summary, '', 'null description -> empty string');
  assert.equal(res[1].url, 'https://www.npmjs.com/package/nodec');
});

test('searchSo unescapes HTML entities in titles and maps items', async () => {
  const fetchImpl = jsonFetch({
    items: [
      { title: 'How to &lt;shard&gt; a vector index?', link: 'https://stackoverflow.com/q/1', score: 30, answer_count: 2, tags: ['vector'] },
    ],
  });
  const res = await searchSo({ keywords: ['vector index'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.equal(res.length, 1);
  assert.equal(res[0].title, 'How to <shard> a vector index?');
  assert.equal(res[0].source, 'so');
});

test('searchPapers maps OpenAlex works to Result[]', async () => {
  const fetchImpl = jsonFetch({
    results: [
      { title: 'HNSW', publication_year: 2020, cited_by_count: 100, doi: 'https://doi.org/10.1/x', id: 'https://openalex.org/W1', primary_location: { source: { display_name: 'arXiv' } } },
      { title: 'NoDOI', publication_year: null, cited_by_count: 0, doi: null, id: 'https://openalex.org/W2' },
    ],
  });
  const res = await searchPapers({ keywords: ['ann'] }, { fetchImpl, cache: NOOP_CACHE });
  assert.equal(res.length, 2);
  assert.equal(res[0].url, 'https://doi.org/10.1/x');
  assert.equal(res[1].url, 'https://openalex.org/W2', 'no DOI -> OpenAlex id');
  assert.match(res[0].summary, /100 citations/);
});

test('a source throws on non-2xx (the orchestrator catches and degrades to [])', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(
    () => searchHn({ keywords: ['x'] }, { fetchImpl, cache: NOOP_CACHE }),
    /429/
  );
});

test('formatInspiration renders non-empty sources and skips empty ones', () => {
  const md = formatInspiration({
    hn: [{ title: 'T', url: 'https://h', summary: 's' }],
    npm: [],
    so: undefined,
    papers: [{ title: 'P', url: 'https://p', summary: '' }],
  });
  assert.match(md, /Hacker News/);
  assert.match(md, /\[T\]\(https:\/\/h\)/);
  assert.match(md, /Academic papers/);
  assert.doesNotMatch(md, /npm/, 'empty source omitted');
});

test('formatInspiration empty input -> empty string', () => {
  assert.equal(formatInspiration({}), '');
  assert.equal(formatInspiration(), '');
});

test('gatherInspiration fans out in parallel and degrades a failing source to []', async () => {
  const out = await gatherInspiration(
    { keywords: ['vector'] },
    {
      hn: async () => [{ title: 'h', url: 'u', summary: '', source: 'hn' }],
      npm: async () => { throw new Error('boom'); },
      so: async () => [{ title: 's', url: 'u', summary: '', source: 'so' }],
      papers: async () => [],
    }
  );
  assert.equal(out.hn.length, 1);
  assert.deepEqual(out.npm, [], 'failing source -> []');
  assert.equal(out.so.length, 1);
  assert.deepEqual(out.papers, []);
});

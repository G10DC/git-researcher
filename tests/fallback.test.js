// tests/fallback.test.js
// Unit test on the GitHub Search API fallback with a mock fetchImpl (offline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackDiscover, fetchOpenIssues } from '../src/discovery/githubApiFallback.js';

test('fallbackDiscover maps API results into RepoCandidate', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        {
          full_name: 'qdrant/qdrant',
          html_url: 'https://github.com/qdrant/qdrant',
          description: 'Vector search engine',
        },
        {
          full_name: 'weaviate/weaviate',
          html_url: 'https://github.com/weaviate/weaviate',
          description: null,
        },
      ],
    }),
  });

  const res = await fallbackDiscover(
    { keywords: ['vector database', 'rust'] },
    { fetchImpl: mockFetch }
  );
  assert.equal(res.length, 2);
  assert.equal(res[0].fullName, 'qdrant/qdrant');
  assert.equal(res[0].url, 'https://github.com/qdrant/qdrant');
  assert.equal(res[0].snippet, 'Vector search engine');
  assert.equal(res[1].snippet, '', 'null description -> empty string');
});

test('fallbackDiscover returns [] without keywords', async () => {
  const res = await fallbackDiscover({ keywords: [] }, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(res, []);
});

test('fallbackDiscover propagates HTTP errors', async () => {
  const mockFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    () => fallbackDiscover({ keywords: ['x'] }, { fetchImpl: mockFetch }),
    /403/
  );
});

test('fetchOpenIssues maps items and excludes pull requests', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => [
      { title: 'Bug A', body: 'body A' },
      { title: 'PR B', body: 'pr body', pull_request: { url: 'x' } },
      { title: 'Bug C', body: 'body C' },
    ],
  });
  const res = await fetchOpenIssues({ fullName: 'a/b' }, { fetchImpl: mockFetch });
  assert.equal(res.length, 2, 'PR excluded');
  assert.equal(res[0].title, 'Bug A');
  assert.equal(res[1].title, 'Bug C');
  assert.equal(res[0].body, 'body A');
});

test('fetchOpenIssues returns [] on API error (never throws)', async () => {
  const mockFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const res = await fetchOpenIssues({ fullName: 'a/b' }, { fetchImpl: mockFetch });
  assert.deepEqual(res, []);
});

// tests/repoEnricher.test.js
// Tests parseGithub and enrichRepos with a mock getPage (no browser/puppeteer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichRepos, parseGithub } from '../src/discovery/repoEnricher.js';
import { NOOP_CACHE } from '../src/io/cache.js';

const ghHtml = (owner, repo) =>
  `<!doctype html><html><head>
    <title>GitHub - ${owner}/${repo}: vector search engine</title>
    <meta name="description" content="${repo} - high-performance vector search engine and database">
   </head><body>
    <a href="/${owner}/${repo}/stargazers" id="repo-stars-counter-star">20.1k</a>
    <a id="issues-repo-tab-count" href="/${owner}/${repo}/issues">Issues 42</a>
    <span itemprop="programmingLanguage">rust</span>
    <a class="topic-tag">vector</a><a class="topic-tag">database</a>
    <relative-time datetime="2026-06-01T00:00:00Z">Jun 1</relative-time>
    <article class="markdown-body"># ${repo}\n\nVector database and similarity search engine.</article>
   </body></html>`;

test('parseGithub extracts stars/topics/lastUpdated/readme', () => {
  const r = parseGithub(ghHtml('qdrant', 'qdrant'), {
    fullName: 'qdrant/qdrant',
    url: 'https://github.com/qdrant/qdrant',
  });
  assert.equal(r.fullName, 'qdrant/qdrant');
  assert.equal(r.stars, 20100);
  assert.equal(r.openIssues, 42);
  assert.equal(r.language, 'rust');
  assert.deepEqual(r.topics, ['vector', 'database']);
  assert.equal(r.lastUpdated, '2026-06-01T00:00:00Z');
  assert.match(r.readmeSnippet, /Vector database/);
});

test('enrichRepos with mock getPage (DI) enriches without a browser', async () => {
  const candidates = [{ fullName: 'a/b', url: 'https://github.com/a/b' }];
  const res = await enrichRepos(candidates, { getPage: async () => ghHtml('a', 'b'), cache: NOOP_CACHE });
  assert.equal(res.length, 1);
  assert.equal(res[0].stars, 20100);
  assert.equal(res[0]._failed, undefined);
});

test('enrichRepos marks _failed when getPage always fails', async () => {
  const candidates = [{ fullName: 'a/b', url: 'https://github.com/a/b' }];
  const res = await enrichRepos(candidates, {
    getPage: async () => { throw new Error('404'); },
    cache: NOOP_CACHE,
  });
  assert.equal(res[0]._failed, true);
});

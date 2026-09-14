// tests/egress.test.js
//
// The allowlist has to hold when nothing else is installed. sentinel provides the richer
// guard, but it is imported from a sibling directory that exists only in the installed
// skills layout: in a clone and in CI it is absent, and until now that meant no filter at
// all. These tests are the floor.

import test from 'node:test';
import assert from 'node:assert';

import { ALLOWED_HOSTS, EgressDeniedError, guardFetch, isAllowedUrl } from '../src/core/egress.js';

test('the hosts the pipeline actually contacts are allowed', () => {
  for (const url of [
    'https://html.duckduckgo.com/html/',
    'https://lite.duckduckgo.com/lite/',
    'https://github.com/owner/repo',
    'https://raw.githubusercontent.com/owner/repo/main/README.md',
    'https://api.github.com/search/repositories?q=x',
    'https://hn.algolia.com/api/v1/search',
    'https://registry.npmjs.org/-/v1/search',
    'https://api.stackexchange.com/2.3/search/advanced',
    'https://api.openalex.org/works'
  ]) {
    assert.ok(isAllowedUrl(url), `a host the pipeline needs was refused: ${url}`);
  }
});

test('a suffixed lookalike host is refused', () => {
  // endsWith('.github.com') would accept the first of these. A list that can be suffixed
  // is not an allowlist.
  assert.equal(isAllowedUrl('https://github.com.attacker.example/x'), false);
  assert.equal(isAllowedUrl('https://notgithub.com/x'), false);
  assert.equal(isAllowedUrl('https://evil.example/x'), false);
});

test('subdomains are not implied by their parent', () => {
  assert.ok(isAllowedUrl('https://api.github.com/x'), 'api.github.com is listed explicitly');
  assert.equal(isAllowedUrl('https://gist.github.com/x'), false, 'an unlisted subdomain was allowed');
});

test('a non-http scheme cannot slip past a hostname check', () => {
  for (const url of ['file:///etc/passwd', 'data:text/html,<script>', 'ftp://github.com/x']) {
    assert.equal(isAllowedUrl(url), false, `a non-http scheme was allowed: ${url}`);
  }
});

test('an unparseable url is refused rather than assumed good', () => {
  for (const url of ['', 'not a url', null, undefined, '///']) {
    assert.equal(isAllowedUrl(url), false);
  }
});

test('guardFetch refuses before the wrapped implementation is called', async () => {
  let called = 0;
  const inner = async () => { called += 1; return { ok: true }; };
  const guarded = guardFetch(inner);

  // rejects, not throws: a fetch replacement must reject, never throw synchronously past
  // every `.catch()` its callers wrote
  await assert.rejects(() => guarded('https://evil.example/x'), EgressDeniedError);
  assert.equal(called, 0, 'the request was sent to an undeclared host');
});

test('guardFetch passes an allowed request straight through', async () => {
  const seen = [];
  const inner = async (url, opts) => { seen.push([url, opts]); return { ok: true, url }; };
  const res = await guardFetch(inner)('https://api.github.com/x', { method: 'GET' });
  assert.equal(res.url, 'https://api.github.com/x');
  assert.equal(seen[0][1].method, 'GET');
});

test('a refusal names the host and declares itself final', async () => {
  try {
    await guardFetch(async () => ({ ok: true }))('https://evil.example/path');
    assert.fail('the guard let it through');
  } catch (e) {
    assert.ok(e instanceof EgressDeniedError);
    assert.equal(e.host, 'evil.example');
    assert.equal(e.noRetry, true, 'withRetry would retry a denied host three times over');
    assert.match(e.message, /ALLOWED_HOSTS in src\/core\/egress\.js/);
  }
});

test('the allowlist cannot be mutated by a caller', () => {
  assert.throws(() => { ALLOWED_HOSTS.push('evil.example'); });
  assert.equal(isAllowedUrl('https://evil.example/x'), false);
});

test('a caller may narrow the list, and narrowing actually applies', () => {
  const onlyGithub = ['github.com'];
  assert.ok(isAllowedUrl('https://github.com/x', onlyGithub));
  assert.equal(isAllowedUrl('https://api.openalex.org/works', onlyGithub), false);
});

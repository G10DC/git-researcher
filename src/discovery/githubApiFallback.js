// src/discovery/githubApiFallback.js
// GitHub REST API helpers: safety-net discovery (fallbackDiscover) and open-issues
// fetch (fetchOpenIssues) to ground analyses with real user pain points.
// Rate-limit aware: reads X-RateLimit-Remaining and honors Retry-After once.

import { DEFAULT_USER_AGENT } from '../core/config.js';
import { sleep } from '../core/utils.js';

/** Default headers: UA + optional bearer token from GITHUB_TOKEN (no dotenv). */
function ghHeaders() {
  const headers = { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function rateWarn(res) {
  const remaining = res.headers?.get?.('x-ratelimit-remaining');
  const n = Number(remaining);
  if (Number.isFinite(n) && n <= 1) {
    console.warn(`⚠️ GitHub API rate limit almost exhausted (remaining: ${n})`);
  }
}

/**
 * GitHub API GET, rate-limit aware. Backs off once on Retry-After / 429 / 403.
 * @param {string} path full URL or path under https://api.github.com
 * @param {{fetchImpl?:Function}} [deps]
 * @returns {Promise<Object>} parsed JSON
 * @throws {Error} on non-2xx (after the single retry)
 */
export async function githubGet(path, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;

  const get = async () => {
    const res = await fetchImpl(url, { headers: ghHeaders() });
    rateWarn(res);
    if (res.ok) return res.json();
    const retryAfter = Number(res.headers?.get?.('retry-after'));
    if ((res.status === 429 || res.status === 403) && retryAfter > 0) {
      await sleep(retryAfter * 1000);
      const res2 = await fetchImpl(url, { headers: ghHeaders() });
      rateWarn(res2);
      if (res2.ok) return res2.json();
      throw new Error(`GitHub API HTTP ${res2.status} after retry`);
    }
    throw new Error(`GitHub API HTTP ${res.status}`);
  };

  return get();
}

/**
 * Discovery via the GitHub Search API (safety net when DuckDuckGo is empty/blocked).
 * @param {Object} intent
 * @param {{fetchImpl?:Function}} [deps]
 * @returns {Promise<Array<{fullName:string,url:string,title:string,snippet:string}>>}
 */
export async function fallbackDiscover(intent, deps = {}) {
  const kws = (intent.keywords || []).slice(0, 3);
  if (kws.length === 0) return [];
  const q = kws.map((k) => `"${k}"`).join(' ');
  const data = await githubGet(
    `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`,
    deps
  );
  return (data.items || []).map((it) => ({
    fullName: it.full_name,
    url: it.html_url,
    title: it.full_name,
    snippet: it.description || '',
  }));
}

/**
 * Fetches the most discussed open issues for a repo (PRs excluded), up to `perPage`.
 * Used to surface real user pain points -> improvement ideas for the user's idea.
 * @param {{fullName:string}} repo
 * @param {{fetchImpl?:Function, perPage?:number}} [deps]
 * @returns {Promise<Array<{title:string,body:string}>>} (empty on failure, never throws)
 */
export async function fetchOpenIssues(repo, deps = {}) {
  const perPage = deps.perPage ?? 5;
  try {
    const data = await githubGet(
      `/repos/${repo.fullName}/issues?state=open&sort=comments&direction=desc&per_page=${perPage}`,
      deps
    );
    return (Array.isArray(data) ? data : [])
      .filter((it) => !it.pull_request)
      .slice(0, perPage)
      .map((it) => ({ title: it.title || '', body: String(it.body || '').slice(0, 600) }));
  } catch (err) {
    console.warn(`⚠️ Could not fetch issues for ${repo.fullName}: ${err.message}`);
    return [];
  }
}

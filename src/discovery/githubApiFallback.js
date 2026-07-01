// src/discovery/githubApiFallback.js
// OPTIONAL (safety net). Discovery via the GitHub Search REST API when DuckDuckGo
// returns empty/blocked and config.GITHUB_API_DISCOVERY_FALLBACK is on.
// Maps results into the same RepoCandidate format.

import { DEFAULT_USER_AGENT } from '../core/config.js';

/**
 * @param {Object} intent
 * @param {{fetchImpl?:Function}} [deps]
 * @returns {Promise<Array<{fullName:string,url:string,title:string,snippet:string}>>}
 */
export async function fallbackDiscover(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));

  const kws = (intent.keywords || []).slice(0, 3);
  if (kws.length === 0) return [];
  const q = kws.map((k) => `"${k}"`).join(' ');

  const headers = { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
    `&sort=stars&order=desc&per_page=20`;

  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`GitHub Search API HTTP ${res.status}`);
  const data = await res.json();

  return (data.items || []).map((it) => ({
    fullName: it.full_name,
    url: it.html_url,
    title: it.full_name,
    snippet: it.description || '',
  }));
}

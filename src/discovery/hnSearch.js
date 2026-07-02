// src/discovery/hnSearch.js
// Inspiration source: Hacker News via the Algolia API.
// Signal: practitioner discussions, primers, war stories. Free, no key.
// Uniform contract: searchHn(intent, deps) -> Result[]. Resilient (throws -> caller degrades to []).

import { HN_ENDPOINT, INSPIRATION_TOP_K, FETCH_TIMEOUT_MS, DEFAULT_USER_AGENT } from '../core/config.js';
import { makeKey, DEFAULT_CACHE } from '../io/cache.js';

/**
 * @param {Object} intent
 * @param {{fetchImpl?:Function, topK?:number, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array<{title:string,summary:string,url:string,source:string,meta?:Object}>>}
 * @throws {Error} on non-2xx (the orchestrator catches and degrades to [])
 */
export async function searchHn(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const topK = deps.topK ?? INSPIRATION_TOP_K;
  const cache = deps.cache || DEFAULT_CACHE;
  const q = (intent.keywords || []).slice(0, 2).join(' ').trim();
  if (!q) return [];

  const key = makeKey('hn', q, topK);
  const cached = await cache.get(key);
  if (cached) return cached;

  const url = `${HN_ENDPOINT}?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${topK}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': DEFAULT_USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`HN API HTTP ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const hits = Array.isArray(data.hits) ? data.hits : [];
  const results = hits.map((h) => ({
    title: h.title || '(untitled)',
    summary: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments`,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: 'hn',
    meta: { points: h.points ?? 0, comments: h.num_comments ?? 0, author: h.author },
  }));
  await cache.set(key, results);
  return results;
}

// src/discovery/soSearch.js
// Inspiration source: Stack Overflow via the Stack Exchange API (cross-project pain points).
// Anonymous IP-quota; an optional SO_API_KEY env var raises it. Uniform contract:
// searchSo(intent, deps) -> Result[].

import { STACKOVERFLOW_ENDPOINT, INSPIRATION_TOP_K, FETCH_TIMEOUT_MS } from '../core/config.js';
import { makeKey, DEFAULT_CACHE } from '../io/cache.js';

/** Minimal HTML-entity unescape for SO titles (no extra dependency). */
function unescapeHtml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * @param {Object} intent
 * @param {{fetchImpl?:Function, topK?:number, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array<{title:string,summary:string,url:string,source:string,meta?:Object}>>}
 * @throws {Error} on non-2xx (the orchestrator catches and degrades to [])
 */
export async function searchSo(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const topK = deps.topK ?? INSPIRATION_TOP_K;
  const cache = deps.cache || DEFAULT_CACHE;
  const q = (intent.keywords || []).slice(0, 2).join(' ').trim();
  if (!q) return [];

  const key = makeKey('so', q, topK);
  const cached = await cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    site: 'stackoverflow',
    order: 'desc',
    sort: 'votes',
    pagesize: String(topK),
    q,
  });
  const keyEnv = process.env.SO_API_KEY;
  if (keyEnv) params.set('key', keyEnv);
  const url = `${STACKOVERFLOW_ENDPOINT}?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Stack Exchange API HTTP ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map((it) => ({
    title: unescapeHtml(it.title),
    summary: `${it.score ?? 0} votes · ${it.answer_count ?? 0} answers`,
    url: it.link,
    source: 'so',
    meta: { score: it.score ?? 0, answers: it.answer_count ?? 0, tags: it.tags || [] },
  }));
  await cache.set(key, results);
  return results;
}

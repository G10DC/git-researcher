// src/discovery/paperSearch.js
// Inspiration source: academic papers via OpenAlex (prior art, documented trade-offs).
// Polite pool via mailto, no key. Uniform contract: searchPapers(intent, deps) -> Result[].

import { OPENALEX_ENDPOINT, OPENALEX_MAILTO, INSPIRATION_TOP_K, FETCH_TIMEOUT_MS } from '../core/config.js';
import { makeKey, DEFAULT_CACHE } from '../io/cache.js';

/**
 * @param {Object} intent
 * @param {{fetchImpl?:Function, topK?:number, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array<{title:string,summary:string,url:string,source:string,meta?:Object}>>}
 * @throws {Error} on non-2xx (the orchestrator catches and degrades to [])
 */
export async function searchPapers(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const topK = deps.topK ?? INSPIRATION_TOP_K;
  const cache = deps.cache || DEFAULT_CACHE;
  const q = (intent.keywords || []).slice(0, 2).join(' ').trim();
  if (!q) return [];

  const key = makeKey('paper', q, topK);
  const cached = await cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    search: q,
    'per-page': String(topK),
    mailto: OPENALEX_MAILTO,
  });
  const url = `${OPENALEX_ENDPOINT}?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OpenAlex API HTTP ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const works = Array.isArray(data.results) ? data.results : [];
  const results = works.map((w) => {
    const venue = w.primary_location && w.primary_location.source && w.primary_location.source.display_name;
    return {
      title: w.title || '(untitled)',
      summary: `${w.publication_year || 'n.d.'} · ${w.cited_by_count ?? 0} citations`,
      url: w.doi ? `https://doi.org/${String(w.doi).replace(/^https?:\/\/doi\.org\//i, '')}` : w.id,
      source: 'paper',
      meta: { year: w.publication_year, citations: w.cited_by_count ?? 0, venue: venue || '' },
    };
  });
  await cache.set(key, results);
  return results;
}

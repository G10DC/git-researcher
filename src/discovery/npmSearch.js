// src/discovery/npmSearch.js
// Inspiration source: npm registry (composable packages and their popularity).
// Free, no key. Uniform contract: searchNpm(intent, deps) -> Result[].

import { NPM_ENDPOINT, INSPIRATION_TOP_K, FETCH_TIMEOUT_MS } from '../core/config.js';
import { makeKey, DEFAULT_CACHE } from '../io/cache.js';

/**
 * @param {Object} intent
 * @param {{fetchImpl?:Function, topK?:number, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array<{title:string,summary:string,url:string,source:string,meta?:Object}>>}
 * @throws {Error} on non-2xx (the orchestrator catches and degrades to [])
 */
export async function searchNpm(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const topK = deps.topK ?? INSPIRATION_TOP_K;
  const cache = deps.cache || DEFAULT_CACHE;
  const q = (intent.keywords || []).slice(0, 2).join(' ').trim();
  if (!q) return [];

  const key = makeKey('npm', q, topK);
  const cached = await cache.get(key);
  if (cached) return cached;

  const url = `${NPM_ENDPOINT}?text=${encodeURIComponent(q)}&size=${topK}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`npm API HTTP ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const objects = Array.isArray(data.objects) ? data.objects : [];
  const results = objects.map((o) => {
    const p = o.package || {};
    const score = (o.score && o.score.final) ?? 0;
    const npmUrl = (p.links && p.links.npm) || `https://www.npmjs.com/package/${p.name}`;
    return {
      title: p.name || '(unnamed)',
      summary: p.description || '',
      url: npmUrl,
      source: 'npm',
      meta: { version: p.version, score },
    };
  });
  await cache.set(key, results);
  return results;
}

// src/discovery/duckSearch.js
// GitHub repo discovery via DuckDuckGo + dorks (native fetch, no puppeteer).
// Parsing is delegated to serpParser (DRY); retry is centralized in core/utils.withRetry.

import {
  DUCKDUCKGO_HTML,
  DUCKDUCKGO_LITE,
  USE_DDG_POST,
  DORK_TEMPLATES,
  MAX_KEYWORDS,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  FETCH_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
} from '../core/config.js';
import { withRetry, sleep } from '../core/utils.js';
import { makeKey, DEFAULT_CACHE } from '../io/cache.js';
import { parseSerp } from './serpParser.js';

/**
 * Builds N single-keyword queries (no AND-grouping). Capped at MAX_KEYWORDS (budget).
 * @param {Object} intent
 * @returns {string[]}
 */
export function buildQueries(intent) {
  const keywords = (intent.keywords || []).slice(0, MAX_KEYWORDS);
  const techs = intent.technologies || [];
  const queries = [];
  const used = new Set();
  const push = (q) => {
    if (q && !used.has(q) && queries.length < MAX_KEYWORDS) {
      used.add(q);
      queries.push(q);
    }
  };
  // Alternate template[0] (site:github.com {kw}) and template[1] (... inurl:topics)
  // per keyword: dork variety without AND-grouping, within the MAX_KEYWORDS budget.
  keywords.forEach((kw, i) => {
    const tpl = i % 2 === 0 ? DORK_TEMPLATES[0] : DORK_TEMPLATES[1];
    push(tpl.replace('{kw}', kw));
  });
  if (queries.length < 3 && techs.length && keywords.length) {
    push(DORK_TEMPLATES[2].replace('{tech}', techs[0]).replace('{kw}', keywords[0]));
  }
  return queries;
}

/**
 * Runs a single DDG request (POST or GET) with an AbortController timeout.
 * @param {Function} fetchImpl
 * @param {string} endpoint
 * @param {string} query
 * @returns {Promise<string>} HTML
 */
async function fetchDdg(fetchImpl, endpoint, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let res;
    if (USE_DDG_POST) {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        body: `q=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
    } else {
      res = await fetchImpl(`${endpoint}?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
      });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches the HTML for a DDG query: cache -> retry on /html/ -> /lite/ fallback.
 * @param {string} query
 * @param {Function} fetchImpl
 * @param {{get:Function,set:Function}} cache
 * @returns {Promise<string|null>}
 */
async function fetchQueryHtml(query, fetchImpl, cache) {
  const key = makeKey('ddg', query);
  const cached = await cache.get(key);
  if (cached) return cached;
  let html = await withRetry(() => fetchDdg(fetchImpl, DUCKDUCKGO_HTML, query), {
    retries: MAX_RETRIES,
    delayMs: REQUEST_DELAY_MS,
  });
  if (html === null) {
    // /lite/ fallback endpoint (single attempt)
    try {
      html = await fetchDdg(fetchImpl, DUCKDUCKGO_LITE, query);
    } catch {
      /* nothing more to do */
    }
  }
  if (html) await cache.set(key, html);
  return html;
}

/**
 * Searches GitHub repositories via DuckDuckGo + dorks.
 * @param {Object} intent
 * @param {{fetchImpl?:Function, parseResults?:Function, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array<{fullName:string,url:string,title:string,snippet:string}>>}
 */
export async function searchRepos(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const parse = deps.parseResults || parseSerp;
  const cache = deps.cache || DEFAULT_CACHE;
  const queries = buildQueries(intent);

  const found = [];
  const seen = new Set();

  for (const q of queries) {
    const html = await fetchQueryHtml(q, fetchImpl, cache);
    if (html) {
      for (const cand of parse(html)) {
        if (!seen.has(cand.fullName)) {
          seen.add(cand.fullName);
          found.push(cand);
        }
      }
    } else {
      console.warn(`⚠️ No results (empty/blocked SERP) for query: ${q}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return found;
}

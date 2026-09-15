// src/discovery/duckSearch.js
// GitHub repo discovery via DuckDuckGo + dorks (native fetch, no puppeteer).
// Each candidate is tagged with the keyword(s) that surfaced it (matchedKeywords),
// so the ranker can guarantee per-keyword coverage. Parsing is in serpParser; retry in withRetry.
//
// robots.txt, checked 2026-09-15: html.duckduckgo.com and lite.duckduckgo.com both answer
// `User-agent: *` / `Allow: /`. The Disallow on /html and /lite belongs to duckduckgo.com,
// which this module does not call.

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
import { rethrowIfBudget } from '../core/budget.js';

/**
 * DuckDuckGo refused the request as automated. It does so with HTTP 202 and a challenge
 * page rather than an error status, so `res.ok` is true. Measured 2026-09-15: an honest
 * User-Agent got 202 and zero results on both endpoints. The status is the signal, and
 * deliberately not the page text: a real result page can mention "captcha" in a snippet.
 */
export class SerpBlockedError extends Error {
  constructor(endpoint, status) {
    super(`DuckDuckGo blocked the request as automated (${endpoint}, HTTP ${status})`);
    this.name = 'SerpBlockedError';
    this.status = status;
    // Asking again within seconds is exactly what bot detection looks for.
    // See core/utils.withRetry.
    this.noRetry = true;
  }
}

/**
 * Builds N single-keyword queries, each paired with its keyword.
 * @param {Object} intent
 * @returns {Array<{q:string,kw:string}>}
 */
export function buildQueries(intent) {
  const keywords = (intent.keywords || []).slice(0, MAX_KEYWORDS);
  const techs = intent.technologies || [];
  const entries = [];
  const used = new Set();
  const push = (q, kw) => {
    if (q && !used.has(q) && entries.length < MAX_KEYWORDS) {
      used.add(q);
      entries.push({ q, kw });
    }
  };
  // Alternate template[0] (site:github.com {kw}) and template[1] (... inurl:topics)
  // per keyword: dork variety without AND-grouping, within the MAX_KEYWORDS budget.
  keywords.forEach((kw, i) => {
    const tpl = i % 2 === 0 ? DORK_TEMPLATES[0] : DORK_TEMPLATES[1];
    push(tpl.replace('{kw}', kw), kw);
  });
  if (entries.length < 3 && techs.length && keywords.length) {
    push(DORK_TEMPLATES[2].replace('{tech}', techs[0]).replace('{kw}', keywords[0]), keywords[0]);
  }
  return entries;
}

/**
 * Runs a single DDG request (POST or GET) with an AbortController timeout.
 * @param {Function} fetchImpl
 * @param {string} endpoint
 * @param {string} query
 * @returns {Promise<string>} HTML
 * @throws {SerpBlockedError} on HTTP 202
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
    if (res.status === 202) throw new SerpBlockedError(endpoint, 202);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches the HTML for a DDG query: cache -> retry on /html/ -> /lite/ fallback.
 * Caching is the caller's decision, once it knows whether the page yielded anything.
 * @returns {Promise<{html:string|null, blocked:boolean, fromCache:boolean, key:string}>}
 */
async function fetchQueryHtml(query, fetchImpl, cache) {
  const key = makeKey('ddg', query);
  const cached = await cache.get(key);
  if (cached) return { html: cached, blocked: false, fromCache: true, key };

  let html = null;
  let blocked = false;
  try {
    html = await withRetry(() => fetchDdg(fetchImpl, DUCKDUCKGO_HTML, query), {
      retries: MAX_RETRIES,
      delayMs: REQUEST_DELAY_MS,
    });
  } catch (err) {
    rethrowIfBudget(err);
    if (!(err instanceof SerpBlockedError)) throw err;
    blocked = true;
  }
  if (html === null) {
    // /lite/ fallback endpoint (single attempt)
    try {
      html = await fetchDdg(fetchImpl, DUCKDUCKGO_LITE, query);
      blocked = false;
    } catch (err) {
      // A refused budget is a decision, not a dead endpoint: degrading it here is what
      // made the caller report "empty/blocked SERP" for a request never sent.
      rethrowIfBudget(err);
      if (err instanceof SerpBlockedError) blocked = true;
    }
  }
  return { html, blocked, fromCache: false, key };
}

/**
 * Searches GitHub repositories via DuckDuckGo + dorks. Each candidate carries the
 * keyword(s) that surfaced it (`matchedKeywords`) for per-keyword ranking.
 * @param {Object} intent
 * @param {{fetchImpl?:Function, parseResults?:Function, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array<{fullName:string,url:string,title:string,snippet:string,matchedKeywords:string[]}>>}
 */
export async function searchRepos(intent, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const parse = deps.parseResults || parseSerp;
  const cache = deps.cache || DEFAULT_CACHE;
  const entries = buildQueries(intent);

  const found = [];
  const idx = new Map(); // fullName -> index in found
  let blockedOn = null;

  for (const [n, { q, kw }] of entries.entries()) {
    // Once DuckDuckGo has refused this client, the next query gets the same answer and adds
    // to whatever flagged us. Stop asking for the rest of this run.
    if (blockedOn) {
      warnSkipped(entries.length - n, blockedOn);
      break;
    }
    const { html, blocked, fromCache, key } = await fetchQueryHtml(q, fetchImpl, cache);
    if (blocked) {
      blockedOn = q;
      console.warn(`⚠️ DuckDuckGo blocked this client (HTTP 202) on query: ${q}`);
      continue;
    }
    if (html) {
      const results = parse(html);
      await cacheIfUseful(cache, key, html, results, fromCache);
      mergeCandidates(found, idx, results, kw);
    } else {
      console.warn(`⚠️ No results (empty/blocked SERP) for query: ${q}`);
    }
    // The rate-limit delay is for the host being asked. A cache hit asked nobody.
    if (!fromCache) await sleep(REQUEST_DELAY_MS);
  }
  return found;
}

/**
 * Caches only a freshly fetched page that yielded results. An empty page -- an empty SERP,
 * or a markup change the parser no longer reads -- would otherwise be served back for
 * CACHE_TTL_HOURS as if it were an answer.
 */
async function cacheIfUseful(cache, key, html, results, fromCache) {
  if (!fromCache && results.length > 0) await cache.set(key, html);
}

/** Adds each candidate once, accumulating the keywords that surfaced it. */
function mergeCandidates(found, idx, results, kw) {
  for (const cand of results) {
    const i = idx.get(cand.fullName);
    if (i !== undefined) {
      found[i].matchedKeywords.push(kw);
    } else {
      idx.set(cand.fullName, found.length);
      found.push({ ...cand, matchedKeywords: [kw] });
    }
  }
}

function warnSkipped(count, blockedOn) {
  console.warn(`⚠️ DuckDuckGo: ${count} remaining query(ies) skipped after the block on: ${blockedOn}`);
}

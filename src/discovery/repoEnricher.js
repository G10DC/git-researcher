// src/discovery/repoEnricher.js
// Repo metadata enrichment from GitHub pages via puppeteer + cheerio.
// Clear lifecycle: enrichRepos owns the browser; getPage only navigates the page.
// Retry is centralized in core/utils.withRetry.

import { load } from 'cheerio';
import puppeteer from 'puppeteer';
import { NAV_TIMEOUT_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '../core/config.js';
import { withRetry, sleep } from '../core/utils.js';
import { makeKey, DEFAULT_CACHE } from '../io/cache.js';

/** Normalizes counters like "1.2k" / "45.6k" / "1,234" into a number. */
function parseCount(text) {
  if (!text) return undefined;
  const t = String(text).trim().toLowerCase().replace(/,/g, '');
  const m = t.match(/([\d.]+)\s*([km]?)/);
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1e3;
  else if (m[2] === 'm') n *= 1e6;
  return Math.round(n);
}

/** Reads a GitHub counter element (aria-label or text) via parseCount. */
function counterFrom($, selector) {
  const el = $(selector).first();
  return el.length ? parseCount(el.attr('aria-label') || el.text()) : undefined;
}

/** Stars: GitHub counter, with an "N stars" regex fallback on the description. */
function extractStars($, description) {
  let stars = counterFrom($, '#repo-stars-counter-star, #repo-network-counter, a[href$="/stargazers"]');
  if (stars === undefined) {
    const m = description.match(/([\d.]+\s*[km]?)\s*stars/i);
    if (m) stars = parseCount(m[1]);
  }
  return stars;
}

/**
 * Parses the HTML of a GitHub repo page, extracting metadata (approximate selectors;
 * the ranker tolerates undefined fields).
 * @param {string} html
 * @param {{fullName:string,url:string}} base
 * @returns {Object}
 */
export function parseGithub(html, base) {
  const $ = load(html);

  let description = '';
  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc) {
    description = metaDesc;
  } else {
    const title = $('title').first().text();
    const idx = title.indexOf(':');
    if (idx > -1) description = title.slice(idx + 1).replace(/\s*-?\s*GitHub\s*$/i, '').trim();
  }

  const stars = extractStars($, description);
  const openIssues = counterFrom($, '#issues-repo-tab-count, #issues-tab .Counter, a[href$="/issues"] .Counter');

  const language = $('span[itemprop="programmingLanguage"]').first().text().trim() || undefined;

  const topics = [];
  $('a.topic-tag, a[data-octo-dimensions="topic"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t) topics.push(t);
  });

  const lastUpdated = $('relative-time').first().attr('datetime') || undefined;

  let readmeSnippet = '';
  const readmeEl = $('article.markdown-body').first();
  if (readmeEl.length) readmeSnippet = readmeEl.text().trim().slice(0, 4000);

  return {
    fullName: base.fullName,
    url: base.url,
    description: description || undefined,
    stars,
    openIssues,
    language,
    topics: topics.length ? topics : undefined,
    readmeSnippet: readmeSnippet || undefined,
    defaultBranch: undefined,
    lastUpdated,
  };
}

/**
 * Enriches candidates: owns the browser (unless a deps.getPage is injected).
 * @param {Array<{fullName:string,url:string}>} candidates
 * @param {{getPage?:Function, cache?:{get:Function,set:Function}}} [deps]
 * @returns {Promise<Array>}
 */
export async function enrichRepos(candidates, deps = {}) {
  const cache = deps.cache || DEFAULT_CACHE;
  if (deps.getPage) {
    return enrichWith(candidates, deps.getPage, cache);
  }
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    /** @param {string} url */
    const getPage = async (url) => {
      await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
      return page.content();
    };
    return await enrichWith(candidates, getPage, cache);
  } finally {
    await browser.close();
  }
}

/**
 * Runs enrichment over all candidates using getPage + cache.
 * @param {Array} candidates
 * @param {(url:string)=>Promise<string>} getPage
 * @param {{get:Function,set:Function}} cache
 * @returns {Promise<Array>}
 */
async function enrichWith(candidates, getPage, cache) {
  const out = [];
  for (const c of candidates) {
    const key = makeKey('repo', c.fullName);
    let html = await cache.get(key);
    if (!html) {
      html = await withRetry(() => getPage(c.url), { retries: MAX_RETRIES, delayMs: REQUEST_DELAY_MS });
      if (html) await cache.set(key, html);
    }
    if (!html) {
      console.warn(`⚠️ Enrichment failed for ${c.fullName} (404/private/timeout)`);
      out.push({ fullName: c.fullName, url: c.url, _failed: true });
      continue;
    }
    try {
      out.push(parseGithub(html, c));
    } catch (err) {
      console.warn(`⚠️ Page parsing failed for ${c.fullName}: ${err.message}`);
      out.push({ fullName: c.fullName, url: c.url, _failed: true });
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

// src/discovery/serpParser.js
// PURE parser for the DuckDuckGo SERP (no I/O, no network).
// Extracted from duckSearch for testability and reuse (DRY). Handles the DDG redirect (uddg).

import { load } from 'cheerio';

/** GitHub paths to exclude (they are not repos). */
export const GITHUB_EXCLUDED = new Set([
  'blog', 'enterprise', 'trending', 'topics', 'orgs', 'features', 'about',
  'pricing', 'security', 'customer-stories', 'site', 'resources', 'collections',
  'events', 'sponsors', 'explore', 'marketplace', 'search', 'settings',
  'notifications', 'login', 'signup', 'new', 'org', 'apps', 'footer',
]);

/**
 * Decodes a DDG result href into the real destination URL.
 * Handles the //duckduckgo.com/l/?uddg=<enc> redirector and direct links.
 * @param {string} href
 * @returns {string|null}
 */
export function decodeUddg(href) {
  if (!href) return null;
  let h = String(href).trim();
  if (h.startsWith('//')) h = 'https:' + h;
  try {
    const u = new URL(h, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) {
      // URLSearchParams leaves malformed sequences (e.g. %ZZ) untouched: reject them.
      if (/%(?![0-9A-Fa-f]{2})/.test(uddg)) return null;
      return uddg; // valid encoding -> already decoded by URLSearchParams
    }
  } catch {
    /* fall through */
  }
  const m = h.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//.test(h) && !h.includes('duckduckgo.com/l/')) return h;
  return null;
}

/**
 * Extracts {fullName, url} from a github.com/<owner>/<repo> URL, or null if it is not a repo.
 * @param {string} url
 * @returns {{fullName:string,url:string}|null}
 */
export function parseGithubUrl(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'github.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repoRaw = parts[1];
  if (GITHUB_EXCLUDED.has(owner.toLowerCase())) return null;
  const repo = repoRaw.replace(/\.git$/, '');
  if (!owner || !repo) return null;
  return { fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

/**
 * Parses the HTML of a DDG SERP, returning the RepoCandidates (with title+snippet).
 * @param {string} html
 * @returns {Array<{fullName:string,url:string,title:string,snippet:string}>}
 */
export function parseSerp(html) {
  const $ = load(html);
  const out = [];
  const seen = new Set();
  const add = (fullName, url, title, snippet) => {
    if (seen.has(fullName)) return;
    seen.add(fullName);
    out.push({ fullName, url, title, snippet });
  };

  // /html/ endpoint: results in .result with a.result__a and .result__snippet
  $('.result, .web-result, .results_links').each((_, el) => {
    const $r = $(el);
    const $a = $r.find('a.result__a').first();
    if (!$a.length) return;
    const realUrl = decodeUddg($a.attr('href'));
    if (!realUrl) return;
    const parsed = parseGithubUrl(realUrl);
    if (!parsed) return;
    add(parsed.fullName, parsed.url, $a.text().trim(), $r.find('.result__snippet').first().text().trim());
  });

  // /lite/ endpoint: links in a.result-link
  if (out.length === 0) {
    $('a.result-link, a.result__a').each((_, a) => {
      const realUrl = decodeUddg($(a).attr('href'));
      if (!realUrl) return;
      const parsed = parseGithubUrl(realUrl);
      if (!parsed) return;
      add(parsed.fullName, parsed.url, $(a).text().trim(), '');
    });
  }

  return out;
}

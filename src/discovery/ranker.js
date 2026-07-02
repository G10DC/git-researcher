// src/discovery/ranker.js
// PURE ranking functions (no I/O).
// preRank: cheap ordering on fullName+title+snippet to pick what to enrich.
// takePerKeyword: coverage guarantee - up to N repos per searched keyword (union, dedup).
// rankRepos: tiered scoring, then per-keyword selection with a global safety-net fallback.

import { TOP_N_REPOS, PER_KEYWORD, RANKING_WEIGHTS } from '../core/config.js';

/** Primary keywords (lowercase). */
function primaryKeywords(intent) {
  return (intent.keywords || []).map((k) => String(k).toLowerCase());
}

/**
 * Cheap pre-ranking: orders candidates by keyword match on fullName+title+snippet.
 * @param {Array<{fullName:string,title?:string,snippet?:string}>} candidates
 * @param {Object} intent
 * @returns {Array}
 */
export function preRank(candidates, intent) {
  const kws = primaryKeywords(intent);
  const scored = candidates.map((c) => {
    const hay = `${c.fullName || ''} ${c.title || ''} ${c.snippet || ''}`.toLowerCase();
    return { c, s: kws.filter((k) => hay.includes(k)).length };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.c);
}

/** Normalizes stars to 0..1 via log10 (1M+ ~= 1.0). */
function normStars(stars) {
  return Math.min(1, Math.log10((Number(stars) || 0) + 1) / 6);
}

/** Normalizes recency to 0..1 from the lastUpdated ISO date. */
function normRecency(lastUpdated) {
  if (!lastUpdated) return 0.3;
  const then = new Date(lastUpdated).getTime();
  if (Number.isNaN(then)) return 0.3;
  const days = (Date.now() - then) / 86400000;
  if (days <= 180) return 1;
  if (days <= 730) return 0.5;
  return 0;
}

/**
 * Selects up to `perKeyword` items per keyword (union, dedup by fullName),
 * scanning `items` in their given (priority) order. Pure.
 * @param {Array<{fullName:string,matchedKeywords?:string[]}>} items already sorted best-first
 * @param {string[]} kws
 * @param {number} perKeyword
 * @returns {Array}
 */
export function takePerKeyword(items, kws, perKeyword) {
  const lower = kws.map((k) => String(k).toLowerCase());
  const selected = new Map();
  for (const kw of lower) {
    let taken = 0;
    for (const it of items) {
      if (taken >= perKeyword) break;
      const matched = ((it && it.matchedKeywords) || []).map((k) => String(k).toLowerCase());
      if (matched.includes(kw) && !selected.has(it.fullName)) {
        selected.set(it.fullName, it);
        taken++;
      }
    }
  }
  return [...selected.values()];
}

/**
 * Full tiered ranking, then per-keyword selection with a global safety-net fallback.
 * Returns repos with score/scoreBreakdown, guaranteeing coverage of the searched keywords.
 * @param {Array} enriched
 * @param {Object} intent
 * @returns {Array}
 */
export function rankRepos(enriched, intent) {
  const kws = primaryKeywords(intent);
  const w = RANKING_WEIGHTS;

  const scored = enriched
    .filter((r) => r && !r._failed)
    .map((repo) => {
      const name = (repo.fullName || '').toLowerCase();
      const desc = (repo.description || '').toLowerCase();
      const readme = (repo.readmeSnippet || '').toLowerCase();

      const nameHits = kws.filter((k) => name.includes(k)).length;
      const descHits = kws.filter((k) => desc.includes(k)).length;
      const readmeHits = kws.filter((k) => readme.includes(k)).length;
      const hay = `${name} ${desc} ${readme}`;
      const coverage = kws.length ? kws.filter((k) => hay.includes(k)).length / kws.length : 0;

      const nameScore = kws.length ? Math.min(1, nameHits / kws.length) : 0;
      const descScore = kws.length ? Math.min(1, descHits / kws.length) : 0;
      const readmeScore = kws.length ? Math.min(1, readmeHits / kws.length) : 0;
      const starsScore = normStars(repo.stars);
      const recencyScore = normRecency(repo.lastUpdated);

      const score =
        w.w_name * nameScore +
        w.w_desc * descScore +
        w.w_readme * readmeScore +
        w.w_keyword_coverage * coverage +
        w.w_stars * starsScore +
        w.w_recency * recencyScore;

      return {
        ...repo,
        score: Math.round(score * 1000) / 1000,
        scoreBreakdown: {
          name: Math.round(nameScore * 100) / 100,
          desc: Math.round(descScore * 100) / 100,
          readme: Math.round(readmeScore * 100) / 100,
          coverage: Math.round(coverage * 100) / 100,
          stars: Math.round(starsScore * 100) / 100,
          recency: Math.round(recencyScore * 100) / 100,
        },
      };
    });

  const best = new Map();
  for (const r of scored) {
    if (!best.has(r.fullName) || r.score > best.get(r.fullName).score) best.set(r.fullName, r);
  }
  const byScore = [...best.values()].sort((a, b) => b.score - a.score);

  // Per-keyword selection: guarantees representation of every searched keyword.
  const picked = takePerKeyword(byScore, kws, PER_KEYWORD);
  const pickedNames = new Set(picked.map((r) => r.fullName));

  // Safety-net fallback: top up to TOP_N_REPOS with the best remaining globals
  // (covers repos without matchedKeywords - e.g. GitHub API fallback - or empty-keyword SERPs).
  if (picked.length < TOP_N_REPOS) {
    for (const r of byScore) {
      if (picked.length >= TOP_N_REPOS) break;
      if (!pickedNames.has(r.fullName)) {
        picked.push(r);
        pickedNames.add(r.fullName);
      }
    }
  }

  return picked.sort((a, b) => b.score - a.score);
}

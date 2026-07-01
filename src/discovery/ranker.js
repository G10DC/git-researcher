// src/discovery/ranker.js
// PURE ranking functions (no I/O).
// preRank: cheap ordering on fullName+title+snippet to pick what to enrich.
// rankRepos: tiered scoring truncated to config.TOP_N_REPOS.

import { TOP_N_REPOS, RANKING_WEIGHTS } from '../core/config.js';

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
 * Full tiered ranking. Returns the top-N ranked repos with score/scoreBreakdown.
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

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, TOP_N_REPOS);
}

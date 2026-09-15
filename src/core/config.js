// src/core/config.js
// Centralized configuration. Exports constants only, no logic.

/** Number of repos to analyze in depth (final truncation in the ranker). Unique name. */
export const TOP_N_REPOS = 5;

/** Number of candidates to enrich (applied AFTER preRank). */
export const MAX_CANDIDATES = 30;

/** Keyword budget for DuckDuckGo queries (single-keyword queries). */
export const MAX_KEYWORDS = 6;

/** Max concurrency for independent Analysis Engine calls. */
export const POOL_SIZE = 3;

/** Primary DuckDuckGo endpoint (server-rendered, no browser). */
export const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/';

/** Fallback DuckDuckGo endpoint (simpler markup). */
export const DUCKDUCKGO_LITE = 'https://lite.duckduckgo.com/lite/';

/** If true, send the query as a form field in a POST (more stable than GET). */
export const USE_DDG_POST = true;

/** Dork templates with placeholders {kw} (keyword) and {tech} (technology). */
export const DORK_TEMPLATES = [
  'site:github.com {kw}',
  'site:github.com {kw} inurl:topics',
  'site:github.com {tech} {kw}',
];

/** Delay between HTTP requests (ms) for honest rate limiting. */
export const REQUEST_DELAY_MS = 1500;

/** Timeout for the DuckDuckGo fetch via AbortController (ms). */
export const FETCH_TIMEOUT_MS = 30000;

/** Timeout for native fetch on the GitHub enricher (ms). Distinct from FETCH_TIMEOUT_MS. */
export const NAV_TIMEOUT_MS = 45000;

/** Max attempts on a failed/empty request. */
export const MAX_RETRIES = 3;

/** Timeout for a single Analysis Engine CLI call (ms). The synthesis step aggregates many analyses
 * (two lenses/repo + adversarial review) and generates a long report, so it needs ample headroom. */
export const CLAUDE_TIMEOUT_MS = 600000;

/** Hierarchical ranking weights (weighted sum = final score). */
export const RANKING_WEIGHTS = {
  w_name: 1.5,
  w_desc: 1.0,
  w_readme: 0.8,
  w_keyword_coverage: 2.0,
  w_stars: 0.5,
  w_recency: 0.5,
};

/** Constant browser User-Agent (rotation on a single IP looks more bot-like).
 *  An honest one was measured on 2026-09-15 and refused: DuckDuckGo answered HTTP 202 with a
 *  challenge page and zero results on both endpoints, against 200 and seven results for this
 *  one. Both SERP hosts allow everything in robots.txt; duckSearch reports a 202 as a block. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Project reports folder (relative to cwd). */
export const PATH_PROJECTS = 'projects';

/** On-disk cache folder. */
export const CACHE_DIR = '.cache';

/** Cache TTL in hours. */
export const CACHE_TTL_HOURS = 72;

/** If true (or env GITHUB_API_DISCOVERY_FALLBACK=true), the pipeline uses the GitHub Search API
 * as a fallback when DDG returns empty/blocked. Recommended over relying on DDG scraping alone
 * (which is rate-limited/flaky). Pair with GITHUB_TOKEN for a higher rate limit. */
export const GITHUB_API_DISCOVERY_FALLBACK = process.env.GITHUB_API_DISCOVERY_FALLBACK === 'true';

// --- Multi-source inspiration layer (ROADMAP near-term) ---
// Each source is a small module implementing searchX(intent, deps) -> Result[].
// Result: { title, summary, url, source, meta? }.

/** Top-K inspiration results kept per source (HN / npm / SO / papers). */
export const INSPIRATION_TOP_K = 5;

/** Algolia Hacker News search endpoint (stories, free, no key). */
export const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search';

/** npm registry search endpoint (free, no key). */
export const NPM_ENDPOINT = 'https://registry.npmjs.org/-/v1/search';

/** Stack Exchange advanced search endpoint (site=stackoverflow; optional SO_API_KEY raises the quota). */
export const STACKOVERFLOW_ENDPOINT = 'https://api.stackexchange.com/2.3/search/advanced';

/** OpenAlex works search endpoint (academic, polite pool via mailto, no key). */
export const OPENALEX_ENDPOINT = 'https://api.openalex.org/works';

/** mailto for the OpenAlex polite pool. Override for a project-specific address. */
export const OPENALEX_MAILTO = 'gitresearcher@example.com';

// --- Per-keyword discovery coverage ---
// Discovery now guarantees representation of every searched keyword, not just the globally-top repos.

/** Repos selected PER keyword in the final ranking (coverage over raw popularity). */
export const PER_KEYWORD = 2;

/** Candidates enriched per keyword (broad pool so the per-keyword ranker has material). */
export const ENRICH_PER_KEYWORD = 5;

// --- Per-run spend ceiling ---
// SKILL.md used to warn that "the cascade has no built-in request budget". That warning was
// attached to no mechanism, and it mattered less than it looked only because the
// discovery was sending no query at all. Now that it does, the fan-out is real and
// bounded here. A typical run measures ~18 model calls and ~40 HTTP requests: these
// ceilings sit well above that, so they catch a runaway idea rather than a normal one.

/** Model calls allowed in a single run. Exceeding it aborts the run rather than billing on. */
export const MAX_LLM_CALLS = 40;

/** HTTP requests allowed in a single run, across discovery, enrichment and inspiration. */
export const MAX_HTTP_REQUESTS = 150;

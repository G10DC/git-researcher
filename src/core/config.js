// src/core/config.js
// Centralized configuration. Exports constants only, no logic.

/** Number of repos to analyze in depth (final truncation in the ranker). Unique name. */
export const TOP_N_REPOS = 5;

/** Number of candidates to enrich (applied AFTER preRank). */
export const MAX_CANDIDATES = 30;

/** Keyword budget for DuckDuckGo queries (single-keyword queries). */
export const MAX_KEYWORDS = 6;

/** Max concurrency for independent Claude calls. */
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

/** Timeout for puppeteer page.goto on the GitHub enricher (ms). Distinct from FETCH_TIMEOUT_MS. */
export const NAV_TIMEOUT_MS = 45000;

/** Max attempts on a failed/empty request. */
export const MAX_RETRIES = 3;

/** Timeout for a single Claude CLI call (ms). */
export const CLAUDE_TIMEOUT_MS = 180000;

/** Hierarchical ranking weights (weighted sum = final score). */
export const RANKING_WEIGHTS = {
  w_name: 1.5,
  w_desc: 1.0,
  w_readme: 0.8,
  w_keyword_coverage: 2.0,
  w_stars: 0.5,
  w_recency: 0.5,
};

/** Constant realistic browser User-Agent (rotation on a single IP looks more bot-like). */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Project reports folder (relative to cwd). */
export const PATH_PROJECTS = 'projects';

/** On-disk cache folder. */
export const CACHE_DIR = '.cache';

/** Cache TTL in hours. */
export const CACHE_TTL_HOURS = 72;

/** If true, the pipeline uses the GitHub Search API as a fallback when DDG returns empty/blocked. */
export const GITHUB_API_DISCOVERY_FALLBACK = false;

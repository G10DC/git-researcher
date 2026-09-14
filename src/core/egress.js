// src/core/egress.js
// A domain allowlist that does not depend on anything being installed.
//
// The pipeline asks `sentinel` for an egress guard, importing it from a sibling directory
// (`../../sentinel/lib/sentinel.js`). That path exists in the installed-skills layout and
// nowhere else: in a plain clone, and in CI, the import fails and the guard degrades to a
// no-op. That degradation is announced now -- it used to be silent -- but announced or
// not, every request still left unfiltered on the machines where the guard was missing,
// which is most of them.
//
// So the allowlist lives here, in the repository that makes the requests, with no import
// and no optional dependency. `sentinel` stays useful where it is present: it also scans
// bodies for secrets and PII, which this does not attempt. This is the floor, not the
// ceiling -- what holds when nothing else is installed.
//
// The list is the one the pipeline already declared in pipeline.js, kept in one place now
// rather than two, because two copies of an allowlist drift and the drift is invisible.

/** Hosts this pipeline is allowed to contact, and why each one is here. */
export const ALLOWED_HOSTS = Object.freeze([
  'html.duckduckgo.com',      // discovery: SERP (primary)
  'lite.duckduckgo.com',      // discovery: SERP (fallback endpoint)
  'duckduckgo.com',           // discovery: redirect host in uddg links
  'github.com',               // enrichment: repository pages
  'raw.githubusercontent.com',// enrichment: raw README
  'api.github.com',           // discovery fallback + open issues
  'hn.algolia.com',           // inspiration: Hacker News
  'news.ycombinator.com',     // inspiration: HN item links
  'registry.npmjs.org',       // inspiration: npm
  'api.stackexchange.com',    // inspiration: Stack Overflow
  'api.openalex.org',         // inspiration: academic prior art
  'generativelanguage.googleapis.com', // analysis: Gemini fallback
  'openrouter.ai'             // analysis: OpenRouter fallback
]);

/** Raised when a request is aimed at a host the pipeline never declared. */
export class EgressDeniedError extends Error {
  constructor(host, url) {
    super(
      `egress denied: '${host}' is not in the allowlist. ` +
      `If this pipeline should reach it, add it to ALLOWED_HOSTS in src/core/egress.js.`
    );
    this.name = 'EgressDeniedError';
    this.host = host;
    this.url = url;
    // Same contract the spend ceiling uses: a refusal is a decision, and retrying a
    // decision three times only delays the same answer. See core/utils.withRetry.
    this.noRetry = true;
  }
}

/**
 * True when `url` points at an allowed host. Subdomains are NOT implied: a host matches
 * only itself, because "endsWith('.github.com')" would also accept
 * "github.com.attacker.example", and an allowlist that can be suffixed is not one.
 *
 * @param {string} url
 * @param {string[]} [hosts]
 * @returns {boolean}
 */
export function isAllowedUrl(url, hosts = ALLOWED_HOSTS) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false; // an unparseable URL is not a known-good one
  }
  // Only http(s): a file:// or data: URL would sail past a hostname check with no host.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return hosts.includes(parsed.hostname);
}

/**
 * Wraps a fetch implementation so a request to an undeclared host is refused before it is
 * sent. Compose it with the budget's counter: the two are separate concerns -- how much a
 * run may spend, and where it may spend it.
 *
 * @param {Function} [fetchImpl] defaults to global fetch
 * @param {string[]} [hosts]
 * @returns {Function} the same contract, filtered
 */
export function guardFetch(fetchImpl, hosts = ALLOWED_HOSTS) {
  const inner = fetchImpl || ((...a) => fetch(...a));
  // async on purpose: fetch always returns a promise, so a refusal has to be a rejected
  // one. Throwing synchronously skips every `.catch()` a caller wrote and surfaces as a
  // crash from a function whose contract says it cannot crash.
  return async (...args) => {
    const url = args[0];
    if (!isAllowedUrl(url, hosts)) {
      let host;
      try {
        host = new URL(String(url)).hostname || String(url);
      } catch {
        host = String(url);
      }
      throw new EgressDeniedError(host, String(url));
    }
    return inner(...args);
  };
}

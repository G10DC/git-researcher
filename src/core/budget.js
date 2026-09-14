// src/core/budget.js
// A declared ceiling on what one run may spend, and a count of what it did spend.
//
// SKILL.md says it plainly: "the cascade has no built-in request budget, so a vague query
// can multiply discovery/analysis API calls". That was an honest warning attached to no
// mechanism. It also mattered less than it looked, because the discovery was handing
// searchRepos a bare string and sending no query at all -- fixing that wiring is what
// reopens the fan-out this module now bounds.
//
// Two ceilings, because there are two kinds of spend and they fail differently: model
// calls cost money per call, HTTP requests cost goodwill with the hosts being scraped.
//
// The counters exist for a second reason, independent of the ceiling: a run that cannot
// say what it spent cannot be told apart from a run that did nothing. Every count is
// reported whether or not a limit was reached.

/** The config constant that raises each ceiling. Named, not derived: deriving it from
 *  `kind` produced "MAX_HTTP_CALLS", which does not exist -- a message pointing at a
 *  constant nobody can find is the defect this project keeps finding in its own docs. */
const CEILING_CONSTANT = { llm: 'MAX_LLM_CALLS', http: 'MAX_HTTP_REQUESTS' };

/** Raised when a run asks for more than its declared ceiling allows. */
export class BudgetExceededError extends Error {
  constructor(kind, used, limit) {
    super(
      `${kind} budget exhausted: ${used} of ${limit} allowed in a single run. ` +
      `Narrow the idea, or raise ${CEILING_CONSTANT[kind] ?? kind} in src/core/config.js.`
    );
    this.name = 'BudgetExceededError';
    this.kind = kind;
    this.used = used;
    this.limit = limit;
    // A generic contract rather than a type check, so core/utils.withRetry can honour it
    // without importing this module: utils.js declares itself dependency-free, and the
    // package layout in docs/ARCHITECTURE.md rests on that being true. Retrying a ceiling
    // is meaningless anyway -- it is a decision, and it will refuse again.
    this.noRetry = true;
  }
}

/**
 * Rethrows a budget refusal out of a catch that would otherwise degrade it.
 *
 * This pipeline degrades on purpose nearly everywhere: a blocked source returns [], a
 * failed analysis becomes a note, and the run continues with partial results. That is
 * right for a source that failed and wrong for a ceiling that refused, because the two
 * produce the same silence downstream -- the discovery even reported "No results
 * (empty/blocked SERP)" for requests it had never sent. A ceiling is a decision, not a
 * fault: it must reach the caller intact.
 *
 * Call it first inside any catch that swallows errors.
 * @param {unknown} err
 */
export function rethrowIfBudget(err) {
  if (err instanceof BudgetExceededError) throw err;
}

/**
 * Creates a per-run budget. One instance per pipeline run: the counts are the run's,
 * not the process's, so two runs in the same process do not inherit each other's spend.
 *
 * @param {{maxLlmCalls?:number, maxHttpRequests?:number}} [limits]
 * @returns {{countLlm:Function, countHttp:Function, wrapFetch:Function, report:Function}}
 */
export function createBudget(limits = {}) {
  const maxLlm = Number.isFinite(limits.maxLlmCalls) ? limits.maxLlmCalls : Infinity;
  const maxHttp = Number.isFinite(limits.maxHttpRequests) ? limits.maxHttpRequests : Infinity;

  let llm = 0;
  let http = 0;

  /** Counts one model call. Throws once the ceiling is reached, before the call is made. */
  const countLlm = () => {
    if (llm >= maxLlm) throw new BudgetExceededError('llm', llm, maxLlm);
    llm += 1;
    return llm;
  };

  /** Counts one HTTP request. Throws once the ceiling is reached, before the request is sent. */
  const countHttp = () => {
    if (http >= maxHttp) throw new BudgetExceededError('http', http, maxHttp);
    http += 1;
    return http;
  };

  /**
   * Wraps a fetch implementation so every request it makes is counted against the run.
   *
   * This is the whole reason the ceiling needs no change in duckSearch, repoEnricher,
   * githubApiFallback, hnSearch, npmSearch, paperSearch or soSearch: each of them already
   * takes its fetch through `deps.fetchImpl`, so the pipeline injects a counted one and
   * the six modules stay exactly as they are.
   *
   * @param {Function} [fetchImpl] defaults to global fetch
   * @returns {Function} the same contract, counted
   */
  const wrapFetch = (fetchImpl) => {
    const inner = fetchImpl || ((...a) => fetch(...a));
    // async for the same reason as core/egress.guardFetch: fetch returns a promise, so a
    // refusal must be a rejected promise rather than a synchronous throw past every
    // `.catch()` the caller wrote.
    return async (...args) => {
      countHttp();
      return inner(...args);
    };
  };

  /** What this run actually spent. Reported whether or not a ceiling was reached. */
  const report = () => ({
    llmCalls: llm,
    httpRequests: http,
    maxLlmCalls: maxLlm,
    maxHttpRequests: maxHttp
  });

  return { countLlm, countHttp, wrapFetch, report };
}

/** A budget that counts nothing and refuses nothing. For dry runs and for tests. */
export const NOOP_BUDGET = {
  countLlm: () => 0,
  countHttp: () => 0,
  wrapFetch: (fetchImpl) => fetchImpl || ((...a) => fetch(...a)),
  report: () => ({ llmCalls: 0, httpRequests: 0, maxLlmCalls: Infinity, maxHttpRequests: Infinity })
};

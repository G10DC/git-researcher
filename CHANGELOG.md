# Changelog

Format inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow
[Semantic Versioning](https://semver.org/).

## [3.4.0] - 2026-09-14 - The run that had never run

An audit of this repository against its own documentation. The headline defect is that
**no real run had ever worked**: `projects/` was empty on every copy, and two independent
faults explain why. Everything below was measured, not inferred.

### Fixed

- **Discovery sent no query at all.** `pipeline.js` handed `searchRepos` a bare keyword
  string, but `buildQueries` reads `intent.keywords`. Every real run produced zero
  DuckDuckGo queries, and the empty result was read as "no candidates found" and routed
  into the API fallback — capped at 3 keywords and sorted by stars, the opposite of the
  per-keyword coverage this pipeline claims. The regression asserts a request was *sent*,
  not that candidates came back.
- **The auth check ran the wrong command.** `checkAuth` asked for `claude status`, which
  prompts the *model* for a prose summary of the working directory: it spent a request,
  outlived its own 4s timeout, and concluded the CLI was signed out. Every run was then
  diverted to the API fallback, where an account with no credits answered `402` and killed
  phase 1. The command is `claude auth status`, and the verdict now reads `loggedIn`
  rather than the absence of "Not signed in" — a check that treats unexpected output as
  success cannot fail closed.
- **`authState` was declared and never assigned**, so the auth cache never hit and every
  call spawned a process. `_resetProbe` clears it too.
- **`handleFallback` is a chain, not a choice.** Holding an OpenRouter key meant Gemini was
  never tried, making one `402` fatal in a module that degrades almost everywhere else.
- **Dead configuration.** `config.PER_KEYWORD_LIMIT` is not exported, so `|| 3` always won
  and `ENRICH_PER_KEYWORD` was dead; `MAX_CANDIDATES` was never applied; the
  `GITHUB_API_DISCOVERY_FALLBACK` flag was never read, so the fallback ran unconditionally
  and silently. It is read now, and says why it did *not* run.

### Added

- **`core/budget.js`** — a declared per-run ceiling on model calls and HTTP requests,
  injected through the keys each module actually reads (`repoEnricher` reads `getPage`,
  not `fetchImpl`), plus a spend report on every run. A run that cannot say what it spent
  cannot be told apart from a run that did nothing.
- **`core/egress.js`** — the domain allowlist, with no import and no optional dependency.
  The guard used to come from `sentinel`, imported from a sibling directory that exists in
  the installed-skills layout and nowhere else: in a clone and in CI every request left
  unfiltered. It refuses non-http schemes and does not imply subdomains, because
  `endsWith('.github.com')` also accepts `github.com.attacker.example`.
- **CI** now runs `scripts/check.mjs` and the linter. `check.mjs` asserts a module exports
  the names its callers expect — exactly the tool that would have caught
  `PER_KEYWORD_LIMIT`, read for months and never exported.
- **`.gitattributes`** — commit LF, and leave `tests/fixtures` byte-for-byte: the captured
  SERP the parser tests compare against was being rewritten by renormalisation.

### Changed

- `rethrowIfBudget` / a generic `noRetry` property: a refused ceiling is a decision, not a
  transient fault. It was being caught by the same handlers that absorb a blocked source,
  so the discovery reported "No results (empty/blocked SERP)" for requests never sent, and
  `withRetry` retried the refusal three times before giving up.
- `guardFetch` and `budget.wrapFetch` are async: `fetch` returns a promise, so a refusal
  has to be a rejected one rather than a synchronous throw past every `.catch()`.
- The allowlist existed in three copies (`pipeline.js`, `repoEnricher.js`, sentinel's own
  config). Now one. Two copies drift, and the drift is invisible.

### Documentation

`refs/honesty.md` claimed a multi-source corroboration the ranker does not compute, and a
three-tier confidence model that appears nowhere in `src/` (`grep -ri confidence src/`
returns zero). Both deleted rather than softened. `ARCHITECTURE.md` and `config.js` still
named puppeteer, removed in `697af73`. `SKILL.md` attributed HTML scraping to Hacker News
and Stack Overflow, which use JSON APIs.

- **Coverage**: the documented 96.2 / 93.2 / 80.7 could not be reproduced by any
  invocation. The measured figures are **90.9% lines / 81.0% functions / 68.2% branch**,
  now quoted together with the command that produces them.

### Notes

The tests went from 109 to 141. The recurring theme of every defect above is the same
distinction: **"nothing found" and "nothing looked at" are different states**, and this
codebase had collapsed them in five separate places.

## [3.3.0] - 2026-07-02 - Per-keyword discovery + multi-perspective agents

### Added
- **Per-keyword discovery coverage**: candidates are now tagged with the keyword(s) that surfaced
  them (`matchedKeywords`, propagated through `duckSearch` -> `repoEnricher`); the ranker selects
  up to `PER_KEYWORD` repos **per searched keyword** (`takePerKeyword`), so minority components of
  the idea are represented instead of being crowded out by a few popular repos. `ENRICH_PER_KEYWORD`
  broadens the enriched pool; `TOP_N_REPOS` remains as a global safety-net cap.
- **Second analysis lens per repo**: `analyzeRepoWithCritique` runs a "Security & Reliability
  Auditor" alongside the "Code Archaeologist" in parallel -> genuine multi-perspective analysis.
  Repo docs carry the role in the filename (`3_repo_analysis_<n>_<owner>_<repo>_<role>.md`).
- **Adversarial review (progressive verification)**: `analysis/adversarialReview.js` - a single
  devil's-advocate agent that challenges the high-impact claims of the repo + module analyses
  before synthesis; surfaced as `7_critical_review.md` and a `## Critical review` synth section +
  report section "Critical Considerations and Risk Register". (Promotes a ROADMAP medium-term item.)

### Changed
- `duckSearch.buildQueries` now returns `[{ q, kw }]` (query + its keyword) to drive the tagging.
- `synthesizer`: `buildSynthesisPrompt` extracted (keeps `synthesizeReport` under the complexity
  threshold now that it takes an extra `criticalReview` argument).

### Notes
- The Auditor reuses the same `fetchIssues` path as the Archaeologist (one extra issues fetch per
  repo in real mode); acceptable for the typical 5-12 repo batch.

## [3.2.0] - 2026-07-02 - Multi-source inspiration layer

### Added
- **Inspiration fan-out**: a software idea is now designed against multiple independent axes, not
  just GitHub. Four new discovery sources implement a uniform `searchX(intent, deps) -> Result[]`
  contract (`{ title, summary, url, source, meta? }`):
  - `src/discovery/hnSearch.js` - Hacker News (Algolia API): practitioner discussions, primers, war stories.
  - `src/discovery/npmSearch.js` - npm registry: composable packages and their popularity.
  - `src/discovery/soSearch.js` - Stack Exchange API: cross-project pain points (optional `SO_API_KEY`).
  - `src/discovery/paperSearch.js` - OpenAlex: academic prior art (polite pool via `mailto`, no key).
- **`pipeline.gatherInspiration`**: parallel fan-out (`runPool`, top-K per source). Each source is
  rate-limit-aware + cache-friendly and **fails non-fatal** (a blocked/empty source degrades to `[]`,
  never blocking the pipeline).
- **`synthesizer`**: new `## Inspiration from other sources` prompt section + report section
  "What to Read, Reuse, and Avoid"; results persisted as `6_inspiration.json`.
- `config`: `INSPIRATION_TOP_K` + HN/npm/StackOverflow/OpenAlex endpoints + `OPENALEX_MAILTO`.
- Tests: new `tests/inspiration.test.js` (10 tests across the four sources, `formatInspiration`,
  `gatherInspiration`).

### Changed
- `reportWriter`: shared `writeAnalyses` helper (DRY between repo and module docs) - keeps
  `writeDocs` under the complexity threshold.
- `testing/mocks`: added `mockHn`/`mockNpm`/`mockSo`/`mockPapers` so `dryRun` stays fully offline.

### Notes
- Academic source is **OpenAlex only** (Semantic Scholar kept as a deferred alternative). Google
  Scholar remains an explicit non-goal (no API, CAPTCHA/bans, ToS) - see `ROADMAP.md`.

## [3.1.0] - 2026-07-01 - Grounded analyses + robust discovery

### Added
- **Open issues as an analysis signal**: `repoEnricher` extracts an `openIssues` count; the most
  discussed open issues are fetched (`githubApiFallback.fetchOpenIssues`, PRs excluded) and injected
  into the per-repo analysis as real user pain points (limitations/risks + lessons-for-the-idea).
- **`githubGet`**: rate-limit-aware GitHub API helper - warns on low `X-RateLimit-Remaining`, backs
  off once on `Retry-After` / 429 / 403. Reused by the discovery fallback and `fetchOpenIssues`.
- **`CLAUDE_EXTRA_ARGS`**: forward-compatible hook for determinism/model flags on the Analysis Engine CLI
  (the CLI does not expose `--temperature` as of v2.1.x).
- **`ROADMAP.md`**: the multi-source inspiration direction and deferred ideas.
- Tests: new `tests/repoAnalyzer.test.js` + `openIssues`, `fetchOpenIssues`, `CLAUDE_EXTRA_ARGS`.

### Changed
- `repoAnalyzer`: low-signal guard (metadata-only mode when the README is missing/tiny) and a system
  prompt that forbids requesting tools/permissions - fixes the degenerate "grant permissions"
  analysis seen on low-signal repos.
- `repoEnricher`: DRY `counterFrom` helper (stars + openIssues).
- `pipeline` / `testing/mocks`: wire `fetchIssues` (real API vs dryRun mock).

### Notes
- Google Scholar scraping is intentionally **not** pursued (no API, CAPTCHA/bans, ToS). Academic
  discovery will use OpenAlex / Semantic Scholar instead - see `ROADMAP.md`.

## [3.0.0] - 2026-07-01 - Structural refactor and quality gate

### Added
- **Package architecture**: `src/core` (config, utils, errors, claude), `src/discovery`
  (intentExtractor, serpParser, duckSearch, repoEnricher, ranker, githubApiFallback),
  `src/analysis` (repoAnalyzer, cascadeOrchestrator, synthesizer), `src/io` (reportWriter, cache),
  `src/testing` (mocks).
- **`core/errors.js`**: custom exception hierarchy (`GitResearcherError`, `ClaudeError`,
  `DiscoveryError`, `EnrichmentError`) for centralized error handling.
- **`core/utils.withRetry`**: shared backoff retry (DRY) used by `duckSearch` and `repoEnricher`.
- **`discovery/serpParser.js`**: PURE SERP parsing extracted from `duckSearch` (testability + reuse).
- **`testing/mocks.js`**: dryRun mocks extracted from the pipeline (slim orchestrator).
- **CI** (`.github/workflows/ci.yml`): lint + test + coverage + smoke on Node 20/22.
- **ESLint** (flat config `eslint.config.js`, rules + complexity threshold).
- **`CHANGELOG.md`**, **`docs/ARCHITECTURE.md`** (Mermaid diagrams), **`.gitignore`**.
- Extended test suite: `utils`, `errors`, `claude` (mock spawn), `repoEnricher`, `reportWriter`
  + end-to-end `searchRepos` test and `/lite/` fallback.

### Changed
- `core/claude.js`: **injectable** spawner (`deps.spawn`) -> unit-testable without a real process.
- `pipeline.js`: slim; `rootCopy: !dry` -> the smoke test no longer leaves a root copy around (littering bug fix).
- Coverage: **94.9% lines / 91.6% functions / 74% branch** (from 86.7% / 59.8%).

### Removed
- 13 flat modules in `src/` (migrated into packages).
- extraneous `dotenv` from `node_modules` (`npm prune`).
- `.DS_Store` (x3), stale `architectural_report.md` (test artifact).

## [2.1.0] - 2026-07-01 - Second-level review

### Fixed
- `duckSearch`: **decode the DDG redirect** (`uddg`) before the github filter.
- `RepoCandidate` extended with `title`+`snippet`; `preRank` on name+title+snippet.
- **single-keyword** queries (no AND-grouping).
- Browser lifecycle clarified in `repoEnricher`; `NAV_TIMEOUT_MS` is distinct.
- `runClaudeJSONWithRetry` generalized (also used in the module breakdown).
- `claude` binary probe made lazy; constant UA; `/lite/` endpoint + POST.
- The `duckSearch` fixture must be a real SERP (skip if missing).

## [2.0.0] - 2026-07-01 - Merged tool (discovery + cascade)

Merge of the GitHub researcher (idea -> repo search) and the agent cascade loop
(module breakdown -> specialists -> synthesis), with the found repos informing the specialists.
Development plan documented in `PIANIFICAZIONE/` (ralph_plan.json v2.1 + SPEC).

## [Pre-1.0] - legacy

- Original GitHub researcher (source code lost; reference output in
  `projects/20260701_110552/`).
- Cascade-loop test (superseded by the merged tool).

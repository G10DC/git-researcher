# Changelog

Format inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow
[Semantic Versioning](https://semver.org/).

## [3.1.0] - 2026-07-01 - Grounded analyses + robust discovery

### Added
- **Open issues as an analysis signal**: `repoEnricher` extracts an `openIssues` count; the most
  discussed open issues are fetched (`githubApiFallback.fetchOpenIssues`, PRs excluded) and injected
  into the per-repo analysis as real user pain points (limitations/risks + lessons-for-the-idea).
- **`githubGet`**: rate-limit-aware GitHub API helper - warns on low `X-RateLimit-Remaining`, backs
  off once on `Retry-After` / 429 / 403. Reused by the discovery fallback and `fetchOpenIssues`.
- **`CLAUDE_EXTRA_ARGS`**: forward-compatible hook for determinism/model flags on the Claude CLI
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

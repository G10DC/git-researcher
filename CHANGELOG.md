# Changelog

Format inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow
[Semantic Versioning](https://semver.org/).

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

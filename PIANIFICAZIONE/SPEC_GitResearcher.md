# Specification - GitResearcher (merged tool) · v2.1

> Planning document (NOT implementation). Companion to `ralph_plan.json` (v2.1).
> Style: Ralph Loop planning. Runtime: **Node.js 18+**, ES modules.
> Repo discovery via **DuckDuckGo + dorks (fetch + cheerio, `/html/` endpoint with `/lite/` fallback and `uddg` redirect decode)**; **enrichment in pure scraping (puppeteer + cheerio on GitHub)** - a deliberate choice.

---

## 1. Goal and context

A terminal tool that, given a **software idea in natural language**, produces a **set of structured
analysis documents**. It merges two ideas: the GitHub researcher (idea -> repo search -> analysis)
and the agent cascade loop (breakdown into modules -> specialists -> synthesis). Value: **study what
already exists and then design your own version informed by it**.

**Primary input**: the idea text. **Autonomous tool** (`npm start`), not integrated into the Python
Ralph Loop engine.

---

## 2. Architecture (file structure)

```
GitResearcher/
├── package.json               # deps: chalk, cheerio, ora, puppeteer (NO dotenv)
├── index.js                   # CLI entry (readline -> runPipeline)
├── claude.js                  # backwards-compat shim (re-export from src/)
├── scripts/
│   └── check.mjs              # import-smoke: verifies exports (used in validation_command)
├── src/
│   ├── config.js              # unique constants + weights + dork templates + budget + constant UA
│   ├── utils.js               # getTimestamp, cleanJsonString, safeJsonParse, sleep, runPool
│   ├── claude.js              # runClaude, runClaudeJSON, runClaudeJSONWithRetry + lazy probe
│   ├── intentExtractor.js     # idea -> components/keywords            (DI: runClaudeJSONWithRetry)
│   ├── duckSearch.js          # DuckDuckGo + dorks (fetch+cheerio, decode uddg)  (DI: fetchImpl)
│   ├── repoEnricher.js        # GitHub metadata (puppeteer/cheerio)    (DI: getPage)
│   ├── ranker.js              # preRank (name+title+snippet) + rankRepos (PURE)
│   ├── repoAnalyzer.js        # per-repo analysis (Analysis Engine)             (DI: runClaude)
│   ├── cascadeOrchestrator.js # cascade modules + specialists (Analysis Engine) (DI: runClaude*/runClaudeJSONWithRetry)
│   ├── synthesizer.js         # final report (Analysis Engine)                  (DI: runClaude)
│   ├── reportWriter.js        # structured document writing
│   ├── pipeline.js            # orchestrator (glue) + main argv block + dryRun
│   ├── cache.js               # (OPTIONAL) on-disk cache of SERP/repo pages
│   └── githubApiFallback.js   # (OPTIONAL) discovery via GitHub Search API if DDG is blocked
├── tests/
│   ├── fixtures/
│   │   └── ddg_site_github.html  # REAL DDG SERP captured (curl), not synthetic
│   ├── ranker.test.js         # unit test on the pure function
│   ├── duckSearch.test.js     # selectors + uddg decode on the real fixture (fetchImpl mock)
│   └── smoke_pipeline.test.js # e2e in dryRun with DI mocks
├── projects/                  # output (one folder per run)
└── PIANIFICAZIONE/            # this document + ralph_plan.json
```

Principle: **modular library**. Core (`src/`) is independent of the CLI. **No module in `src/` imports
from `index.js`**.

---

## 3. Execution flow

```
Idea (text)
    │
 [intentExtractor]      -> IntentResult { components, technologies, keywords }
    │
 [duckSearch]           -> RepoCandidate[] { fullName, url, title, snippet }   (fetch+cheerio, decode uddg)
    │                       (+ githubApiFallback if DDG blocked and flag on)
    │
 [ranker.preRank]       -> RepoCandidate[] sorted  (cheap match on fullName+title+snippet)
    │
 [repoEnricher]         -> RepoEnriched[]   (top MAX_CANDIDATES of preRank; puppeteer/cheerio)
    │
 [ranker.rankRepos]     -> RankedRepo[] top-N  (tier scoring, truncated to TOP_N_REPOS)
    │
 [repoAnalyzer]         -> RepoAnalysis[]   (POOL_SIZE pool, one analysis per repo)
    │
 [cascadeOrchestrator]  -> ModuleSpec[] + ModuleAnalysis[]  (breakdown via runClaudeJSONWithRetry, specialists informed by the repos)
    │
 [synthesizer]          -> final_report.md
    │
 [reportWriter]         -> structured documents in projects/<TIMESTAMP>/
```

Each phase is isolated: non-fatal failure -> saves partials and continues.

---

## 4. Module-by-module spec

All modules with I/O expose **dependency injection** (`deps = {}`): default = real implementations;
in `dryRun` the pipeline injects mocks. No ESM mocking.

### `config.js`
Data only. `TOP_N_REPOS` (unique name), `MAX_CANDIDATES` (post preRank), `MAX_KEYWORDS` (DDG budget),
`POOL_SIZE` (Analysis Engine concurrency), `DUCKDUCKGO_HTML`, `DUCKDUCKGO_LITE` (fallback), `USE_DDG_POST`,
`DORK_TEMPLATES`, `REQUEST_DELAY_MS`, `FETCH_TIMEOUT_MS` (DDG fetch), `NAV_TIMEOUT_MS` (puppeteer
page.goto, **distinct**), `MAX_RETRIES`, `CLAUDE_TIMEOUT_MS`, `RANKING_WEIGHTS`, `DEFAULT_USER_AGENT`
(**constant** UA, no rotation), `PATH_PROJECTS`, `CACHE_DIR`, `CACHE_TTL_HOURS`,
`GITHUB_API_DISCOVERY_FALLBACK` (opt-in).

### `utils.js`
`getTimestamp()`, `cleanJsonString()`, `safeJsonParse()`, `sleep(ms)`,
`runPool(items, worker, concurrency)` (limited concurrency, order preserved).

### `claude.js` (reuse + extension)
`runClaude(prompt, systemPrompt?, timeoutMs?, cwd?)`. `runClaudeJSON(...)` ->
`safeJsonParse(cleanJsonString(...))`. **New** `runClaudeJSONWithRetry(prompt, systemPrompt, deps)` ->
retries once with a correction prompt on parse failure (reuses `deps.runClaudeJSON`). **Lazy `claude`
binary probe** (inside `runClaude`, cached in the module, never top-level) so import-smoke and CI do
not fail without the CLI.

### `intentExtractor.js`
`extractIntent(idea, deps = {})` via `deps.runClaudeJSONWithRetry` (retry already centralized, not
duplicated).

### `duckSearch.js`
`searchRepos(intent, deps = {})` -> `RepoCandidate[]`. **fetch + cheerio** on `DUCKDUCKGO_HTML`;
fallback to `DUCKDUCKGO_LITE` if empty/blocked; `USE_DDG_POST`. `deps.fetchImpl`. **`uddg` redirect
decode** (CRITICAL): the `href` of `.result__a` is `//duckduckgo.com/l/?uddg=<enc>` -> extract `uddg`,
`decodeURIComponent`, handle protocol-relative; on the decoded URL filter
`github.com/<owner>/<repo>`. Capture **title** (`.result__a` text) and **snippet**
(`.result__snippet`) for free. Budget: **N single-keyword queries** (capped at `MAX_KEYWORDS`), never
AND-grouping. Anti-block: constant `DEFAULT_USER_AGENT`, delay, retry+backoff, AbortController.

### `repoEnricher.js`
`enrichRepos(candidates, deps = {})` -> `RepoEnriched[]`. **puppeteer + cheerio** on
`github.com/<owner>/<repo>`. **Clear lifecycle**: `enrichRepos` owns the browser (launch once / close
once in `try/finally`); `getPage(url)` only navigates the page with
`page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' })`. `deps.getPage` (mock in
dryRun) replaces all navigation -> no browser. Extracts description, stars (k/M), language, topics,
defaultBranch, `lastUpdated` **from `<relative-time datetime>`**, readmeSnippet. Skip on 404/private;
`stars` undefined -> handled by the ranker.

### `ranker.js` (PURE)
`preRank(candidates, intent)` -> cheap sort on **fullName + title + snippet** (not only fullName).
`rankRepos(enriched, intent)` -> `RankedRepo[]` top-N with `scoreBreakdown`, truncated to
`config.TOP_N_REPOS`. Tolerates `stars`/`lastUpdated` undefined.

### `repoAnalyzer.js`
`analyzeRepo(repo, intent, deps = {})` -> `RepoAnalysis`. `deps.runClaude`, `deps.fetchIssues`
(default no-op; the pipeline injects `githubApiFallback.fetchOpenIssues` in real runs). Surfaces the
most discussed open issues as real user pain points to ground the "limitations/risks" and
"lessons for the user's idea" sections. Low-signal guard: metadata-only mode when the README is
missing/tiny; the system prompt forbids requesting tools/permissions. Anti-injection + English output.
On Analysis Engine error returns a "failed" analysis (does not propagate).

### `cascadeOrchestrator.js`
`runCascade(intent, repoAnalyses, deps = {})` -> `{ modules, analyses }`. **Phase 1 via
`runClaudeJSONWithRetry`** (module breakdown protected by retry, critical). Cascade specialists with
`repoAnalyses` injected, **parallelized** via `runPool(POOL_SIZE)`. Anti-injection + English.

### `synthesizer.js`
`synthesizeReport(intent, repoAnalyses, moduleAnalyses, deps = {})` -> markdown. English,
anti-injection, 7 sections.

### `reportWriter.js`
`createProjectDir()` (uses `utils.getTimestamp`) + `writeDocs(projectDir, payload)`.

### `pipeline.js`
`runPipeline(idea, options = {})` + `main` block (reads `--idea`/`--dry-run`). Glue §3. Integration of
the API fallback if `GITHUB_API_DISCOVERY_FALLBACK` is on and DDG < `TOP_N_REPOS`. In `dryRun` injects
DI mocks. try/catch per phase + partial save.

### `index.js` (rewrite)
Minimal entry: readline -> `runPipeline(idea)`.

---

## 5. Data models

```
IntentResult:   project_name, description, components[], technologies[], keywords[]

RepoCandidate:  fullName ("owner/repo"), url, title, snippet    <- title/snippet from the DDG SERP

RepoEnriched:   fullName, url, description, stars?, openIssues?, language,
                topics[], readmeSnippet, defaultBranch, lastUpdated?

RankedRepo:     RepoEnriched + score, scoreBreakdown { tier -> value }

RepoAnalysis:   repo, role, analysis (markdown)

ModuleSpec:     id, name, description, specialistRole, specialistSystemPrompt, analysisPrompt

ModuleAnalysis: module, role, analysis (markdown)
```

(`?` = optional for robustness.)

---

## 6. Output documents (final product)

In `projects/<TIMESTAMP>/`: `1_intent_decomposition.json`, `2_repo_candidates.json`,
`3_repo_analysis_<n>_<owner>_<repo>.md`, `4_module_breakdown.json`,
`5_module_analysis_<m>_<name>.md`, `final_report.md` (also copied to root). Optional Ralph-style
extensions: `reports/{audit_report, design_debate, code_review_debate}.md`, `TECHNICAL_DOC.md`.

---

## 7. Scraping: DuckDuckGo (discovery) and GitHub (enrichment)

**DuckDuckGo - fetch + cheerio (NO puppeteer)**
- Server-rendered endpoint `https://html.duckduckgo.com/html/`; fallback
  `https://lite.duckduckgo.com/lite/` (simpler markup). `USE_DDG_POST` (q as a form field, more stable
  than GET).
- **`uddg` redirect decode** (CRITICAL): the `href` of `.result__a` is almost always
  `//duckduckgo.com/l/?uddg=<encoded URL>`, not the final URL -> extract `uddg`, `decodeURIComponent`,
  then filter github.
- Budget: **N single-keyword queries** x `DORK_TEMPLATES` (capped at `MAX_KEYWORDS`); never AND-grouping
  (`site:github.com kw1 kw2 kw3` = implicit AND, too restrictive).
- Capture title + snippet for free from the SERP (signal for preRank and repoAnalyzer).
- Anti-block: **constant** `DEFAULT_USER_AGENT` (rotation on a single IP looks more bot-like),
  `REQUEST_DELAY_MS`, `MAX_RETRIES`+backoff, `FETCH_TIMEOUT_MS` via AbortController, empty/CAPTCHA
  detection.
- **ToS**: scraping DDG/GitHub for personal/experimental use is one thing; for distribution, the
  GitHub API fallback (task 16) reduces the risk.

**GitHub - puppeteer + cheerio (enrichment)**
- Browser justified (richer pages). Lifecycle: launch/close once in `enrichRepos`.
- `lastUpdated` **from the `datetime` attribute of `<relative-time>`** (never from the "3 days ago"
  text).
- stars from the counter (k/M); README first ~4000 chars (fallback `raw.githubusercontent.com`).
- Skip with a warning on 404/private; controlled degradation if parsing fails.

---

## 8. Validation strategy (Ralph Loop style, reinforced)

- **Per module**: `node --check <file>` + **import-smoke** via `scripts/check.mjs <file> <export...>`
  (verifies exports -> catches contract mismatches like `TOP_N_REPO`/`TOP_N_REPOS` at the right task).
  Note: the `repoEnricher` import-smoke loads puppeteer -> requires `npm install`.
- **Unit tests**: `node --test tests/ranker.test.js` (expected score/order + `TOP_N_REPOS`
  truncation) and `tests/duckSearch.test.js` on a **real SERP fixture**
  (`tests/fixtures/ddg_site_github.html`, captured with `curl`, NOT synthetic) -> verifies `uddg`
  decode and selectors on the real case.
- **Integration**: `node src/pipeline.js --idea 'demo ...' --dry-run` (end-to-end with DI mocks, zero
  real calls).
- **E2E**: `tests/smoke_pipeline.test.js` verifies the expected output files in a temporary folder.

**Capture the real fixture (one-time, by the implementer):**
```bash
mkdir -p tests/fixtures
curl -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' \
     -d 'q=site:github.com vector database' \
     'https://html.duckduckgo.com/html/' -o tests/fixtures/ddg_site_github.html
```

---

## 9. Dependencies (`package.json`)

```json
{
  "type": "module",
  "dependencies": {
    "chalk": "^5.3.0",
    "cheerio": "^1.0.0-rc.12",
    "ora": "^8.0.1",
    "puppeteer": "^22.6.0"
  }
}
```

**`dotenv` removed**: pure scraping, no API token (the optional GitHub API fallback reads
`GITHUB_TOKEN` from env directly, without dotenv).

---

## 10. Reuse notes and decisions

- **`claude.js`** existing: reused + `runClaudeJSON` + `runClaudeJSONWithRetry` + lazy probe.
- **Cascade loop** of the old `index.js`: migrated into `cascadeOrchestrator.js` + `synthesizer.js`,
  **injecting the repo analyses** as context.
- **`getTimestamp`/`cleanJsonString`** centralized in `src/utils.js` (breaks the cycle).
- **DI on all modules with I/O** -> clean `dryRun` and network-free tests (no ESM mocking).
- **Generalized JSON retry** in `runClaudeJSONWithRetry`, used by `extractIntent` and
  `cascadeOrchestrator` (protects the heart of the tool).
- **External reference**: `CodiceInEvoluzione/Ralph_Loop/Duck_Query` (DuckDuckGo, Python/Playwright) as
  a conceptual reference for selectors/anti-block, reimplemented in Node (fetch for DDG, puppeteer for
  GitHub).
- **Discovery fallback** (task 16, opt-in): GitHub Search API as a safety net when DDG is blocked -
  does not replace web discovery.

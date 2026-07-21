# 🔎 GitResearcher

A terminal tool (Node.js, ESM) that, given a **software idea**, breaks it down, **discovers relevant
GitHub repositories** via DuckDuckGo + dorks, ranks and analyzes them with **specialized specialized analysis agents
in a cascade**, and produces a **set of structured analysis documents** plus a final report.

It combines **research** (what already exists, the state of the art) and **design** (breakdown into
modules + specialists), with each informing the other.

> 📐 **Spec & plan**: [`PIANIFICAZIONE/`](./PIANIFICAZIONE/SPEC_GitResearcher.md) ·
> 🏗️ **Architecture (Mermaid diagrams)**: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) ·
> 📒 **Changelog**: [`CHANGELOG.md`](./CHANGELOG.md) ·
> 🗺️ **Roadmap**: [`ROADMAP.md`](./ROADMAP.md)

---

## 🚀 How it works

```
idea → [breakdown] → [DuckDuckGo+dorks] → [pre-rank] → [GitHub enrichment]
     → [per-keyword top-N ranking] → [per-repo analysis × 2 lenses] → [module+specialist cascade]
     → [inspiration: HN · npm · Stack Overflow · papers] → [adversarial review] → [synthesis] → documents
```

Each phase is isolated (non-fatal failure → saves partials and continues). `dryRun` injects DI mocks
across the whole chain → runs offline without Analysis Engine/network. Details and diagrams in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 🛠️ Prerequisites

- **Node.js 20+**
- **Execution CLI runner** authenticated (`npm install -g @anthropic-ai/claude-code`) - for the analysis/synthesis phases
- **Chromium** for puppeteer (if enrichment fails: `npx puppeteer browsers install chrome`)

---

## 📦 Installation

```bash
npm install      # runtime deps
npm install -D   # dev tools (eslint) - optional, required by CI/lint
```

---

## ▶️ Usage

```bash
npm start        # real: asks for an idea, uses Analysis Engine CLI + DuckDuckGo + puppeteer
npm run dry      # offline smoke (mocks, no Analysis Engine/network)
npm test         # test suite (95 tests, offline)
npm run coverage # coverage report
npm run lint     # eslint (requires devDependencies)
```

**Resume an interrupted run** (skips discovery/enrich/rank, restarts from the analyses):
```bash
node src/pipeline.js --idea "<idea>" --resume
```

Output goes to `projects/<TIMESTAMP>/` plus a copy of the final report in `architectural_report.md`
(real mode only).

---

## 📄 Output documents

`projects/<TIMESTAMP>/`: `1_intent_decomposition.json`, `2_repo_candidates.json` (with
`score`/`scoreBreakdown`), `3_repo_analysis_<n>_<owner>_<repo>_<role>.md` (one per analysis lens),
`4_module_breakdown.json`, `5_module_analysis_<m>_<name>.md`, `6_inspiration.json` (HN/npm/SO/papers),
`7_critical_review.md` (adversarial pre-check), `final_report.md`.

---

## 🗂️ Structure (package architecture)

```
src/
├── core/         config · utils(withRetry·runPool) · errors(ClaudeError…) · claude(CLI wrapper, injectable spawn)
├── discovery/    intentExtractor · serpParser(pure) · duckSearch · repoEnricher · ranker · githubApiFallback · hnSearch · npmSearch · soSearch · paperSearch
├── analysis/     repoAnalyzer(2 lenses) · cascadeOrchestrator · adversarialReview · synthesizer
├── io/           reportWriter · cache
├── testing/      mocks(dryRun)
└── pipeline.js   orchestrator (slim) + resume + main block
scripts/check.mjs import-smoke · tests/ (14 files) · .github/workflows/ci.yml
```

Dependencies point downward: `entry → pipeline → {core, discovery, analysis, io, testing}`. No cycles
(`core` does not import from other packages; no module imports from `index.js`).

---

## ⚙️ Configuration

Everything in [`src/core/config.js`](./src/core/config.js): `TOP_N_REPOS`, `MAX_CANDIDATES`, `MAX_KEYWORDS`,
`POOL_SIZE`, `GITHUB_API_DISCOVERY_FALLBACK` (opt-in), `INSPIRATION_TOP_K` (top-K per inspiration source) +
the HN/npm/StackOverflow/OpenAlex endpoints, `PER_KEYWORD` / `ENRICH_PER_KEYWORD` (per-keyword repo coverage).
**Optional features**: on-disk cache (`.cache/`, TTL), `--resume`, GitHub Search API fallback
(token via `GITHUB_TOKEN`), Stack Exchange quota raise (`SO_API_KEY`).

---

## 🧪 Quality

- **95 tests** offline (unit + smoke e2e in `dryRun`).
- **Coverage**: 96.2% statements · 93.2% functions · 80.7% branch (residual = real integration code:
  CLI spawn, puppeteer browser launch, real discovery).
- **CI** ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)): lint + test + coverage + smoke on Node 20/22.
- **ESLint** flat config + complexity threshold.
- To harden discovery against real DDG markup, capture the fixture once:
  ```bash
  mkdir -p tests/fixtures && curl -A 'Mozilla/5.0 ... Chrome/124.0 Safari/537.36' \
    -d 'q=site:github.com vector database' 'https://html.duckduckgo.com/html/' -o tests/fixtures/ddg_site_github.html
  ```

---

## ⚠️ Disclaimer

GitResearcher is intended for **personal and experimental** use. Repository discovery happens via
scraping **DuckDuckGo** (fetch + cheerio) and **enrichment on GitHub** (puppeteer + cheerio):
these practices touch the respective **Terms of Service**.

- Use the tool **at your own risk and responsibility**, respecting the ToS, rate limits and
  `robots.txt` of the services involved.
- For intensive or **production** use, prefer the **GitHub Search API fallback**
  (`GITHUB_API_DISCOVERY_FALLBACK` + `GITHUB_TOKEN`): it is the official, sanctioned path.
- The author **assumes no responsibility** for IP blocks, account restrictions or ToS violations
  arising from the use of the tool.

The software is provided **"as is"**, without any warranty (see [`LICENSE`](./LICENSE)).

## ⚖️ Notes

- Prompts include **anti-injection** framing (README/snippets = untrusted material) and **English** output.
- Released under the **MIT** license.

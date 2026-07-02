# Roadmap - GitResearcher

Where the tool is heading. The driving idea: **a software idea should be designed against multiple
independent axes of inspiration** - existing code, real user pain, composable packages, community
wisdom, and academic prior art - not just GitHub repositories.

> Pairs with [`CHANGELOG.md`](./CHANGELOG.md) (what shipped) and
> [`PIANIFICAZIONE/SPEC_GitResearcher.md`](./PIANIFICAZIONE/SPEC_GitResearcher.md) (current contract).

---

## 1. Vision

Today GitResearcher grounds a design on a single axis: GitHub (implementations) plus, since 3.1.0,
project-specific pain points (open issues). The goal of this roadmap is to broaden that into a
**multi-source inspiration fan-out**: given the idea's keywords, gather cheap, high-signal inputs
from several independent sources and synthesize them into one informed design report.

Each axis answers a different question:

| Axis | Source | Question it answers | Status |
|---|---|---|---|
| Code | GitHub repos | "What implementations already exist?" | ✅ shipped |
| Project pain | GitHub open issues | "What breaks / frustrates their users?" | ✅ 3.1.0 |
| Composable packages | npm registry | "What libraries can I build on?" | ✅ 3.2.0 |
| Community wisdom | Hacker News (Algolia) | "What do practitioners read & debate?" | ✅ 3.2.0 |
| Cross-project pain | Stack Overflow | "Where do people get stuck, broadly?" | ✅ 3.2.0 |
| Theory / prior art | OpenAlex | "What does the research say?" | ✅ 3.2.0 |
| ML models/datasets | Hugging Face | "What models/datasets already exist?" | 🧪 conditional |

---

## 2. Shipped

### 3.2.0 - Multi-source inspiration layer
See [`CHANGELOG.md`](./CHANGELOG.md). Highlights:
- Uniform `searchX(intent, deps) -> Result[]` source contract; four sources shipped: Hacker News
  (Algolia), npm registry, Stack Exchange, OpenAlex (papers).
- `pipeline.gatherInspiration`: parallel fan-out (`runPool`), top-K per source, fail-non-fatal
  (a blocked source degrades to `[]`, never blocks the pipeline).
- `synthesizer`: new `## Inspiration from other sources` prompt section + report section
  "What to Read, Reuse, and Avoid"; persisted as `6_inspiration.json`.

### 3.1.0 - Grounded analyses + robust discovery
Highlights:
- `openIssues` extracted during enrichment; the most discussed open issues are injected into the
  per-repo analysis as real user pain points.
- Low-signal guard + system prompt forbidding tool/permission requests (fixes degenerate analyses
  on repos with a missing README).
- `githubGet`: rate-limit-aware GitHub API helper (`X-RateLimit-Remaining` warning, `Retry-After`
  backoff); reused by the discovery fallback and `fetchOpenIssues`.
- `CLAUDE_EXTRA_ARGS` hook for forward-compatible determinism flags.

---

## 3. ✅ Done (3.2.0) - the multi-source inspiration layer

### 3.1 Uniform "source" contract
Every source is a small module in `src/discovery/` implementing the same shape, so they are
composable, individually testable, and mockable in dryRun:

```js
// contract every inspiration source implements
searchX(intent, deps = {}) -> Promise<Array<Result>>
// Result: { title, summary, url, source, meta? }
// deps.fetchImpl (default global fetch); rate-limit-aware; cache-friendly
```

The pipeline fans out across the enabled sources (`runPool`, top-K per source) and feeds a synthesis
block "context from N sources" into the synthesizer (and optionally the cascade specialists), without
restructuring the existing phases.

### 3.2 Sources, in priority order

1. **Hacker News - Algolia API** (top pick)
   - Endpoint: `https://hn.algolia.com/api/v1/search?query=...&tags=story`
   - Free, no key, generous limits. Probe confirmed high relevance.
   - Signal: curated primers, debates, war stories from practitioners.
   - Module: `src/discovery/hnSearch.js`.

2. **npm registry - search API**
   - Endpoint: `https://registry.npmjs.org/-/v1/search?text=...`
   - Free, no key. Probe confirmed.
   - Signal: the package ecosystem - what already exists to compose (don't reinvent) and its popularity.
   - Module: `src/discovery/npmSearch.js`.

3. **Stack Overflow - Stack Exchange API**
   - Endpoint: `https://api.stackexchange.com/2.3/search/advanced?q=...&site=stackoverflow`
   - Anonymous IP-quota; a free key raises it. Probe confirmed.
   - Signal: cross-project pain points - common errors, what people struggle with (complements
     GitHub issues, which are per-project).
   - Module: `src/discovery/soSearch.js`.

4. **Academic - OpenAlex (primary) / Semantic Scholar (alternative)**
   - OpenAlex: `https://api.openalex.org/works?search=...` + `mailto=` for the polite pool (no key).
   - Semantic Scholar: `https://api.semanticscholar.org/graph/v1/paper/search` (free key).
   - Signal: algorithms, prior art, documented trade-offs and open problems.
   - Module: `src/discovery/paperSearch.js`.
   - Note: **Google Scholar is explicitly out** - no official API and aggressive bot/CAPTCHA defenses
     make scraping impractical and ToS-incompatible.

### 3.3 Synthesis integration
- A new `gatherInspiration(intent, deps)` step returns `{ hn, npm, so, papers }` (top-K each).
- The synthesizer prompt gains a `## Inspiration from other sources` section (HN discussions,
  available packages, common SO pitfalls, relevant papers) so the final report recommends not only
  what to build, but what to read, reuse, and avoid.

---

## 4. Near-term

- **Domain-aware source selection**: tag the intent (ML / UI / CLI / data) and enable only the
  relevant sources (e.g. Hugging Face + Papers for ML; Dribbble for UI).
- **Richer repo signal**: fetch the dependency manifest (`package.json` / `go.mod` / `Cargo.toml`
  via `raw.githubusercontent.com`) and a light file-tree/language breakdown, to ground analyses
  further and reduce hallucination (deferred from 3.1.0 for leanness).
- **Progressive verification**: a light adversarial check on high-impact claims in the synthesis,
  reusing the existing `runClaudeJSONWithRetry` path (no heavyweight multi-agent panel).
- **Selective caching of analysis outputs**: optional, for reproducible re-runs.

---

## 5. Deferred / exploratory

- **Papers with Code** (papers + code + benchmarks/SOTA) - the search endpoint did not return JSON in
  a probe; needs a second look. Could subsume the standalone academic source.
- **Reddit, Product Hunt, Medium** - useful zeitgeist/competitor signals but API friction (Reddit
  OAuth/paid tier, Medium has no official API) or ToS concerns. Low priority.
- **True model-level determinism** (`temperature=0`) - the Claude Code CLI does not expose it; would
  require calling the Anthropic API directly instead of shelling out to the CLI.

---

## 6. Non-goals

- Scraping Google Scholar, or any source that requires CAPTCHA-solving / proxy rotation to function.
- Becoming a general web crawler. Sources are deliberately few, official-API, and high-signal.

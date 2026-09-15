// src/pipeline.js
// End-to-end orchestrator. Wires the core/discovery/analysis/io/testing packages.
// dryRun: mock DI + NOOP_CACHE on every caching stage (so a dry run cannot write into
// the cache a real run reads); resume restarts from saved intermediates; rootCopy only real.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as config from './core/config.js';
import { runPool } from './core/utils.js';
import { NOOP_CACHE } from './io/cache.js';
import { extractIntent } from './discovery/intentExtractor.js';
import { searchRepos } from './discovery/duckSearch.js';
import { preRank, rankRepos, takePerKeyword } from './discovery/ranker.js';
import { enrichRepos, fetchGithubPage } from './discovery/repoEnricher.js';
import { fetchOpenIssues } from './discovery/githubApiFallback.js';
import { searchHn } from './discovery/hnSearch.js';
import { searchNpm } from './discovery/npmSearch.js';
import { searchSo } from './discovery/soSearch.js';
import { searchPapers } from './discovery/paperSearch.js';
import { analyzeRepoWithCritique } from './analysis/repoAnalyzer.js';
import { runCascade } from './analysis/cascadeOrchestrator.js';
import { runAdversarialReview } from './analysis/adversarialReview.js';
import { synthesizeReport } from './analysis/synthesizer.js';
import { createProjectDir, writeDocs } from './io/reportWriter.js';
import { createDryRunMocks } from './testing/mocks.js';
import { createBudget, NOOP_BUDGET, rethrowIfBudget } from './core/budget.js';
import { guardFetch, ALLOWED_HOSTS } from './core/egress.js';
import { runClaude, runClaudeJSONWithRetry } from './core/claude.js';

let sentinelInstance = null;
async function getSentinel() {
  if (sentinelInstance) return sentinelInstance;
  try {
    const { SentinelGuard } = await import('../../sentinel/lib/sentinel.js');
    sentinelInstance = new SentinelGuard({
      // One list, in core/egress.js. It used to be written out here as well, and two
      // copies of an allowlist drift without anything noticing which one is authoritative.
      allowlist: [...ALLOWED_HOSTS],
      scanSecrets: true,
      scanPII: true
    });
  } catch (err) {
    // sentinel resolves from a sibling directory, so it is present in the installed
    // skills layout and absent in a plain clone and in CI. The empty catch that used
    // to live here replaced the egress allowlist with a no-op and said nothing: a
    // boundary nobody crosses looks exactly like a boundary nobody breaches.
    // Degrading is still allowed -- silently is not.
    sentinelInstance = {
      active: false,
      reason: err.code || err.message,
      activate: () => {},
      deactivate: () => {}
    };
    if (!process.env.GR_SILENCE_SENTINEL_WARNING) {
      console.warn(
        '⚠️  Egress guard NOT active: sentinel could not be loaded from ' +
        `../../sentinel/lib/sentinel.js (${sentinelInstance.reason}).\n` +
        '   Outbound requests are unfiltered and no secret/PII scan runs for this session.\n' +
        '   Install sentinel as a sibling directory, or set GR_SILENCE_SENTINEL_WARNING=1 to accept this.'
      );
    }
  }
  if (sentinelInstance.active === undefined) sentinelInstance.active = true;
  return sentinelInstance;
}

/**
 * Finds the latest project folder with valid intermediates and loads them for resume.
 * @returns {Promise<{resumeDir:string,intent:Object,candidates:Array,ranked:Array}|null>}
 */
export async function tryResume() {
  try {
    const projectsDir = config.PATH_PROJECTS || 'projects';
    if (!fs.existsSync(projectsDir)) return null;

    const dirs = fs.readdirSync(projectsDir)
      .filter(f => fs.statSync(path.join(projectsDir, f)).isDirectory())
      .sort((a, b) => b.localeCompare(a));
      
    if (dirs.length === 0) return null;

    const latestDir = dirs[0];
    const fullPath = path.join(projectsDir, latestDir);
    const intentPath = path.join(fullPath, '1_intent_decomposition.json');
    const candidatesPath = path.join(fullPath, '2_repo_candidates.json');

    if (fs.existsSync(intentPath) && fs.existsSync(candidatesPath)) {
      const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
      const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
      return {
        resumeDir: path.resolve(fullPath),
        intent,
        candidates: candidatesData.candidates || [],
        ranked: candidatesData.topN || []
      };
    }
  } catch {
    /* noop */
  }
  return null;
}

/**
 * Builds standard parameter overrides based on mode.
 * @param {boolean} dry
 * @param {Object} [mocks]
 * @returns {Object}
 */
export function buildPhaseDeps(dry, mocks, budget = NOOP_BUDGET) {
  if (dry && mocks) {
    return {
      // Only the keys a module reads (intentExtractor.js:23). runClaudeJSON was injected
      // here too and read by nobody.
      intent: { runClaudeJSONWithRetry: async () => mocks.mockIntent() },
      // NOOP_CACHE on every stage that caches. This is not tidiness: the cache key is
      // makeKey('repo', fullName), with no mode in it, so a dry run used to write the
      // fabricated pages from testing/mocks.js into the same .cache the real run reads.
      // For CACHE_TTL_HOURS afterwards a real run got mock stars back, with no network
      // call and _failed:false -- indistinguishable from a page scraped off github.com.
      discovery: { cache: NOOP_CACHE },
      enrich: { getPage: mocks.mockGetPage, cache: NOOP_CACHE },
      // fetchIssues is explicit even in dry mode: its absence is what made the real
      // runs quietly evidence-free, so the shape is stated in both branches now.
      claudeMd: { runClaude: async (prompt) => mocks.mockClaudeMd(prompt), fetchIssues: async () => [] },
      // cascadeOrchestrator.js:16-17 reads runClaude (specialists) and runClaudeJSONWithRetry
      // (breakdown). The mock supplied runClaudeJSON, which nothing reads, and left runClaude
      // out -- so the specialists of every dry run called the real claude CLI.
      cascade: {
        runClaude: async (prompt) => mocks.mockClaudeMd(prompt),
        runClaudeJSONWithRetry: async () => mocks.mockModules()
      },
      inspiration: {
        fetchImpl: mocks.mockFetch,
        hn: mocks.mockHn,
        npm: mocks.mockNpm,
        so: mocks.mockSo,
        papers: mocks.mockPapers,
        cache: NOOP_CACHE
      }
    };
  }
  // A model call and an HTTP request are counted at the only place both are certain to
  // pass through: the dependency the module was already asking for.
  const countedRun = (...args) => { budget.countLlm(); return runClaude(...args); };
  const countedJSON = (...args) => { budget.countLlm(); return runClaudeJSONWithRetry(...args); };

  return {
    // Counted and filtered: two separate concerns -- how much a run may spend, and where
    // it may spend it. The egress guard is here rather than only in sentinel because
    // sentinel resolves from a sibling directory that does not exist in a clone or in CI,
    // which left every request on those machines unfiltered.
    intent: { runClaudeJSONWithRetry: countedJSON },
    discovery: { fetchImpl: budget.wrapFetch(guardFetch()) },
    enrich: { getPage: async (url) => { budget.countHttp(); return fetchGithubPage(url); } },
    // githubApiFallback exists "to ground analyses with real user pain points", and
    // fetchOpenIssues was imported here and never handed to anyone. repoAnalyzer
    // defaults fetchIssues to `async () => []`, so every real run rendered
    // "(no recent open issues available)" while the prompt told the model to use the
    // open issues as evidence for the Limitations section. Asking for evidence that
    // was never supplied is how a confident invention gets produced.
    // Every key below is one a module actually reads -- checked, not assumed. The same
    // mistake as fetchOpenIssues above would be worse here: a ceiling nobody consults
    // looks exactly like a ceiling nobody reached.
    //   intentExtractor.js:23  -> deps.runClaudeJSONWithRetry
    //   repoAnalyzer/cascade/adversarialReview/synthesizer -> deps.runClaude
    //   cascadeOrchestrator.js:17 -> deps.runClaudeJSONWithRetry
    //   duckSearch:120, hn/npm/so/paperSearch -> deps.fetchImpl
    //   repoEnricher.js:142 -> deps.getPage (NOT fetchImpl)
    claudeMd: { fetchIssues: fetchOpenIssues, runClaude: countedRun },
    cascade: { runClaude: countedRun, runClaudeJSONWithRetry: countedJSON },
    inspiration: { fetchImpl: budget.wrapFetch(guardFetch()) }
  };
}

/**
 * Executes Phase 2 (discovery) and Phase 3 (ranker).
 *
 * Exported for the regression that covers the real branch. The dry branch below is
 * reachable from the smoke test; the real one was reachable from nothing, which is how
 * it kept passing a string where searchRepos reads `.keywords`.
 */
export async function discoverAndRank(intent, dry, deps, onProgress) {
  let candidates = [];
  if (dry) {
    onProgress('Running parallel multi-source discovery (mock)...');
    try {
      const html = await deps.inspiration.fetchImpl();
      const text = await html.text();
      const { parseSerp } = await import('./discovery/serpParser.js');
      candidates = parseSerp(text, 'vector search engine');
      candidates.forEach(c => c.matchedKeywords = intent.keywords || []);
    } catch (err) {
      console.warn(`⚠️ Mock discovery failed: ${err.message}`);
    }
  } else {
    onProgress('Running parallel multi-source discovery...');
    const searchTasks = (intent.keywords || []).map(kw => {
      // searchRepos/buildQueries read `.keywords` and `.technologies`. Handing them the
      // bare string produced zero queries and an empty array, which the caller below
      // read as "no candidates found" and routed into the API fallback -- so no real run
      // ever sent a DuckDuckGo request. Covered by tests/regressions.test.js (13).
      return searchRepos({ keywords: [kw], technologies: intent.technologies || [] }, deps.discovery)
        .catch(err => {
          // The ceiling must not be readable as "this keyword found nothing".
          rethrowIfBudget(err);
          console.warn(`⚠️ Discovery failed for '${kw}': ${err.message}`);
          return [];
        });
    });
    const searchResults = await Promise.all(searchTasks);
    candidates = searchResults.flat();
  }

  if (!candidates.length && !dry) {
    if (config.GITHUB_API_DISCOVERY_FALLBACK) {
      onProgress('No candidates found. Trying GitHub Search API fallback...');
      try {
        const { fallbackDiscover } = await import('./discovery/githubApiFallback.js');
        candidates = await fallbackDiscover(intent);
      } catch (err) {
        console.warn(`⚠️ GitHub Search API fallback failed: ${err.message}`);
      }
    } else {
      // The flag was exported and never read, so the fallback ran unconditionally: with
      // the discovery above sending no query, every real run silently became an API run
      // capped at 3 keywords and sorted by stars -- the opposite of the per-keyword
      // coverage this pipeline claims to provide. Saying why it did NOT run is what keeps
      // "found nothing" and "did not look" apart.
      onProgress('No candidates found. GitHub API fallback is off (GITHUB_API_DISCOVERY_FALLBACK=true enables it).');
    }
  }

  onProgress(`Discovered ${candidates.length} unique candidates. Pre-ranking...`);
  // MAX_CANDIDATES was exported and never read: the enrichment pool had no cap at all.
  const preRanked = preRank(candidates, intent).slice(0, config.MAX_CANDIDATES);
  // was config.PER_KEYWORD_LIMIT, which config.js does not export: the `|| 3` fallback
  // always won, and ENRICH_PER_KEYWORD -- the documented knob -- was dead.
  const toEnrich = takePerKeyword(preRanked, intent.keywords || [], config.ENRICH_PER_KEYWORD);

  onProgress(`Enriching top ${toEnrich.length} repositories...`);
  const enriched = await enrichRepos(toEnrich, deps.enrich);
  const ranked = rankRepos(enriched, intent);
  onProgress(`Top-${ranked.length} repos selected (per-keyword coverage).`);
  return { candidates, ranked };
}

/**
 * Multi-source inspiration fan-out.
 */
export async function gatherInspiration(intent, deps = {}) {
  const tasks = [
    // A blocked source degrades to []; a refused budget does not. The two look identical
    // downstream -- an empty list -- which is exactly why the ceiling has to pass through.
    (deps.hn ? deps.hn(intent) : searchHn(intent, deps)).catch(err => { rethrowIfBudget(err); console.warn(`⚠️ HN failed: ${err.message}`); return []; }),
    (deps.npm ? deps.npm(intent) : searchNpm(intent, deps)).catch(err => { rethrowIfBudget(err); console.warn(`⚠️ npm failed: ${err.message}`); return []; }),
    (deps.so ? deps.so(intent) : searchSo(intent, deps)).catch(err => { rethrowIfBudget(err); console.warn(`⚠️ StackOverflow failed: ${err.message}`); return []; }),
    (deps.papers ? deps.papers(intent) : searchPapers(intent, deps)).catch(err => { rethrowIfBudget(err); console.warn(`⚠️ OpenAlex failed: ${err.message}`); return []; })
  ];
  const results = await Promise.all(tasks);
  return {
    hn: results[0],
    npm: results[1],
    so: results[2],
    papers: results[3]
  };
}

/**
 * Runs the full pipeline.
 * @param {string} idea
 * @param {{dryRun?:boolean, resume?:boolean, onProgress?:(m:string)=>void}} [options]
 * @returns {Promise<Object>}
 */
export async function runPipeline(idea, options = {}) {
  const sentinel = await getSentinel();
  sentinel.activate();
  try {
    const dry = !!options.dryRun;
    const onProgress = options.onProgress || (() => {});
    const mocks = dry ? createDryRunMocks(idea) : null;
    // One budget per run, not per process: two runs in the same process must not inherit
    // each other's spend. A dry run counts nothing -- it calls nothing.
    const budget = dry
      ? NOOP_BUDGET
      : createBudget({ maxLlmCalls: config.MAX_LLM_CALLS, maxHttpRequests: config.MAX_HTTP_REQUESTS });
    const deps = buildPhaseDeps(dry, mocks, budget);

    // --- Resume: restarts from saved intermediates (skips discovery/enrich/rank) ---
    const resumed = !dry && options.resume ? await tryResume() : null;
    let intent;
    let candidates;
    let ranked;
    if (resumed) {
      ({ intent, candidates, ranked } = resumed);
      onProgress(`Resuming from ${resumed.resumeDir}: skipping discovery/enrich/rank (${ranked.length} repos)`);
    } else {
      // --- Phase 1: intent ---
      onProgress('Breaking down the idea...');
      intent = await extractIntent(idea, deps.intent);
      // --- Phases 2-3: discovery + rank (per-keyword coverage) ---
      ({ candidates, ranked } = await discoverAndRank(intent, dry, deps, onProgress));
    }

    // --- Phase 4: per-repo analysis, two lenses each (Archaeologist + Auditor) ---
    onProgress('Per-repo analysis (Archaeologist + Auditor)...');
    const repoAnalyses = (await runPool(
      ranked,
      (repo) => analyzeRepoWithCritique(repo, intent, deps.claudeMd),
      config.POOL_SIZE
    )).flat();

    // --- Phase 5: cascade (modules + specialists, informed by repos) ---
    onProgress('Cascade: module breakdown + specialists...');
    const { modules, analyses: moduleAnalyses } = await runCascade(intent, repoAnalyses, deps.cascade);

    // --- Phase 5.5: inspiration (multi-source fan-out: HN, npm, SO, papers) ---
    onProgress('Gathering inspiration (HN, npm, Stack Overflow, papers)...');
    const inspiration = await gatherInspiration(intent, deps.inspiration);

    // --- Phase 5.6: adversarial review (challenge high-impact claims before synthesis) ---
    onProgress("Adversarial review (devil's advocate)...");
    const criticalReview = await runAdversarialReview(intent, repoAnalyses, moduleAnalyses, deps.claudeMd);

    // --- Phase 6: synthesis ---
    onProgress('Synthesizing the final report...');
    const finalReport = await synthesizeReport(intent, repoAnalyses, moduleAnalyses, deps.claudeMd, inspiration, criticalReview);

    // --- Phase 7: write documents (rootCopy only in real mode) ---
    onProgress('Writing documents...');
    const dir = createProjectDir();
    writeDocs(dir, { intent, candidates, ranked, repoAnalyses, modules, moduleAnalyses, inspiration, criticalReview, finalReport, rootCopy: !dry });

    // What the run actually spent, reported whether or not a ceiling was approached. The
    // other half of why the budget exists: a run that cannot say what it spent cannot be
    // told apart from a run that did nothing.
    const spend = budget.report();
    onProgress(`Done. Output in ${dir} — ${spend.llmCalls} model calls, ${spend.httpRequests} HTTP requests`);
    return { dir, intent, ranked, repoAnalyses, modules, moduleAnalyses, inspiration, criticalReview, finalReport, spend };
  } finally {
    sentinel.deactivate();
  }
}

// --- main block: argv parsing (--idea/--dry-run/--resume) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const ideaIdx = args.indexOf('--idea');
  if (ideaIdx === -1) {
    console.error('Usage: node src/pipeline.js --idea "<software idea>" [--dry-run] [--resume]');
    process.exit(1);
  }
  const idea = args[ideaIdx + 1];
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');

  console.log(`▶ runPipeline (dryRun=${dryRun}, resume=${resume}) idea="${idea}"`);
  runPipeline(idea, { dryRun, resume, onProgress: (m) => console.log(`  …${m}`) })
    .catch(err => {
      console.error(`\n✖ Pipeline error: ${err.stack || err.message}`);
      process.exit(1);
    });
}

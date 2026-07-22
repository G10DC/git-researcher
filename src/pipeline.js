// src/pipeline.js
// End-to-end orchestrator. Wires the core/discovery/analysis/io/testing packages.
// dryRun: mock DI + NOOP_CACHE; resume restarts from saved intermediates; rootCopy only in real runs.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as config from './core/config.js';
import { runPool } from './core/utils.js';
import { NOOP_CACHE } from './io/cache.js';
import { extractIntent } from './discovery/intentExtractor.js';
import { searchRepos } from './discovery/duckSearch.js';
import { preRank, rankRepos, takePerKeyword } from './discovery/ranker.js';
import { enrichRepos } from './discovery/repoEnricher.js';
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

let sentinelInstance = null;
async function getSentinel() {
  if (sentinelInstance) return sentinelInstance;
  try {
    const { SentinelGuard } = await import('../../sentinel/lib/sentinel.js');
    sentinelInstance = new SentinelGuard({
      allowlist: [
        'html.duckduckgo.com',
        'lite.duckduckgo.com',
        'duckduckgo.com',
        'github.com',
        'api.github.com',
        'news.ycombinator.com',
        'hn.algolia.com',
        'registry.npmjs.org',
        'api.stackexchange.com',
        'api.openalex.org',
        'generativelanguage.googleapis.com',
        'openrouter.ai'
      ],
      scanSecrets: true,
      scanPII: true
    });
  } catch {
    sentinelInstance = { activate: () => {}, deactivate: () => {} };
  }
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
function buildPhaseDeps(dry, mocks) {
  if (dry && mocks) {
    return {
      intent: { 
        runClaudeJSON: async () => mocks.mockIntent(),
        runClaudeJSONWithRetry: async () => mocks.mockIntent()
      },
      enrich: { getPage: mocks.mockGetPage },
      claudeMd: { runClaude: async (prompt) => mocks.mockClaudeMd(prompt) },
      cascade: { 
        runClaudeJSON: async () => mocks.mockModules(),
        runClaudeJSONWithRetry: async () => mocks.mockModules()
      },
      inspiration: { 
        fetchImpl: mocks.mockFetch,
        hn: mocks.mockHn,
        npm: mocks.mockNpm,
        so: mocks.mockSo,
        papers: mocks.mockPapers
      }
    };
  }
  return {
    intent: {},
    enrich: {},
    claudeMd: {},
    cascade: {},
    inspiration: {}
  };
}

/**
 * Executes Phase 2 (discovery) and Phase 3 (ranker).
 */
async function discoverAndRank(intent, dry, deps, onProgress) {
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
      return searchRepos(kw, deps.discovery)
        .catch(err => {
          console.warn(`⚠️ Discovery failed for '${kw}': ${err.message}`);
          return [];
        });
    });
    const searchResults = await Promise.all(searchTasks);
    candidates = searchResults.flat();
  }

  if (!candidates.length && !dry) {
    onProgress('No candidates found. Trying GitHub Search API fallback...');
    try {
      const { fallbackDiscover } = await import('./discovery/githubApiFallback.js');
      candidates = await fallbackDiscover(intent);
    } catch (err) {
      console.warn(`⚠️ GitHub Search API fallback failed: ${err.message}`);
    }
  }

  onProgress(`Discovered ${candidates.length} unique candidates. Pre-ranking...`);
  const preRanked = preRank(candidates, intent);
  const toEnrich = takePerKeyword(preRanked, intent.keywords || [], config.PER_KEYWORD_LIMIT || 3);

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
    (deps.hn ? deps.hn(intent) : searchHn(intent, deps)).catch(err => { console.warn(`⚠️ HN failed: ${err.message}`); return []; }),
    (deps.npm ? deps.npm(intent) : searchNpm(intent, deps)).catch(err => { console.warn(`⚠️ npm failed: ${err.message}`); return []; }),
    (deps.so ? deps.so(intent) : searchSo(intent, deps)).catch(err => { console.warn(`⚠️ StackOverflow failed: ${err.message}`); return []; }),
    (deps.papers ? deps.papers(intent) : searchPapers(intent, deps)).catch(err => { console.warn(`⚠️ OpenAlex failed: ${err.message}`); return []; })
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
    const deps = buildPhaseDeps(dry, mocks);

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

    onProgress(`Done. Output in ${dir}`);
    return { dir, intent, ranked, repoAnalyses, modules, moduleAnalyses, inspiration, criticalReview, finalReport };
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

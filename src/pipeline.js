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
import { preRank, rankRepos } from './discovery/ranker.js';
import { enrichRepos } from './discovery/repoEnricher.js';
import { analyzeRepo } from './analysis/repoAnalyzer.js';
import { runCascade } from './analysis/cascadeOrchestrator.js';
import { synthesizeReport } from './analysis/synthesizer.js';
import { createProjectDir, writeDocs } from './io/reportWriter.js';
import { createDryRunMocks } from './testing/mocks.js';

/**
 * Finds the latest project folder with valid intermediates and loads them for resume.
 * @returns {Promise<{resumeDir:string,intent:Object,candidates:Array,ranked:Array}|null>}
 */
export async function tryResume() {
  try {
    const root = path.join(process.cwd(), config.PATH_PROJECTS);
    if (!fs.existsSync(root)) return null;
    const dirs = fs.readdirSync(root).filter((d) => /^\d{8}_\d{6}$/.test(d)).sort();
    const last = dirs[dirs.length - 1];
    if (!last) return null;
    const dir = path.join(root, last);
    const candFile = path.join(dir, '2_repo_candidates.json');
    const intentFile = path.join(dir, '1_intent_decomposition.json');
    if (!fs.existsSync(candFile) || !fs.existsSync(intentFile)) return null;
    const candidatesDoc = JSON.parse(fs.readFileSync(candFile, 'utf-8'));
    const intent = JSON.parse(fs.readFileSync(intentFile, 'utf-8'));
    const ranked = candidatesDoc.topN || [];
    if (!Array.isArray(ranked) || ranked.length === 0) return null;
    return { resumeDir: dir, intent, candidates: candidatesDoc.candidates || [], ranked };
  } catch {
    return null;
  }
}

/**
 * Builds the injected dependencies for each phase (mocks in dryRun, real otherwise).
 * Centralizes the `dry ? {...} : {}` ternaries to reduce runPipeline's complexity.
 * @param {boolean} dry
 * @param {Object|null} mocks
 * @returns {{intent:Object,search:Object,enrich:Object,claudeMd:Object,cascade:Object}}
 */
function buildPhaseDeps(dry, mocks) {
  if (!dry) return { intent: {}, search: {}, enrich: {}, claudeMd: {}, cascade: {} };
  return {
    intent: { runClaudeJSONWithRetry: mocks.mockIntent },
    search: { fetchImpl: mocks.mockFetch, cache: NOOP_CACHE },
    enrich: { getPage: mocks.mockGetPage, cache: NOOP_CACHE },
    claudeMd: { runClaude: mocks.mockClaudeMd },
    cascade: { runClaude: mocks.mockClaudeMd, runClaudeJSONWithRetry: mocks.mockModules },
  };
}

/**
 * Applies the GitHub Search API fallback if DDG did not cover TOP_N_REPOS (real runs only).
 * @param {Object} intent
 * @param {Array} candidates
 * @param {boolean} dry
 * @param {(m:string)=>void} onProgress
 */
async function applyApiFallback(intent, candidates, dry, onProgress) {
  if (dry || !config.GITHUB_API_DISCOVERY_FALLBACK || candidates.length >= config.TOP_N_REPOS) return;
  try {
    const { fallbackDiscover } = await import('./discovery/githubApiFallback.js');
    const extra = await fallbackDiscover(intent);
    const seen = new Set(candidates.map((c) => c.fullName));
    for (const c of extra) {
      if (!seen.has(c.fullName)) { candidates.push(c); seen.add(c.fullName); }
    }
    onProgress(`GitHub API fallback: +${extra.length} candidates`);
  } catch (e) {
    console.warn(`⚠️ GitHub API fallback unavailable: ${e.message}`);
  }
}

/**
 * Phases 2-3: discovery (DDG + optional API fallback) -> preRank -> enrich -> rank.
 * @param {Object} intent
 * @param {boolean} dry
 * @param {Object} deps
 * @param {(m:string)=>void} onProgress
 * @returns {Promise<{candidates:Array,ranked:Array}>}
 */
async function discoverAndRank(intent, dry, deps, onProgress) {
  onProgress('Searching repositories via DuckDuckGo...');
  const candidates = await searchRepos(intent, deps.search);
  await applyApiFallback(intent, candidates, dry, onProgress);

  onProgress(`Pre-ranking ${candidates.length} candidates...`);
  const toEnrich = preRank(candidates, intent).slice(0, config.MAX_CANDIDATES);
  onProgress(`Enriching ${toEnrich.length} candidates...`);
  const enriched = await enrichRepos(toEnrich, deps.enrich);
  const ranked = rankRepos(enriched, intent);
  onProgress(`Top-${ranked.length} repos selected.`);
  return { candidates, ranked };
}

/**
 * Runs the full pipeline.
 * @param {string} idea
 * @param {{dryRun?:boolean, resume?:boolean, onProgress?:(m:string)=>void}} [options]
 * @returns {Promise<Object>}
 */
export async function runPipeline(idea, options = {}) {
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
    // --- Phases 2-3: discovery + rank ---
    ({ candidates, ranked } = await discoverAndRank(intent, dry, deps, onProgress));
  }

  // --- Phase 4: per-repo analysis (pool) ---
  onProgress('Per-repo analysis (specialist agents)...');
  const repoAnalyses = await runPool(
    ranked,
    (repo) => analyzeRepo(repo, intent, deps.claudeMd),
    config.POOL_SIZE
  );

  // --- Phase 5: cascade ---
  onProgress('Cascade: module breakdown + specialists...');
  const { modules, analyses: moduleAnalyses } = await runCascade(intent, repoAnalyses, deps.cascade);

  // --- Phase 6: synthesis ---
  onProgress('Synthesizing the final report...');
  const finalReport = await synthesizeReport(intent, repoAnalyses, moduleAnalyses, deps.claudeMd);

  // --- Phase 7: write documents (rootCopy only in real mode) ---
  onProgress('Writing documents...');
  const dir = createProjectDir();
  writeDocs(dir, { intent, candidates, ranked, repoAnalyses, modules, moduleAnalyses, finalReport, rootCopy: !dry });

  onProgress(`Done. Output in ${dir}`);
  return { dir, intent, ranked, repoAnalyses, modules, moduleAnalyses, finalReport };
}

// --- main block: argv parsing (--idea/--dry-run/--resume) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const ideaIdx = args.indexOf('--idea');
  const idea = ideaIdx >= 0 && args[ideaIdx + 1] ? args[ideaIdx + 1] : '';
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');
  const finalIdea = idea || 'rust vector database demo';
  console.log(`▶ runPipeline (dryRun=${dryRun}, resume=${resume}) idea="${finalIdea}"`);
  runPipeline(finalIdea, { dryRun, resume, onProgress: (m) => console.log('  …' + m) })
    .then((r) => console.log(`✔ done -> ${r.dir}`))
    .catch((e) => {
      console.error('✖ Pipeline error:', e);
      process.exit(1);
    });
}

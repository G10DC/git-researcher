// src/io/reportWriter.js
// Writes structured output documents into projects/<TIMESTAMP>/ using atomic file operations.

import fs from 'node:fs';
import path from 'node:path';
import { getTimestamp } from '../core/utils.js';
import { PATH_PROJECTS } from '../core/config.js';

/** Sanitizes a string for use in a filename (lowercase, alphanumeric/_ only). */
function sanitize(s) {
  return (
    String(s || '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'x'
  );
}

/**
 * Creates the timestamped project folder.
 * @param {string} [base] base cwd
 * @returns {string} absolute path of the project folder
 */
export function createProjectDir(base = process.cwd()) {
  const dir = path.join(base, PATH_PROJECTS, getTimestamp());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Atomic write helper: writes to temporary file first, then renames.
 */
function write(dir, name, content) {
  const isJson = name.endsWith('.json');
  const targetPath = path.join(dir, name);
  const tmpPath = targetPath + '.tmp';
  const data = isJson ? JSON.stringify(content, null, 2) : String(content);

  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Writes one numbered .md per analysis.
 */
function writeAnalyses(dir, analyses, filePrefix, makeName, makeHeading) {
  (analyses || []).forEach((a, i) => {
    write(dir, `${filePrefix}_${i + 1}_${makeName(a)}.md`, makeHeading(a));
  });
}

/**
 * Writes all output documents atomically.
 */
export function writeDocs(projectDir, payload) {
  const {
    intent, candidates, ranked, repoAnalyses,
    modules, moduleAnalyses, inspiration = {}, criticalReview = '', finalReport, rootCopy = true,
  } = payload;

  if (intent) write(projectDir, '1_intent_decomposition.json', intent);

  write(projectDir, '2_repo_candidates.json', {
    candidatesCount: (candidates || []).length,
    candidates: candidates || [],
    topN: ranked || [],
  });

  writeAnalyses(
    projectDir,
    repoAnalyses,
    '3_repo_analysis',
    (r) => {
      const [owner, ...rest] = String(r.repo).split('/');
      return `${sanitize(owner)}_${sanitize(rest.join('_') || 'repo')}_${sanitize(r.role || 'analysis')}`;
    },
    (r) => `# Analysis: ${r.repo} (${r.role || 'analysis'})\n\n${r.analysis}`
  );

  write(projectDir, '4_module_breakdown.json', modules || []);

  writeAnalyses(
    projectDir,
    moduleAnalyses,
    '5_module_analysis',
    (m) => sanitize(m.module),
    (m) => `# Module: ${m.module}\n**Agent role:** ${m.role}\n\n${m.analysis}`
  );

  write(projectDir, '6_inspiration.json', inspiration);
  write(projectDir, '7_critical_review.md', criticalReview);

  write(projectDir, 'final_report.md', finalReport || '');
  if (rootCopy) {
    const rootPath = path.join(process.cwd(), 'architectural_report.md');
    const rootTmp = rootPath + '.tmp';
    fs.writeFileSync(rootTmp, String(finalReport || ''), 'utf-8');
    fs.renameSync(rootTmp, rootPath);
  }

  return projectDir;
}

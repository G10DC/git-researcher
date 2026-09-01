// src/io/htmlReportWriter.js
// Writes the HTML dashboard for a git-researcher run, beside the markdown documents.
//
// This module used to be imported by nobody while docs/PLANNING.md drew it as a
// pipeline stage, and it carried an unresolved merge conflict inside a template
// literal -- valid JavaScript, so neither node nor eslint objected, and the markers
// plus a duplicated <td> would have been rendered into the page. It is now wired into
// writeDocs and covered by tests.

import fs from 'node:fs';
import path from 'node:path';

/** Escapes text for HTML, quotes included: these values land inside attributes too. */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a repository URL as an href, or nothing when it is not http(s).
 * A scraped SERP is attacker-influenceable input; `javascript:` must not survive.
 */
function safeHref(url) {
  const s = String(url || '');
  return /^https?:\/\//i.test(s) ? escapeHtml(s) : '';
}

/**
 * Writes projectDir/dashboard.html.
 * @param {string} projectDir
 * @param {Object} intent
 * @param {Array} repos
 * @param {string} [summaryMarkdown] the final report, shown verbatim as text
 * @returns {string} the path written
 */
export function writeHtmlReport(projectDir, intent = {}, repos = [], summaryMarkdown = '') {
  const htmlPath = path.join(projectDir, 'dashboard.html');
  const list = Array.isArray(repos) ? repos : [];

  const repoRows = list.length
    ? list
        .map((r) => {
          const href = safeHref(r.url);
          const link = href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">View repo</a>` : '—';
          return `
    <tr>
      <td><strong>${escapeHtml(r.fullName || r.name || r.repo)}</strong></td>
      <td>${escapeHtml(r.stars ?? '—')}</td>
      <td>${escapeHtml(r.language || '—')}</td>
      <td>${link}</td>
    </tr>`;
        })
        .join('')
    : '\n    <tr><td colspan="4">No repository was discovered for this run.</td></tr>';

  const title = escapeHtml(intent.project_name || intent.idea || intent.description || 'Analysis');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitResearcher — ${title}</title>
  <style>
    body { background:#0f172a; color:#f8fafc; font-family:system-ui,sans-serif; padding:2rem; line-height:1.6; }
    h1 { color:#38bdf8; margin:0 0 .5rem; }
    .card { background:rgba(30,41,59,.7); padding:1.5rem; border-radius:12px; border:1px solid rgba(255,255,255,.1); margin-bottom:1.5rem; }
    table { width:100%; border-collapse:collapse; margin-top:1rem; }
    th, td { padding:.75rem; text-align:left; border-bottom:1px solid rgba(255,255,255,.1); }
    th { color:#38bdf8; }
    a { color:#818cf8; }
    pre { white-space:pre-wrap; word-wrap:break-word; margin:0; font-size:.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>GitResearcher report</h1>
    <p>Target idea: <strong>${title}</strong></p>
  </div>
  <div class="card">
    <h2>Discovered repositories (${list.length})</h2>
    <table>
      <thead>
        <tr><th>Repository</th><th>Stars</th><th>Language</th><th>Link</th></tr>
      </thead>
      <tbody>${repoRows}
      </tbody>
    </table>
  </div>
  <div class="card">
    <h2>Final report</h2>
    <pre>${escapeHtml(summaryMarkdown) || '(no report produced)'}</pre>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  return htmlPath;
}

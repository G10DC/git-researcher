// src/io/htmlReportWriter.js
// Writes interactive HTML report dashboard for git-researcher analysis.

import fs from 'node:fs';
import path from 'node:path';

export function writeHtmlReport(projectDir, intent, repos, summaryMarkdown) {
  const htmlPath = path.join(projectDir, 'dashboard.html');
  
  const repoRows = repos.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.name || r.repo)}</strong></td>
      <td>⭐ ${r.stars || 0}</td>
<<<<<<< HEAD
      <td>${escapeHtml(r.license || 'N/A')}</td>
=======
      <td>${escapeHtml(r.license || 'N/D')}</td>
>>>>>>> 7874077 (feat(spark): integrate spark breakthrough enhancements into git-researcher)
      <td><a href="${escapeHtml(r.url)}" target="_blank">View Repo</a></td>
    </tr>
  `).join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GitResearcher Dashboard - ${escapeHtml(intent.idea || 'Analysis')}</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; padding: 2rem; }
    h1 { color: #38bdf8; }
    .card { background: rgba(30, 41, 59, 0.7); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { color: #38bdf8; }
    a { color: #818cf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔍 GitResearcher Intelligence Report</h1>
    <p>Target Idea: <strong>${escapeHtml(intent.idea || 'Analysis')}</strong></p>
  </div>
  <div class="card">
    <h2>📊 Discovered Repositories</h2>
    <table>
      <thead>
        <tr><th>Repository</th><th>Stars</th><th>License</th><th>Link</th></tr>
      </thead>
      <tbody>
        ${repoRows}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  return htmlPath;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

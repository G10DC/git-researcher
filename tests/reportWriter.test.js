// tests/reportWriter.test.js
// writeDocs (with rootCopy true/false) and createProjectDir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProjectDir, writeDocs } from '../src/io/reportWriter.js';

test('writeDocs writes all documents (rootCopy=false does not write to cwd)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-'));
  const dir = createProjectDir(tmp);
  writeDocs(dir, {
    intent: { project_name: 'X' },
    candidates: [{ fullName: 'a/b' }],
    ranked: [{ fullName: 'a/b', url: 'u', score: 1 }],
    repoAnalyses: [{ repo: 'a/b', role: 'R', analysis: 'txt' }],
    modules: [{ id: 1, name: 'M' }],
    moduleAnalyses: [{ module: 'M', role: 'R', analysis: 'txt' }],
    inspiration: { hn: [{ title: 't', url: 'u', summary: 's', source: 'hn' }] },
    finalReport: '# Report',
    rootCopy: false,
  });
  assert.ok(fs.existsSync(path.join(dir, '1_intent_decomposition.json')));
  assert.ok(fs.existsSync(path.join(dir, '2_repo_candidates.json')));
  assert.ok(fs.existsSync(path.join(dir, '6_inspiration.json')));
  assert.ok(fs.existsSync(path.join(dir, 'final_report.md')));
  assert.ok(fs.existsSync(path.join(dir, '3_repo_analysis_1_a_b_r.md')), 'role is part of the filename');
  assert.ok(fs.existsSync(path.join(dir, '5_module_analysis_1_m.md')));
  assert.ok(!fs.existsSync(path.join(tmp, 'architectural_report.md')), 'rootCopy=false');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('writeDocs with rootCopy=true also writes the copy in cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-'));
  const dir = createProjectDir(tmp);
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    writeDocs(dir, { finalReport: 'R', rootCopy: true });
    assert.ok(fs.existsSync(path.join(tmp, 'architectural_report.md')), 'rootCopy=true');
  } finally {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

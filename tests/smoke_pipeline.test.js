// tests/smoke_pipeline.test.js
// E2E in dryRun mode (mock DI): no real calls to Analysis Engine/DuckDuckGo/GitHub.
// Verifies that the pipeline generates all expected output documents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runPipeline } from '../src/pipeline.js';

test('runPipeline dryRun generates all structured documents', async () => {
  const result = await runPipeline('distributed rust vector database demo', {
    dryRun: true,
    onProgress: () => {},
  });

  const dir = result.dir;
  assert.ok(fs.existsSync(dir), 'project folder created');

  const expectedFiles = [
    '1_intent_decomposition.json',
    '2_repo_candidates.json',
    '4_module_breakdown.json',
    '6_inspiration.json',
    'final_report.md',
  ];
  for (const f of expectedFiles) {
    assert.ok(fs.existsSync(path.join(dir, f)), `missing document: ${f}`);
  }

  const files = fs.readdirSync(dir);
  assert.ok(files.some((f) => f.startsWith('3_repo_analysis_')), 'missing a repo analysis');
  assert.ok(files.some((f) => f.startsWith('5_module_analysis_')), 'missing a module analysis');

  // Coherent contents
  const intent = JSON.parse(fs.readFileSync(path.join(dir, '1_intent_decomposition.json'), 'utf-8'));
  assert.ok(Array.isArray(intent.keywords) && intent.keywords.length > 0, 'intent has keywords');
  assert.ok(result.ranked.length >= 1, 'at least one ranked repo');
  assert.ok(result.modules.length >= 1, 'at least one module');

  // Cleanup the temporary test folder
  fs.rmSync(dir, { recursive: true, force: true });
});

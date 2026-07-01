// tests/resume.test.js
// Offline test of the resume logic (loading intermediates).
// Creates a "future" project folder with the expected files and checks tryResume.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tryResume } from '../src/pipeline.js';
import { PATH_PROJECTS } from '../src/core/config.js';

const TS = '99991231_235959'; // "future" -> latest in time order
const dir = path.join(PATH_PROJECTS, TS);

test('tryResume loads valid intermediates (intent + topN)', async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '1_intent_decomposition.json'),
    JSON.stringify({ project_name: 'X', description: 'd', keywords: ['a'] })
  );
  fs.writeFileSync(
    path.join(dir, '2_repo_candidates.json'),
    JSON.stringify({ candidates: [], topN: [{ fullName: 'a/b', url: 'u', score: 1 }] })
  );
  const r = await tryResume();
  assert.ok(r, 'finds the resume');
  assert.equal(r.intent.project_name, 'X');
  assert.equal(r.ranked.length, 1);
  assert.equal(r.resumeDir, path.resolve(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tryResume returns null when intermediates are missing', async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_intent_decomposition.json'), JSON.stringify({}));
  // 2_repo_candidates.json is missing
  const r = await tryResume();
  assert.equal(r, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

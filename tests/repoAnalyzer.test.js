// tests/repoAnalyzer.test.js
// analyzeRepo: low-signal guard, issues-as-pain-points injection, no-tools framing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRepo } from '../src/analysis/repoAnalyzer.js';

const intent = { description: 'a tool that finds and analyzes repositories' };

/** Mock runClaude that captures the last prompt/systemPrompt it received. */
function captureRun() {
  let last = null;
  const runClaude = async (prompt, systemPrompt) => {
    last = { prompt, systemPrompt };
    return 'OK';
  };
  return { runClaude, get: () => last };
}

test('analyzeRepo injects open issues as pain points and forbids tool requests', async () => {
  const cap = captureRun();
  const fetchIssues = async () => [{ title: 'Crashes on big inputs', body: 'oom' }];
  await analyzeRepo(
    { fullName: 'a/b', description: 'd', readmeSnippet: 'A readme long enough to be above the low-signal threshold.' },
    intent,
    { runClaude: cap.runClaude, fetchIssues }
  );
  const { prompt, systemPrompt } = cap.get();
  assert.match(prompt, /Crashes on big inputs/);
  assert.match(prompt, /reported user problems/);
  assert.match(systemPrompt, /do NOT request tools/);
});

test('analyzeRepo switches to metadata-only mode on a missing/tiny README', async () => {
  const cap = captureRun();
  await analyzeRepo(
    { fullName: 'a/b', description: 'd', readmeSnippet: '' },
    intent,
    { runClaude: cap.runClaude, fetchIssues: async () => [] }
  );
  assert.match(cap.get().prompt, /README is missing or very short/);
});

test('analyzeRepo skips the low-signal note when the README is rich', async () => {
  const cap = captureRun();
  await analyzeRepo(
    { fullName: 'a/b', description: 'd', readmeSnippet: 'x'.repeat(200) },
    intent,
    { runClaude: cap.runClaude, fetchIssues: async () => [] }
  );
  assert.doesNotMatch(cap.get().prompt, /README is missing or very short/);
});

test('analyzeRepo returns role and the agent output', async () => {
  const res = await analyzeRepo(
    { fullName: 'a/b', description: 'd', readmeSnippet: 'r'.repeat(200) },
    intent,
    { runClaude: async () => 'ANALYSIS', fetchIssues: async () => [] }
  );
  assert.equal(res.repo, 'a/b');
  assert.equal(res.role, 'Code Archaeologist');
  assert.equal(res.analysis, 'ANALYSIS');
});

test('analyzeRepo tolerates a failing fetchIssues without aborting', async () => {
  const res = await analyzeRepo(
    { fullName: 'a/b', description: 'd', readmeSnippet: 'r'.repeat(200) },
    intent,
    { runClaude: async () => 'OK', fetchIssues: async () => { throw new Error('boom'); } }
  );
  assert.equal(res.analysis, 'OK');
});

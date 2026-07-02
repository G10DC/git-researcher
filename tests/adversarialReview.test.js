// tests/adversarialReview.test.js
// runAdversarialReview: forwards digests, skips failed analyses, never throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAdversarialReview } from '../src/analysis/adversarialReview.js';

test('runAdversarialReview forwards repo+module digests to the agent', async () => {
  let prompt = '';
  const runClaude = async (p) => { prompt = p; return 'CRITIQUE'; };
  const out = await runAdversarialReview(
    { project_name: 'X', description: 'd' },
    [{ repo: 'a/b', role: 'Code Archaeologist', analysis: 'great, no risks' }],
    [{ module: 'M', role: 'Specialist', analysis: 'perfect design' }],
    { runClaude }
  );
  assert.equal(out, 'CRITIQUE');
  assert.match(prompt, /a\/b/);
  assert.match(prompt, /great, no risks/);
  assert.match(prompt, /perfect design/);
});

test('runAdversarialReview skips failed analyses and degrades gracefully on error', async () => {
  let prompt = '';
  const runClaude = async (p) => { prompt = p; throw new Error('boom'); };
  const out = await runAdversarialReview(
    { description: 'd' },
    [{ repo: 'a/b', analysis: '⚠️ Analysis failed for a/b: x' }, { repo: 'c/d', analysis: 'ok' }],
    [],
    { runClaude }
  );
  assert.match(out, /Adversarial review unavailable/);
  assert.doesNotMatch(prompt, /⚠️ Analysis failed/);
});

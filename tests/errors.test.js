// tests/errors.test.js
// Verifies the custom exception hierarchy (centralized error handling).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitResearcherError, ClaudeError, DiscoveryError, EnrichmentError } from '../src/core/errors.js';

test('ClaudeError belongs to the correct hierarchy', () => {
  const e = new ClaudeError('cli missing');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof GitResearcherError);
  assert.ok(e instanceof ClaudeError);
  assert.equal(e.name, 'ClaudeError');
  assert.equal(e.message, 'cli missing');
});

test('DiscoveryError and EnrichmentError derive from GitResearcherError', () => {
  assert.ok(new DiscoveryError('ddg blocked') instanceof GitResearcherError);
  assert.ok(new EnrichmentError('404') instanceof GitResearcherError);
  assert.equal(new DiscoveryError('x').name, 'DiscoveryError');
  assert.equal(new EnrichmentError('x').name, 'EnrichmentError');
});

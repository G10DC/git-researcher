// src/core/errors.js
// Project-specific exception hierarchy (centralized error handling).
// All derive from GitResearcherError: enables differentiated catches and targeted tests.

/**
 * Base error for GitResearcher.
 */
export class GitResearcherError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'GitResearcherError';
  }
}

/** Claude CLI missing, not authenticated, timed out, or exited non-zero. */
export class ClaudeError extends GitResearcherError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'ClaudeError';
  }
}

/** Discovery failed (DuckDuckGo blocked/CAPTCHA, no candidates). */
export class DiscoveryError extends GitResearcherError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'DiscoveryError';
  }
}

/** Enrichment failed (404/private repo page, page parsing impossible). */
export class EnrichmentError extends GitResearcherError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'EnrichmentError';
  }
}

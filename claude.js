// claude.js (root) - backwards-compatibility shim.
// Logic lives in src/core/claude.js; this file re-exports for root importers.
export { runClaude, runClaudeJSON, runClaudeJSONWithRetry } from './src/core/claude.js';

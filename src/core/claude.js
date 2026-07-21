// src/core/claude.js
// Execution wrapper for the CLI runner service. Standard process isolation and JSON parsing.

import { spawn as realSpawn } from 'node:child_process';
import { cleanJsonString, safeJsonParse } from './utils.js';
import { CLAUDE_TIMEOUT_MS } from './config.js';
import { ClaudeError } from './errors.js';

// Internal binary probe state
let probeState = 'unknown';

/** Resets the probe cache (for testing). */
export function _resetProbe() {
  probeState = 'unknown';
}

// Validates CLI runner binary availability
async function ensureBinaryAvailable(spawnFn) {
  if (probeState === 'ok') return;
  if (probeState instanceof Error) throw probeState;

  const ok = await new Promise((resolve) => {
    const child = spawnFn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    const finish = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* noop */
      }
      finish(false);
    }, 8000);
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });

  if (!ok) {
    const err = new ClaudeError('CLI runner binary not available or not responding.');
    probeState = err;
    throw err;
  }
  probeState = 'ok';
}

/**
 * Runs a prompt on the CLI runner service in headless mode and returns stdout.
 * @param {string} prompt
 * @param {string} systemPrompt
 * @param {number} timeoutMs
 * @param {string} cwd
 * @param {{spawn?:Function}} [deps]
 * @returns {Promise<string>}
 */
export async function runClaude(
  prompt,
  systemPrompt = '',
  timeoutMs = CLAUDE_TIMEOUT_MS,
  cwd = process.cwd(),
  deps = {}
) {
  const spawnFn = deps.spawn || realSpawn;
  await ensureBinaryAvailable(spawnFn);

  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'sonnet', '--no-session-persistence'];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
    if (process.env.CLAUDE_EXTRA_ARGS) {
      args.push(...process.env.CLAUDE_EXTRA_ARGS.split(/\s+/).filter(Boolean));
    }

    const child = spawnFn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });

    const timer = setTimeout(() => {
      console.warn(`\n⚠️ Service request timed out after ${timeoutMs / 1000}s.`);
      try {
        child.kill('SIGKILL');
      } catch {
        /* noop */
      }
      reject(new ClaudeError('CLAUDE_TIMEOUT'));
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdin.write(prompt + '\n');
    child.stdin.end();

    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ClaudeError(`spawn failed: ${err.message}`, { cause: err }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === null) {
        reject(new ClaudeError('CLAUDE_TIMEOUT'));
      } else if (code !== 0) {
        reject(new ClaudeError(`Service process exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Runs prompt and parses JSON output.
 */
export async function runClaudeJSON(prompt, systemPrompt = '', timeoutMs = CLAUDE_TIMEOUT_MS, deps = {}) {
  const raw = await runClaude(prompt, systemPrompt, timeoutMs, process.cwd(), deps);
  return safeJsonParse(cleanJsonString(raw));
}

/**
 * Runs prompt with JSON parsing, utilizing a lean correction prompt on error (token optimized).
 */
export async function runClaudeJSONWithRetry(prompt, systemPrompt = '', deps = {}) {
  const run = deps.runClaudeJSON || runClaudeJSON;
  try {
    return await run(prompt, systemPrompt);
  } catch (err) {
    // Optimized retry prompt: sends targeted correction request rather than duplicating prompt
    const correction =
      `Your previous JSON output was invalid: ${err.message}.\n` +
      `Original Schema Requirement: Please analyze the provided input and return ONLY valid JSON matching the specified schema.\n` +
      `Return valid raw JSON now with no markdown fences or conversational text.`;
    return await run(correction, systemPrompt);
  }
}

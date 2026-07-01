// src/core/claude.js
// Wrapper for the Claude Code CLI. spawn is injectable via deps.spawn; the binary probe is
// lazy so import-smoke and CI run even without the CLI installed.

import { spawn as realSpawn } from 'node:child_process';
import { cleanJsonString, safeJsonParse } from './utils.js';
import { CLAUDE_TIMEOUT_MS } from './config.js';
import { ClaudeError } from './errors.js';

// Probe cache: 'unknown' | 'ok' | Error
let probeState = 'unknown';

/** Resets the probe cache (for tests). */
export function _resetProbe() {
  probeState = 'unknown';
}

// Probes the 'claude' binary (lazy, cached in probeState). Throws ClaudeError if missing.
async function ensureClaudeAvailable(spawnFn) {
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
    const err = new ClaudeError(
      "'claude' binary not available or not responding. " +
        'Install/authenticate the Claude Code CLI (npm install -g @anthropic-ai/claude-code).'
    );
    probeState = err;
    throw err;
  }
  probeState = 'ok';
}

/**
 * Runs a prompt on the CLI in headless mode, returns stdout.
 * @param {{spawn?:Function}} [deps] injectable spawn (for tests)
 * @throws {ClaudeError} on missing binary, timeout, or non-zero exit
 */
export async function runClaude(
  prompt,
  systemPrompt = '',
  timeoutMs = CLAUDE_TIMEOUT_MS,
  cwd = process.cwd(),
  deps = {}
) {
  const spawnFn = deps.spawn || realSpawn;
  await ensureClaudeAvailable(spawnFn);

  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'sonnet', '--no-session-persistence'];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
    // Determinism/model flags. The Claude Code CLI does not expose --temperature as of v2.1.x,
    // so CLAUDE_EXTRA_ARGS is a forward-compatible hook (e.g. CLAUDE_EXTRA_ARGS="--temperature 0").
    if (process.env.CLAUDE_EXTRA_ARGS) {
      args.push(...process.env.CLAUDE_EXTRA_ARGS.split(/\s+/).filter(Boolean));
    }

    const child = spawnFn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });

    const timer = setTimeout(() => {
      console.warn(`\n⚠️ Claude Code request timed out after ${timeoutMs / 1000}s.`);
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
        reject(new ClaudeError(`Claude Code exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// runClaude + JSON parse (stripping markdown fences).
export async function runClaudeJSON(prompt, systemPrompt = '', timeoutMs = CLAUDE_TIMEOUT_MS, deps = {}) {
  const raw = await runClaude(prompt, systemPrompt, timeoutMs, process.cwd(), deps);
  return safeJsonParse(cleanJsonString(raw));
}

// runClaudeJSON with a single correction-prompt retry if parsing fails.
// Reuses deps.runClaudeJSON for dryRun/tests.
export async function runClaudeJSONWithRetry(prompt, systemPrompt = '', deps = {}) {
  const run = deps.runClaudeJSON || runClaudeJSON;
  try {
    return await run(prompt, systemPrompt);
  } catch (err) {
    const correction =
      `${prompt}\n\n` +
      `NOTE: your previous output was not valid JSON (${err.message}). ` +
      `Return ONLY valid JSON code, with no introductory/concluding text ` +
      `and no markdown code fences, following the requested schema.`;
    return await run(correction, systemPrompt);
  }
}

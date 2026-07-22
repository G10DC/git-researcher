// src/core/claude.js
// Execution wrapper for the CLI runner service. Standard process isolation and JSON parsing.

import { spawn as realSpawn } from 'node:child_process';
import { cleanJsonString, safeJsonParse } from './utils.js';
import { CLAUDE_TIMEOUT_MS } from './config.js';
import { ClaudeError } from './errors.js';

let probeState = 'unknown';

/**
 * Ensures the claude CLI binary is available and responsive.
 * Caches status to avoid duplicate process spawning.
 */
async function ensureBinaryAvailable(spawnFn) {
  if (probeState === 'ok') return;
  if (probeState instanceof Error) throw probeState;

  const ok = await new Promise((resolve) => {
    const child = spawnFn('claude', ['--version'], { stdio: 'ignore' });
    let finished = false;
    const finish = (val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(val);
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* noop */
      }
      finish(false);
    }, 3000);

    child.on('error', () => finish(false));
    child.on('close', (code) => {
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

let chronicleInstance = null;
async function getChronicle() {
  if (chronicleInstance) return chronicleInstance;
  try {
    const { Chronicle } = await import('../../../chronicle/lib/chronicle.js');
    chronicleInstance = new Chronicle();
  } catch {
    chronicleInstance = { compressLog: (t) => t };
  }
  return chronicleInstance;
}

let authState = 'unknown';
async function checkAuth(spawnFn) {
  if (authState !== 'unknown') return authState;
  
  return new Promise((resolve) => {
    const child = spawnFn('claude', ['status'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve(false);
    }, 4000);
    
    child.on('close', () => {
      clearTimeout(timer);
      const isLogged = !output.includes('Not signed in') && !output.includes('Not connected');
      resolve(isLogged);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function callOpenRouterFallback(prompt, systemPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not found in process.env.OPENROUTER_API_KEY');
  }
  
  const model = 'google/gemini-2.5-flash';
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  const body = { model, messages };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/G10DC/git-researcher',
      'X-Title': 'GitResearcher'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API failed: ${response.status} - ${errText}`);
  }
  
  const json = await response.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenRouter API returned an empty response');
  }
  return text;
}

async function callGeminiFallback(prompt, systemPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not found in process.env.GEMINI_API_KEY');
  }
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }]
  };
  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API failed: ${response.status} - ${errText}`);
  }
  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned an empty response');
  }
  return text;
}

const isTestEnv = process.env.NODE_ENV === 'test' || 
                  process.env.NODE_TEST_CONTEXT ||
                  (process.argv && process.argv.some(arg => arg.includes('test') || arg.includes('tests')));

async function handleFallback(prompt, systemPrompt) {
  if (isTestEnv) {
    throw new Error('Fallback disabled in test environment');
  }
  if (process.env.OPENROUTER_API_KEY) {
    return callOpenRouterFallback(prompt, systemPrompt);
  }
  if (process.env.GEMINI_API_KEY) {
    return callGeminiFallback(prompt, systemPrompt);
  }
  throw new Error('No API fallback key available (OPENROUTER_API_KEY / GEMINI_API_KEY)');
}

/**
 * Runs a prompt on the CLI runner service in headless mode and returns stdout.
 * @param {string} prompt
 * @param {string} systemPrompt
 * @param {number} timeoutMs
 * @param {string} cwd
 * @param {{spawn?:Function, isTestEnv?:boolean}} [deps]
 * @returns {Promise<string>}
 */
export async function runClaude(
  prompt,
  systemPrompt = '',
  timeoutMs = CLAUDE_TIMEOUT_MS,
  cwd = process.cwd(),
  deps = {}
) {
  const chron = await getChronicle();
  const cleanPrompt = chron.compressLog(prompt);
  const spawnFn = deps.spawn || realSpawn;
  const localIsTest = isTestEnv || !!deps.isTestEnv;

  try {
    await ensureBinaryAvailable(spawnFn);
    const isAuthed = await checkAuth(spawnFn);
    if (!isAuthed && !localIsTest) {
      return handleFallback(cleanPrompt, systemPrompt);
    }
  } catch (err) {
    if (!localIsTest && (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY)) {
      return handleFallback(cleanPrompt, systemPrompt);
    }
    throw err;
  }

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
      if (!localIsTest && (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY)) {
        handleFallback(cleanPrompt, systemPrompt).then(resolve).catch(() => {
          reject(new ClaudeError('CLAUDE_TIMEOUT'));
        });
      } else {
        reject(new ClaudeError('CLAUDE_TIMEOUT'));
      }
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdin.write(cleanPrompt + '\n');
    child.stdin.end();

    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!localIsTest && (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY)) {
        handleFallback(cleanPrompt, systemPrompt).then(resolve).catch(() => {
          reject(new ClaudeError(`spawn failed: ${err.message}`, { cause: err }));
        });
      } else {
        reject(new ClaudeError(`spawn failed: ${err.message}`, { cause: err }));
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === null) {
        if (!localIsTest && (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY)) {
          handleFallback(cleanPrompt, systemPrompt).then(resolve).catch(() => {
            reject(new ClaudeError('CLAUDE_TIMEOUT'));
          });
        } else {
          reject(new ClaudeError('CLAUDE_TIMEOUT'));
        }
      } else if (code !== 0) {
        if (!localIsTest && (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY)) {
          handleFallback(cleanPrompt, systemPrompt).then(resolve).catch(() => {
            reject(new ClaudeError(`Service process exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
          });
        } else {
          reject(new ClaudeError(`Service process exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        }
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

/**
 * Resets the CLI probe state cache (used in tests).
 */
export function _resetProbe() {
  probeState = 'unknown';
}

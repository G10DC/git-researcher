// tests/claude.test.js
// runClaude and runClaudeJSON tested with an injected mock spawner (deps.spawn): no real process.
// runClaudeJSONWithRetry tested with a mocked deps.runClaudeJSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runClaude,
  runClaudeJSON,
  runClaudeJSONWithRetry,
  _resetProbe,
} from '../src/core/claude.js';
import { ClaudeError } from '../src/core/errors.js';

/** Factory for a fake child process. */
function makeChild({ stdout = '', exitCode = 0, error = null, hang = false } = {}) {
  return {
    stdin: { write() {}, end() {} },
    stdout: {
      on(ev, cb) {
        if (ev === 'data' && stdout) setImmediate(() => cb(Buffer.from(stdout)));
      },
    },
    stderr: { on() {} },
    on(ev, cb) {
      if (ev === 'error' && error) setImmediate(() => cb(error));
      else if (ev === 'close' && !hang && !error) setImmediate(() => cb(exitCode));
    },
    kill() {},
  };
}

/** spawnFn that passes the probe (--version -> exit 0) and customizes the real call. */
function spawnWith(opts) {
  return (_cmd, args) => (args.includes('--version') ? makeChild({ exitCode: 0 }) : makeChild(opts));
}

test('runClaude resolves stdout (probe ok + call ok)', async () => {
  _resetProbe();
  const r = await runClaude('p', 's', 5000, '.', { spawn: spawnWith({ stdout: 'hello' }) });
  assert.equal(r, 'hello');
});

test('runClaude rejects ClaudeError on non-zero exit code', async () => {
  _resetProbe();
  await assert.rejects(
    () => runClaude('p', 's', 5000, '.', { spawn: spawnWith({ exitCode: 2 }) }),
    (err) => err instanceof ClaudeError && /exited with code 2/.test(err.message)
  );
});

test('runClaude rejects ClaudeError on spawn error event', async () => {
  _resetProbe();
  await assert.rejects(
    () => runClaude('p', 's', 5000, '.', { spawn: spawnWith({ error: new Error('ENOENT') }) }),
    (err) => err instanceof ClaudeError && /ENOENT/.test(err.message)
  );
});

test('runClaude rejects ClaudeError on timeout', async () => {
  _resetProbe();
  await assert.rejects(
    () => runClaude('p', 's', 20, '.', { spawn: spawnWith({ hang: true }) }),
    (err) => err instanceof ClaudeError && /TIMEOUT/.test(err.message)
  );
});

test('runClaude rejects ClaudeError when the probe fails (binary missing)', async () => {
  _resetProbe();
  const failing = () => makeChild({ exitCode: 1 });
  await assert.rejects(
    () => runClaude('p', 's', 5000, '.', { spawn: failing }),
    (err) => err instanceof ClaudeError && /not available/.test(err.message)
  );
});

test('runClaudeJSON strips markdown fences and parses JSON', async () => {
  _resetProbe();
  const r = await runClaudeJSON('p', 's', 5000, {
    spawn: spawnWith({ stdout: '```json\n{"k": 1}\n```' }),
  });
  assert.deepEqual(r, { k: 1 });
});

test('runClaudeJSONWithRetry retries with correction on first parse failure', async () => {
  let calls = 0;
  const fakeJSON = async () => {
    calls++;
    if (calls === 1) throw new Error('bad json');
    return { ok: true };
  };
  const r = await runClaudeJSONWithRetry('prompt', 'sys', { runClaudeJSON: fakeJSON });
  assert.equal(calls, 2);
  assert.deepEqual(r, { ok: true });
});

test('runClaudeJSONWithRetry does not retry if the first attempt succeeds', async () => {
  let calls = 0;
  const fakeJSON = async () => {
    calls++;
    return { ok: true };
  };
  const r = await runClaudeJSONWithRetry('p', 's', { runClaudeJSON: fakeJSON });
  assert.equal(calls, 1);
  assert.deepEqual(r, { ok: true });
});

/** spawnFn that answers the probe, the auth check, and the real call separately. */
function spawnAuthAware(onArgs, authStdout = '{"loggedIn":true}') {
  return (_cmd, args) => {
    onArgs(args);
    if (args.includes('--version')) return makeChild({ exitCode: 0 });
    if (args[0] === 'auth') return makeChild({ stdout: authStdout });
    return makeChild({ stdout: 'ok' });
  };
}

test('the auth check asks `claude auth status`, never `claude status`', async () => {
  _resetProbe();
  const seen = [];
  const r = await runClaude('p', 's', 5000, '.', { spawn: spawnAuthAware((a) => seen.push(a.join(' '))) });

  assert.equal(r, 'ok');
  assert.ok(seen.includes('auth status'), 'the auth check did not ask `claude auth status`');
  // `claude status` is a different command: it prompts the MODEL for a prose summary of
  // the working directory. It spent quota on every check, outlived the 4s timeout, and
  // resolved false -- so every real run was diverted to the API fallback and died there
  // on a 402 during intent extraction.
  assert.ok(!seen.includes('status'), '`claude status` prompts the model and costs a request');
});

test('the auth verdict is cached: one probe per process, not one per call', async () => {
  _resetProbe();
  let authProbes = 0;
  const spawn = spawnAuthAware((a) => { if (a[0] === 'auth') authProbes++; });

  await runClaude('p1', 's', 5000, '.', { spawn });
  await runClaude('p2', 's', 5000, '.', { spawn });

  assert.equal(authProbes, 1, 'authState was declared and never assigned, so every call respawned a process');
});

test('_resetProbe clears the auth verdict as well as the binary probe', async () => {
  _resetProbe();
  let authProbes = 0;
  const spawn = spawnAuthAware((a) => { if (a[0] === 'auth') authProbes++; });

  await runClaude('p1', 's', 5000, '.', { spawn });
  _resetProbe();
  await runClaude('p2', 's', 5000, '.', { spawn });

  assert.equal(authProbes, 2, 'a verdict from one test would decide the next');
});

test('runClaude appends CLAUDE_EXTRA_ARGS to the spawn args (determinism hook)', async () => {
  _resetProbe();
  const prev = process.env.CLAUDE_EXTRA_ARGS;
  process.env.CLAUDE_EXTRA_ARGS = '--temperature 0';
  try {
    let captured = null;
    const spawn = (_cmd, args) => {
      if (args.includes('--version')) return makeChild({ exitCode: 0 });
      captured = args;
      return makeChild({ stdout: 'ok' });
    };
    await runClaude('p', 's', 5000, '.', { spawn });
    assert.ok(captured.includes('--temperature'), 'extra flag passed through');
    assert.ok(captured.includes('0'));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_EXTRA_ARGS;
    else process.env.CLAUDE_EXTRA_ARGS = prev;
  }
});

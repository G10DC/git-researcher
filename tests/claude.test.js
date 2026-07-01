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

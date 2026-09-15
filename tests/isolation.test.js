// tests/isolation.test.js
//
// The test suite must not touch the data a real run leaves behind.
//
// CACHE_DIR ('.cache') and PATH_PROJECTS ('projects') are relative, resolved against the
// working directory at call time. cache.test.js ended with
// `fs.rmSync(CACHE_DIR, { recursive: true, force: true })`, so running `npm test` from the
// repository root deleted the cache of every earlier real run; resume.test.js and the
// dry-run smoke test wrote into the real projects/ folder. The suite and a real run share
// the same two directories, which is also how a test run once looked like evidence that a
// concurrent real run had got past its first phase.
//
// The check runs the writing test files in a child process whose working directory holds
// canary files, and asserts the canaries survive. It never touches the repository's own
// .cache or projects.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TESTS = import.meta.dirname;

test('the cache and resume tests leave a real .cache and projects/ untouched', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-isolation-'));
  try {
    fs.mkdirSync(path.join(cwd, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.cache', 'canary.json'), '{"ts":0,"value":"from a real run"}');
    fs.mkdirSync(path.join(cwd, 'projects', '20260101_000000'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'projects', '20260101_000000', 'final_report.md'), '# a real report');

    // NODE_TEST_CONTEXT would make the child behave as a subprocess of this runner.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(
      process.execPath,
      ['--test', path.join(TESTS, 'cache.test.js'), path.join(TESTS, 'resume.test.js')],
      { cwd, env, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, `the child test run failed:\n${r.stdout}\n${r.stderr}`);

    assert.ok(fs.existsSync(path.join(cwd, '.cache', 'canary.json')),
      'a test deleted the real .cache directory, and every cached page of earlier runs with it');
    assert.ok(fs.existsSync(path.join(cwd, 'projects', '20260101_000000', 'final_report.md')),
      'a test deleted a real run report');
    assert.deepEqual(fs.readdirSync(path.join(cwd, 'projects')), ['20260101_000000'],
      'a test left its own folders inside the real projects/');
    assert.deepEqual(fs.readdirSync(path.join(cwd, '.cache')), ['canary.json'],
      'a test left its own entries inside the real .cache');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

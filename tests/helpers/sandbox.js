// tests/helpers/sandbox.js
// Runs a test file inside its own temporary working directory.
//
// CACHE_DIR ('.cache') and PATH_PROJECTS ('projects') are relative paths, resolved against
// the working directory at call time. A test that uses the real defaults from the
// repository root writes into -- and, in cache.test.js, deleted -- the data real runs
// leave behind. `node --test` runs each file in its own process, so moving that process
// into a sandbox isolates the file without touching the modules under test.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

/**
 * Moves this test process into a fresh temporary directory, and back out afterwards.
 * @param {string} label shows up in the directory name, to trace a leftover to its file
 * @returns {string} the sandbox path
 */
export function useSandboxCwd(label) {
  const original = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gr-${label}-`));
  process.chdir(dir);
  after(() => {
    process.chdir(original);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

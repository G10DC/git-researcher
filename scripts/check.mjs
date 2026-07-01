#!/usr/bin/env node
// scripts/check.mjs
// import-smoke helper: verifies that an ES module exports the required names.
// Usage: node scripts/check.mjs <modulePath> <exportName> [exportName...]
// Exits with code 1 if the import fails or a required export is undefined.
// Catches contract mismatches (e.g. TOP_N_REPO vs TOP_N_REPOS) during validation,
// not at the final task.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , modulePath, ...names] = process.argv;

if (!modulePath || names.length === 0) {
  console.error('Usage: node scripts/check.mjs <modulePath> <exportName> [exportName...]');
  process.exit(2);
}

const url = pathToFileURL(resolve(modulePath)).href;
let mod;
try {
  mod = await import(url);
} catch (err) {
  console.error(`import-smoke FAILED for ${modulePath}:`, err.message);
  process.exit(1);
}

const missing = names.filter((n) => mod[n] === undefined);
if (missing.length > 0) {
  console.error(
    `import-smoke FAILED: missing exports in ${modulePath}: ${missing.join(', ')}`
  );
  process.exit(1);
}

console.log(`import-smoke OK [${modulePath}]: ${names.join(', ')}`);

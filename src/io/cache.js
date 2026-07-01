// src/io/cache.js
// On-disk cache for DuckDuckGo responses (SERP) and GitHub repo pages.
// TTL = CACHE_TTL_HOURS. Never blocks the flow (I/O errors -> warning + miss).
// In dryRun the pipeline injects NOOP_CACHE.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CACHE_DIR, CACHE_TTL_HOURS } from '../core/config.js';

/**
 * Deterministic cache key from arbitrary parts.
 * @param {...string} parts
 * @returns {string}
 */
export function makeKey(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
}

function filePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

/**
 * Reads a value from the cache (null if missing/expired/error).
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getCache(key) {
  try {
    const fp = filePath(key);
    if (!fs.existsSync(fp)) return null;
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    if (!data || typeof data !== 'object' || !('ts' in data) || !('value' in data)) return null;
    const ageMs = Date.now() - data.ts;
    if (ageMs > CACHE_TTL_HOURS * 3600 * 1000) return null; // expired
    return data.value;
  } catch {
    return null;
  }
}

/**
 * Writes a value to the cache with a timestamp.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function setCache(key, value) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(filePath(key), JSON.stringify({ ts: Date.now(), value }));
  } catch (e) {
    console.warn(`⚠️ Cache write failed (${key}): ${e.message}`);
  }
}

/** Real on-disk cache (default in real runs). */
export const DEFAULT_CACHE = { get: getCache, set: setCache };

/** No-op cache (injected in dryRun/tests to avoid writing to disk). */
export const NOOP_CACHE = { get: async () => null, set: async () => {} };

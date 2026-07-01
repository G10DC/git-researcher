// src/core/utils.js
// Shared helpers. No internal dependencies (foundation).

/**
 * Timestamp YYYYMMDD_HHMMSS.
 * @returns {string}
 */
export function getTimestamp() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * Strips markdown fences (```json ... ```) and trims.
 * @param {string} str
 * @returns {string}
 */
export function cleanJsonString(str) {
  let cleaned = String(str).trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\r?\n/, '')
      .replace(/\r?\n```$/, '');
  }
  return cleaned.trim();
}

/**
 * JSON.parse with a clear error (includes a preview of the payload).
 * @param {string} str
 * @returns {any}
 */
export function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    throw new Error(
      `JSON parse failed: ${err.message}. Payload (first 200 chars): ${String(str).slice(0, 200)}`
    );
  }
}

/** Promise-based sleep. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` with linear-backoff retry; returns the result or `null` if all attempts fail.
 * Centralizes the retry pattern used by duckSearch and repoEnricher (DRY).
 * @template T
 * @param {(attempt:number)=>Promise<T>} fn
 * @param {{retries?:number, delayMs?:number}} [opts]
 * @returns {Promise<T|null>}
 */
export async function withRetry(fn, { retries = 3, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch {
      if (attempt < retries) await sleep(delayMs * attempt);
    }
  }
  return null;
}

/**
 * Runs `worker` over `items` with limited concurrency, preserving result order.
 * @template T,R
 * @param {T[]} items
 * @param {(item:T,index:number)=>Promise<R>} worker
 * @param {number} [concurrency=3]
 * @returns {Promise<R[]>}
 */
export async function runPool(items, worker, concurrency = 3) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  // concurrency<=0 is normalized to 1 (when there are items) so the worker still runs
  // instead of returning an array of empty slots.
  const size = items.length === 0 ? 0 : Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: size }, () => runner()));
  return results;
}

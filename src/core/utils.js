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
 * Sanitizes external untrusted text (READMEs, search snippets) to prevent prompt injection,
 * strip raw HTML/SVG junk, and trim token bloat.
 * @param {string} text
 * @param {number} [maxLen=3000]
 * @returns {string}
 */
export function sanitizeScrapedContent(text, maxLen = 3000) {
  if (!text) return '';
  let cleaned = String(text)
    // Strip HTML/SVG tags
    .replace(/<[^>]*>/g, ' ')
    // Neutralize prompt-injection directives.
    //
    // BOUND, stated rather than implied: this is a denylist, and a denylist over natural
    // language cannot be complete. It previously matched three exact phrases, so
    // "disregard the above" or "forget prior directions" walked straight through. The
    // patterns below are wider, but a paraphrase, another language or a homoglyph still
    // passes. The real defence is that this text is delimited and labelled UNTRUSTED in
    // the prompt (see repoAnalyzer) -- a channel boundary, not a string filter. Do not
    // raise the trust placed in scraped content because this function exists.
    .replace(
      /\b(?:ignore|disregard|forget|override|overwrite|bypass|discard)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding|foregoing|system)\s*(?:instructions?|prompts?|rules?|directions?|context)?/gi,
      '[filtered]'
    )
    .replace(/\b(?:system|developer)\s+(?:prompt|message|instruction)s?\b/gi, '[filtered]')
    .replace(/\b(?:new|updated|revised)\s+instructions?\s*:/gi, '[filtered]')
    .replace(/\byou\s+are\s+now\s+(?:a|an|the)\b/gi, '[filtered]')
    .replace(/<\/?(?:system|assistant|user|instructions?)>/gi, '[filtered]')
    // Strip badge image markdown links e.g. [![...](...)]
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    // Replace multiple newlines/spaces
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '... [truncated]' : cleaned;
}

/**
 * Strips markdown fences (```json ... ```) and extracts valid JSON substring.
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
  cleaned = cleaned.trim();
  // Subtree extraction fallback if surrounding prose remains
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return cleaned.slice(firstBracket, lastBracket + 1);
  }
  return cleaned;
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
 * @template T
 * @param {(attempt:number)=>Promise<T>} fn
 * @param {{retries?:number, delayMs?:number}} [opts]
 * @returns {Promise<T|null>}
 */
export async function withRetry(fn, { retries = 3, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      // An error may declare itself not worth retrying. A refused spend ceiling does:
      // it is a decision, not a transient fault, and retrying it burned three attempts
      // and three seconds before reporting the source as empty. Checked as a property,
      // not a type, so this module stays dependency-free as its header claims.
      if (err && err.noRetry) throw err;
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
  const size = items.length === 0 ? 0 : Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: size }, () => runner()));
  return results;
}

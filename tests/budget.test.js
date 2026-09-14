// tests/budget.test.js
//
// The ceiling must refuse BEFORE the call is made, and the counters must report what was
// spent even when nothing was refused: a run that cannot say what it spent cannot be told
// apart from a run that did nothing.

import test from 'node:test';
import assert from 'node:assert';

import { createBudget, BudgetExceededError, NOOP_BUDGET } from '../src/core/budget.js';

test('an unconfigured budget counts without ever refusing', () => {
  const b = createBudget();
  for (let i = 0; i < 500; i++) b.countLlm();
  for (let i = 0; i < 500; i++) b.countHttp();
  const r = b.report();
  assert.equal(r.llmCalls, 500);
  assert.equal(r.httpRequests, 500);
  assert.equal(r.maxLlmCalls, Infinity);
});

test('the llm ceiling refuses the call that would exceed it, not the one after', () => {
  const b = createBudget({ maxLlmCalls: 3 });
  assert.equal(b.countLlm(), 1);
  assert.equal(b.countLlm(), 2);
  assert.equal(b.countLlm(), 3);
  assert.throws(() => b.countLlm(), BudgetExceededError);
  // the refused call must not be counted: the report is of spend, not of attempts
  assert.equal(b.report().llmCalls, 3);
});

test('the http ceiling is separate from the llm one', () => {
  const b = createBudget({ maxLlmCalls: 1, maxHttpRequests: 2 });
  b.countLlm();
  b.countHttp();
  b.countHttp();
  assert.throws(() => b.countHttp(), BudgetExceededError);
  assert.throws(() => b.countLlm(), BudgetExceededError);
  const r = b.report();
  assert.equal(r.llmCalls, 1);
  assert.equal(r.httpRequests, 2);
});

test('the error says what was spent and where to raise it', () => {
  const b = createBudget({ maxHttpRequests: 1 });
  b.countHttp();
  try {
    b.countHttp();
    assert.fail('the ceiling did not refuse');
  } catch (e) {
    assert.ok(e instanceof BudgetExceededError);
    assert.equal(e.kind, 'http');
    assert.equal(e.used, 1);
    assert.equal(e.limit, 1);
    assert.match(e.message, /1 of 1 allowed/);
    assert.match(e.message, /config\.js/);
  }
});

test('wrapFetch counts every request and passes arguments and result through', async () => {
  const seen = [];
  const inner = async (url, opts) => { seen.push([url, opts]); return { ok: true, url }; };
  const b = createBudget({ maxHttpRequests: 10 });
  const counted = b.wrapFetch(inner);

  const res = await counted('https://example.com/a', { method: 'POST' });
  assert.equal(res.url, 'https://example.com/a');
  assert.equal(seen[0][0], 'https://example.com/a');
  assert.equal(seen[0][1].method, 'POST');

  await counted('https://example.com/b');
  assert.equal(b.report().httpRequests, 2);
});

test('wrapFetch refuses before the wrapped implementation is ever called', async () => {
  let called = 0;
  const inner = async () => { called += 1; return { ok: true }; };
  const b = createBudget({ maxHttpRequests: 1 });
  const counted = b.wrapFetch(inner);

  await counted('https://example.com/a');
  assert.equal(called, 1);

  assert.throws(() => counted('https://example.com/b'), BudgetExceededError);
  assert.equal(called, 1, 'the request was sent despite the ceiling');
});

test('NOOP_BUDGET refuses nothing and leaves fetch untouched', async () => {
  for (let i = 0; i < 100; i++) { NOOP_BUDGET.countLlm(); NOOP_BUDGET.countHttp(); }
  const inner = async () => ({ ok: true });
  assert.equal(NOOP_BUDGET.wrapFetch(inner), inner, 'the dry-run path must not wrap');
  assert.equal(NOOP_BUDGET.report().llmCalls, 0);
});

test('the error names a constant config.js actually exports', async () => {
  // The first version derived the name from the kind and produced MAX_HTTP_CALLS, which
  // does not exist. A message pointing at a constant nobody can find is the same defect
  // this project keeps finding in its own documentation.
  const config = await import('../src/core/config.js');
  const b = createBudget({ maxHttpRequests: 0, maxLlmCalls: 0 });

  assert.throws(() => b.countHttp(), (e) => {
    assert.match(e.message, /MAX_HTTP_REQUESTS/);
    assert.notEqual(config.MAX_HTTP_REQUESTS, undefined, 'the message names a constant config.js does not export');
    return true;
  });
  assert.throws(() => b.countLlm(), (e) => {
    assert.match(e.message, /MAX_LLM_CALLS/);
    assert.notEqual(config.MAX_LLM_CALLS, undefined, 'the message names a constant config.js does not export');
    return true;
  });
});

test('a refusal declares itself not worth retrying', () => {
  const b = createBudget({ maxHttpRequests: 0 });
  assert.throws(() => b.countHttp(), (e) => {
    assert.equal(e.noRetry, true, 'withRetry would retry the ceiling three times over');
    return true;
  });
});

test('two budgets do not share a count', () => {
  const a = createBudget({ maxLlmCalls: 2 });
  const b = createBudget({ maxLlmCalls: 2 });
  a.countLlm();
  a.countLlm();
  assert.throws(() => a.countLlm(), BudgetExceededError);
  assert.equal(b.countLlm(), 1, 'a second run inherited the first run spend');
});

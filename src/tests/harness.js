/** A deliberately tiny test harness — no dependencies, runs in the browser. */

export const results = [];
let currentGroup = 'general';

export function group(name) { currentGroup = name; }

export async function test(name, fn) {
  const entry = { group: currentGroup, name, ok: true, error: null, ms: 0 };
  const t0 = performance.now();
  try {
    await fn();
  } catch (e) {
    entry.ok = false;
    entry.error = (e && e.message) ? e.message : String(e);
    entry.stack = e && e.stack;
  }
  entry.ms = performance.now() - t0;
  results.push(entry);
  return entry;
}

export function assert(cond, message = 'assertion failed') {
  if (!cond) throw new Error(message);
}

export function eq(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function near(actual, expected, tol = 1e-6, message = '') {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${message || 'values differ'} — expected ${expected} ±${tol}, got ${actual}`);
  }
}

export function deepEq(a, b, message = '') {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${message || 'structures differ'}\n  expected ${sb}\n  got      ${sa}`);
}

export function throws(fn, message = 'expected a throw') {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(message);
}

export function summary() {
  const pass = results.filter((r) => r.ok).length;
  return { total: results.length, pass, fail: results.length - pass, results };
}

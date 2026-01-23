import { logEvent } from './log';

/**
 * Global GitHub REST concurrency limiter.
 *
 * Why: secondary rate limits are often triggered by bursts of concurrent REST
 * calls across different endpoints (not only /search/code). This limiter keeps
 * overall GitHub REST traffic bounded.
 */

const DEFAULT_MAX_CONCURRENCY = 5;

let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
let inFlight = 0;
const waiters: Array<() => void> = [];

/** Test-only: disable limiter (set to Infinity) or override concurrency. */
export function __setGithubRestMaxConcurrencyForTests(n: number) {
  maxConcurrency = n;
}

/** Test-only: reset limiter state. */
export function __resetGithubRestLimiterForTests() {
  maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  inFlight = 0;
  waiters.splice(0, waiters.length);
}

async function acquire() {
  if (inFlight < maxConcurrency) {
    inFlight += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    waiters.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

export async function withGithubRestConcurrencyLimit<T>(fn: () => Promise<T>) {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function logGithubRestLimiterSnapshot(extra?: Record<string, unknown>) {
  // Best-effort: never block main flow.
  await logEvent('github_rest_limiter', {
    inFlight,
    maxConcurrency,
    queue: waiters.length,
    ...(extra ?? {}),
  }).catch(() => undefined);
}

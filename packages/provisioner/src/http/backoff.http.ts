import type { RandomSource, RetryPolicy, Sleep } from './http.types';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 5,
  baseDelayMs: 500,
  factor: 2,
  maxDelayMs: 8_000,
  jitter: 0.2,
};

export const MAX_RETRY_AFTER_MS = 60_000;

export function computeDelay(
  retry: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: RandomSource = Math.random,
): number {
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * policy.factor ** (retry - 1),
  );
  const spread = 1 + policy.jitter * (2 * random() - 1);
  return Math.min(policy.maxDelayMs, Math.round(exponential * spread));
}

export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return undefined;
  }
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

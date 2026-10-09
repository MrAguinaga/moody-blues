import { abortableSleep, computeDelay, DEFAULT_RETRY_POLICY } from './backoff.http';
import {
  HttpAbortError,
  isTransientError,
  PollTimeoutError,
  ProvisionHttpError,
  ServiceNotReadyError,
} from './http.errors';
import type { HttpClient, RandomSource, RetryPolicy, Sleep } from './http.types';

export const DEFAULT_READY_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 10_000;

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number | ((attempt: number) => number);
  signal?: AbortSignal;
  sleep?: Sleep;
  now?: () => number;
}

export interface WaitUntilReadyOptions {
  service: string;
  readyPath: string;
  verify?: () => Promise<unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: Sleep;
  now?: () => number;
  random?: RandomSource;
  backoff?: Partial<RetryPolicy>;
}

export async function pollUntil<T>(
  fn: () => Promise<T | undefined>,
  options: PollOptions,
): Promise<T> {
  const { timeoutMs, intervalMs, signal } = options;
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let lastError: unknown;

  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const value = await fn();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      if (signal?.aborted || !isTransientError(error)) {
        throw error;
      }
      lastError = error;
    }

    const waitedMs = now() - startedAt;
    if (waitedMs >= timeoutMs) {
      throw new PollTimeoutError(waitedMs, lastError);
    }
    const interval = typeof intervalMs === 'function' ? intervalMs(attempt) : intervalMs;
    await sleep(Math.min(interval, timeoutMs - waitedMs), signal);
  }
}

export async function waitUntilReady(
  client: HttpClient,
  options: WaitUntilReadyOptions,
): Promise<void> {
  const { service, readyPath, verify, signal } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.backoff };
  const startedAt = now();

  try {
    await pollUntil(
      async () => {
        await client.get(readyPath, {
          signal,
          timeoutMs: PROBE_TIMEOUT_MS,
          retry: { attempts: 1 },
        });
        await verify?.();
        return true;
      },
      {
        timeoutMs,
        signal,
        sleep: options.sleep,
        now,
        intervalMs: (attempt) => computeDelay(attempt, policy, options.random),
      },
    );
  } catch (error) {
    if (error instanceof PollTimeoutError) {
      const lastError = error.lastError instanceof ProvisionHttpError ? error.lastError : undefined;
      throw new ServiceNotReadyError(
        service,
        now() - startedAt,
        lastError,
        'GET',
        lastError?.url ?? readyPath,
      );
    }
    if (signal?.aborted && !(error instanceof HttpAbortError)) {
      throw new HttpAbortError('GET', readyPath, error);
    }
    throw error;
  }
}

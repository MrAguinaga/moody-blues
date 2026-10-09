import { describe, expect, it, vi } from 'vitest';

import { createFakeFetch } from '../testing/fake-fetch';
import { createHttpClient } from './http.client';
import {
  HttpAbortError,
  HttpStatusError,
  PollTimeoutError,
  ServiceNotReadyError,
} from './http.errors';
import type { Sleep } from './http.types';
import { pollUntil, waitUntilReady } from './ready.http';

function fakeClock() {
  let elapsed = 0;
  const sleep = vi.fn<Sleep>(async (ms) => {
    elapsed += ms;
  });
  return { sleep, now: () => elapsed };
}

function setup() {
  const fake = createFakeFetch();
  const clock = fakeClock();
  const client = createHttpClient({
    baseUrl: 'http://127.0.0.1:7878',
    fetch: fake.fetch,
    sleep: clock.sleep,
    random: () => 0.5,
  });
  return { fake, clock, client };
}

describe('pollUntil', () => {
  it('returns the first defined value', async () => {
    const { sleep, now } = fakeClock();
    const values = [undefined, undefined, 'ready'];
    const fn = vi.fn(async () => values.shift());

    const result = await pollUntil(fn, { timeoutMs: 10_000, intervalMs: 100, sleep, now });

    expect(result).toBe('ready');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 100]);
  });

  it('accepts an interval function based on the attempt number', async () => {
    const { sleep, now } = fakeClock();
    const values = [undefined, undefined, 1];

    await pollUntil(async () => values.shift(), {
      timeoutMs: 10_000,
      intervalMs: (attempt) => attempt * 10,
      sleep,
      now,
    });

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
  });

  it('throws a timeout error carrying the last transient failure', async () => {
    const { sleep, now } = fakeClock();
    const failure = new HttpStatusError('GET', 'http://x/y', 503, '');

    const error = await pollUntil(
      async () => {
        throw failure;
      },
      { timeoutMs: 1000, intervalMs: 400, sleep, now },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PollTimeoutError);
    expect(error).toMatchObject({ lastError: failure, waitedMs: 1000 });
  });

  it('never sleeps beyond the remaining time', async () => {
    const { sleep, now } = fakeClock();

    await pollUntil(async () => undefined, { timeoutMs: 250, intervalMs: 200, sleep, now }).catch(
      () => undefined,
    );

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 50]);
  });

  it('rethrows definitive failures immediately', async () => {
    const { sleep, now } = fakeClock();
    const fn = vi.fn(async () => {
      throw new HttpStatusError('GET', 'http://x/y', 401, '');
    });

    await expect(
      pollUntil(fn, { timeoutMs: 1000, intervalMs: 10, sleep, now }),
    ).rejects.toMatchObject({
      status: 401,
    });

    expect(fn).toHaveBeenCalledOnce();
  });

  it('stops when the signal is aborted', async () => {
    const { sleep, now } = fakeClock();
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      return undefined;
    });

    await expect(
      pollUntil(fn, { timeoutMs: 1000, intervalMs: 10, sleep, now, signal: controller.signal }),
    ).rejects.toBeDefined();

    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('waitUntilReady', () => {
  it('polls the ready path with backoff until it answers 200, then verifies', async () => {
    const { fake, clock, client } = setup();
    fake.on('GET', '/ping', new Error('fetch failed'), { status: 503 }, { body: { status: 'OK' } });
    const verify = vi.fn(async () => undefined);

    await waitUntilReady(client, {
      service: 'Radarr',
      readyPath: '/ping',
      verify,
      sleep: clock.sleep,
      now: clock.now,
      random: () => 0.5,
    });

    expect(fake.count('GET', '/ping')).toBe(3);
    expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
    expect(verify).toHaveBeenCalledOnce();
  });

  it('keeps polling while verification fails transiently', async () => {
    const { fake, clock, client } = setup();
    fake.on('GET', '/ping', { body: { status: 'OK' } });
    const outcomes = [new HttpStatusError('GET', 'http://x/status', 503, ''), undefined];
    const verify = vi.fn(async () => {
      const next = outcomes.shift();
      if (next) throw next;
    });

    await waitUntilReady(client, {
      service: 'Radarr',
      readyPath: '/ping',
      verify,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('fails right away when the api key is rejected', async () => {
    const { fake, clock, client } = setup();
    fake.on('GET', '/ping', { body: { status: 'OK' } });
    const verify = vi.fn(async () => {
      throw new HttpStatusError('GET', 'http://x/status', 401, '');
    });

    await expect(
      waitUntilReady(client, {
        service: 'Radarr',
        readyPath: '/ping',
        verify,
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('throws ServiceNotReadyError with the last error when time runs out', async () => {
    const { fake, clock, client } = setup();
    fake.on('GET', '/ping', { status: 503 });

    const error = await waitUntilReady(client, {
      service: 'Radarr',
      readyPath: '/ping',
      timeoutMs: 5000,
      sleep: clock.sleep,
      now: clock.now,
      random: () => 0.5,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceNotReadyError);
    expect(error).toMatchObject({ service: 'Radarr', waitedMs: 5000 });
    expect((error as ServiceNotReadyError).lastError).toBeInstanceOf(HttpStatusError);
    expect((error as ServiceNotReadyError).message).toContain('Radarr was not ready');
  });

  it('defaults to a 120 second budget', async () => {
    const { fake, clock, client } = setup();
    fake.on('GET', '/ping', { status: 503 });

    const error = (await waitUntilReady(client, {
      service: 'Radarr',
      readyPath: '/ping',
      sleep: clock.sleep,
      now: clock.now,
    }).catch((caught: unknown) => caught)) as ServiceNotReadyError;

    expect(error.waitedMs).toBe(120_000);
  });

  it('turns a cancellation during the wait into an abort error', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/ping', { status: 503 });
    const controller = new AbortController();
    const sleep = vi.fn<Sleep>(async (_ms, signal) => {
      controller.abort();
      signal?.throwIfAborted();
    });

    await expect(
      waitUntilReady(client, {
        service: 'Radarr',
        readyPath: '/ping',
        signal: controller.signal,
        sleep,
      }),
    ).rejects.toBeInstanceOf(HttpAbortError);
  });
});

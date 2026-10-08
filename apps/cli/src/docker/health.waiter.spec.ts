import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceHealth, ServiceState, StackStatus } from './compose.types';
import { buildStackStatus } from './compose-ps.parser';
import { HealthWaitError, waitForHealthy } from './health.waiter';

type Snapshot = Record<string, [ServiceState, ServiceHealth]>;

function stack(snapshot: Snapshot): StackStatus {
  return buildStackStatus(
    'moody-blues',
    Object.entries(snapshot).map(([service, [state, health]]) => ({
      service,
      state,
      health,
      exitCode: state === 'exited' ? 1 : 0,
      publishedPorts: [],
    })),
  );
}

function fakeRunner(snapshots: Snapshot[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    ps: vi.fn(async () => {
      const snapshot = snapshots[Math.min(calls, snapshots.length - 1)]!;
      calls += 1;
      return stack(snapshot);
    }),
  };
}

const options = { timeoutMs: 30_000, intervalMs: 1000 };
const starting: Snapshot = { caddy: ['running', 'healthy'], sonarr: ['running', 'starting'] };
const ready: Snapshot = { caddy: ['running', 'healthy'], sonarr: ['running', 'healthy'] };

describe('waitForHealthy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves as soon as every service is healthy and reports each poll', async () => {
    const runner = fakeRunner([starting, starting, ready]);
    const onUpdate = vi.fn();

    const result = waitForHealthy(runner, { ...options, onUpdate });
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toMatchObject({ allHealthy: true });
    expect(runner.calls).toBe(3);
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it('resolves immediately when the stack is already healthy', async () => {
    const runner = fakeRunner([ready]);

    await expect(waitForHealthy(runner, options)).resolves.toMatchObject({ allHealthy: true });
    expect(runner.calls).toBe(1);
  });

  it('rejects with the pending services when the timeout expires', async () => {
    const runner = fakeRunner([starting]);

    const result = waitForHealthy(runner, { ...options, timeoutMs: 5000 });
    const assertion = expect(result).rejects.toMatchObject({
      name: 'HealthWaitError',
      reason: 'timeout',
      failedServices: ['sonarr'],
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(runner.calls).toBe(6);
  });

  it('rejects when a service exits', async () => {
    const runner = fakeRunner([starting, { ...starting, sonarr: ['exited', 'none'] }]);

    const result = waitForHealthy(runner, options);
    const assertion = expect(result).rejects.toMatchObject({
      reason: 'exited',
      failedServices: ['sonarr'],
    });
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
  });

  it('tolerates a single unhealthy poll', async () => {
    const runner = fakeRunner([{ ...starting, sonarr: ['running', 'unhealthy'] }, starting, ready]);

    const result = waitForHealthy(runner, options);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toMatchObject({ allHealthy: true });
  });

  it('rejects when a service stays unhealthy across two consecutive polls', async () => {
    const unhealthy: Snapshot = { ...starting, sonarr: ['running', 'unhealthy'] };
    const runner = fakeRunner([unhealthy]);

    const result = waitForHealthy(runner, options);
    const assertion = expect(result).rejects.toMatchObject({
      reason: 'unhealthy',
      failedServices: ['sonarr'],
    });
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    expect(runner.calls).toBe(2);
  });

  it('does not accumulate unhealthy polls that are not consecutive', async () => {
    const unhealthy: Snapshot = { ...starting, sonarr: ['running', 'unhealthy'] };
    const runner = fakeRunner([unhealthy, starting, unhealthy, starting, ready]);

    const result = waitForHealthy(runner, options);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(result).resolves.toMatchObject({ allHealthy: true });
  });

  it('rejects with the last known status when aborted while waiting', async () => {
    const runner = fakeRunner([starting]);
    const controller = new AbortController();

    const result = waitForHealthy(runner, { ...options, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ reason: 'aborted' });
    await vi.advanceTimersByTimeAsync(1500);
    controller.abort();

    await assertion;
    await expect(result).rejects.toBeInstanceOf(HealthWaitError);
    expect(runner.calls).toBe(2);
  });

  it('rejects without polling when already aborted', async () => {
    const runner = fakeRunner([ready]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForHealthy(runner, { ...options, signal: controller.signal }),
    ).rejects.toMatchObject({ reason: 'aborted' });
    expect(runner.calls).toBe(0);
  });

  it('propagates runner failures', async () => {
    const runner = { ps: vi.fn().mockRejectedValue(new Error('docker is down')) };

    await expect(waitForHealthy(runner, options)).rejects.toThrow('docker is down');
  });
});

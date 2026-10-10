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

  describe('with an optional service', () => {
    const base: Snapshot = { caddy: ['running', 'healthy'], flaresolverr: ['running', 'healthy'] };
    const broken: Snapshot = { ...base, flaresolverr: ['running', 'unhealthy'] };
    const optionalOptions = { ...options, optionalServices: ['flaresolverr'] };

    function runnerWithRestart(snapshots: Snapshot[]) {
      return { ...fakeRunner(snapshots), restart: vi.fn(async () => undefined) };
    }

    it('restarts an unhealthy optional service once it is confirmed and waits for it', async () => {
      const runner = runnerWithRestart([
        broken,
        broken,
        { ...base, flaresolverr: ['running', 'starting'] },
        base,
      ]);
      const onNotice = vi.fn();

      const result = waitForHealthy(runner, { ...optionalOptions, onNotice });
      await vi.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({ allHealthy: true });
      expect(runner.restart).toHaveBeenCalledExactlyOnceWith(['flaresolverr'], {
        signal: undefined,
      });
      expect(onNotice).toHaveBeenCalledExactlyOnceWith(
        'Restarted flaresolverr because it was unhealthy',
      );
    });

    it('does not restart an optional service that recovers by itself', async () => {
      const runner = runnerWithRestart([broken, base]);

      const result = waitForHealthy(runner, optionalOptions);
      await vi.advanceTimersByTimeAsync(2000);

      await expect(result).resolves.toMatchObject({ allHealthy: true });
      expect(runner.restart).not.toHaveBeenCalled();
    });

    it('settles without failing when the optional service stays unhealthy after the restart', async () => {
      const runner = runnerWithRestart([broken]);
      const onNotice = vi.fn();

      const result = waitForHealthy(runner, { ...optionalOptions, onNotice });
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toMatchObject({ allHealthy: false });
      expect(runner.restart).toHaveBeenCalledTimes(1);
      expect(onNotice).toHaveBeenLastCalledWith(
        'flaresolverr is still unhealthy; continuing without it',
      );
    });

    it('restarts an optional service that exited', async () => {
      const exited: Snapshot = { ...base, flaresolverr: ['exited', 'none'] };
      const runner = runnerWithRestart([exited, exited, base]);
      const onNotice = vi.fn();

      const result = waitForHealthy(runner, { ...optionalOptions, onNotice });
      await vi.advanceTimersByTimeAsync(3000);

      await expect(result).resolves.toMatchObject({ allHealthy: true });
      expect(onNotice).toHaveBeenCalledWith('Restarted flaresolverr because it was stopped');
    });

    it('stops waiting for an optional service that never settles once the grace period ends', async () => {
      const starting: Snapshot = { ...base, flaresolverr: ['running', 'starting'] };
      const runner = runnerWithRestart([starting]);
      const onNotice = vi.fn();

      const result = waitForHealthy(runner, {
        ...optionalOptions,
        optionalGraceMs: 5000,
        onNotice,
      });
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toMatchObject({ allHealthy: false });
      expect(runner.restart).not.toHaveBeenCalled();
      expect(onNotice).toHaveBeenCalledWith('flaresolverr not healthy yet; continuing without it');
    });

    it('abandons the optional service when the restart itself fails', async () => {
      const runner = {
        ...fakeRunner([broken]),
        restart: vi.fn().mockRejectedValue(new Error('docker restart failed')),
      };
      const onNotice = vi.fn();

      const result = waitForHealthy(runner, { ...optionalOptions, onNotice });
      await vi.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({ allHealthy: false });
      expect(onNotice).toHaveBeenCalledWith(
        'Could not restart flaresolverr: docker restart failed',
      );
    });

    it('abandons the optional service without a restart function', async () => {
      const runner = fakeRunner([broken]);

      const result = waitForHealthy(runner, optionalOptions);
      await vi.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({ allHealthy: false });
    });

    it('still fails when a required service is unhealthy', async () => {
      const runner = runnerWithRestart([{ ...base, caddy: ['running', 'unhealthy'] }]);

      const result = waitForHealthy(runner, optionalOptions);
      const assertion = expect(result).rejects.toMatchObject({
        reason: 'unhealthy',
        failedServices: ['caddy'],
      });
      await vi.advanceTimersByTimeAsync(1000);

      await assertion;
    });

    it('does not time out because of the optional service once the required ones are healthy', async () => {
      const starting: Snapshot = { ...base, flaresolverr: ['running', 'starting'] };
      const runner = runnerWithRestart([starting]);

      const result = waitForHealthy(runner, { ...optionalOptions, timeoutMs: 3000 });
      await vi.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({ allHealthy: false });
    });
  });
});

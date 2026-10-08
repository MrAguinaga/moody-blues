import { describe, expect, it, vi } from 'vitest';

import { createComposeRuntime } from './compose.runtime';
import type { ComposeRunner, ServiceHealth, ServiceState } from './compose.types';
import { buildStackStatus } from './compose-ps.parser';

type Snapshot = Record<string, [ServiceState, ServiceHealth]>;

function stack(snapshot: Snapshot) {
  return buildStackStatus(
    'moody-blues',
    Object.entries(snapshot).map(([service, [state, health]]) => ({
      service,
      state,
      health,
      exitCode: 0,
      publishedPorts: [],
    })),
  );
}

function fakeRunner(overrides: Partial<ComposeRunner> = {}): ComposeRunner {
  return {
    files: [],
    up: vi.fn(async () => undefined),
    down: vi.fn(async () => undefined),
    ps: vi.fn(async () => stack({ caddy: ['running', 'healthy'] })),
    listServices: vi.fn(async () => ['caddy']),
    pull: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    reloadGateway: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createComposeRuntime', () => {
  it('creates the runner lazily and reuses it', async () => {
    const runner = fakeRunner();
    const createRunner = vi.fn(() => runner);
    const runtime = createComposeRuntime({ home: '/opt/mb', createRunner });
    const { signal } = new AbortController();

    expect(createRunner).not.toHaveBeenCalled();
    await runtime.up({ signal });
    await runtime.reloadGateway({ signal });

    expect(createRunner).toHaveBeenCalledExactlyOnceWith('/opt/mb');
    expect(runner.up).toHaveBeenCalledOnce();
    expect(runner.reloadGateway).toHaveBeenCalledOnce();
  });

  it('reports health progress only when it changes', async () => {
    const snapshots: Snapshot[] = [
      { caddy: ['running', 'healthy'], sonarr: ['running', 'starting'] },
      { caddy: ['running', 'healthy'], sonarr: ['running', 'starting'] },
      { caddy: ['running', 'healthy'], sonarr: ['running', 'healthy'] },
    ];
    let polls = 0;
    const runner = fakeRunner({
      ps: vi.fn(async () => stack(snapshots[Math.min(polls++, snapshots.length - 1)]!)),
    });
    const runtime = createComposeRuntime({
      home: '/opt/mb',
      createRunner: () => runner,
      pollIntervalMs: 1,
    });
    const onProgress = vi.fn();

    await runtime.waitHealthy({ signal: new AbortController().signal, onProgress });

    expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
      '1 of 2 services healthy, waiting for sonarr',
      '2 of 2 services healthy',
    ]);
  });

  it('fails the health wait when a service never becomes healthy', async () => {
    const runner = fakeRunner({
      ps: vi.fn(async () => stack({ sonarr: ['running', 'starting'] })),
    });
    const runtime = createComposeRuntime({
      home: '/opt/mb',
      createRunner: () => runner,
      healthTimeoutMs: 20,
      pollIntervalMs: 5,
    });

    await expect(runtime.waitHealthy({ signal: new AbortController().signal })).rejects.toThrow(
      /Timed out .* waiting for: sonarr/,
    );
  });

  it('turns an elapsed up timeout into a descriptive error', async () => {
    const runner = fakeRunner({
      up: vi.fn(
        ({ signal } = {}) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason));
          }),
      ),
    });
    const runtime = createComposeRuntime({
      home: '/opt/mb',
      createRunner: () => runner,
      upTimeoutMs: 10,
    });

    await expect(runtime.up({ signal: new AbortController().signal })).rejects.toThrow(
      'docker compose up did not finish within 0 seconds',
    );
  });

  it('propagates a user abort of up unchanged', async () => {
    const controller = new AbortController();
    const reason = new Error('user abort');
    const runner = fakeRunner({
      up: vi.fn(
        ({ signal } = {}) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason));
          }),
      ),
    });
    const runtime = createComposeRuntime({ home: '/opt/mb', createRunner: () => runner });

    const pending = runtime.up({ signal: controller.signal });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});

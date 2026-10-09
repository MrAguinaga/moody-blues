import { describe, expect, it, vi } from 'vitest';

import { TUNNEL_SERVICES } from './tunnel.constants';
import {
  describeSshExit,
  runTunnel,
  type SshExit,
  type SshHandle,
  type TunnelDeps,
} from './tunnel.service';
import type { TunnelReport } from './tunnel.types';

const TARGET = 'ubuntu@203.0.113.10';
const ALL_PORTS = TUNNEL_SERVICES.map(({ port }) => port);

function fakeSsh() {
  let finish: (exit: SshExit) => void = () => undefined;
  const exited = new Promise<SshExit>((resolve) => {
    finish = resolve;
  });
  const handle: SshHandle = {
    exited,
    kill: vi.fn((signal: NodeJS.Signals) => finish({ code: null, signal })),
  };
  return { handle, finish };
}

function harness(overrides: Partial<TunnelDeps> = {}) {
  const ssh = fakeSsh();
  const deps: TunnelDeps = {
    isSshAvailable: async () => true,
    isPortFree: async () => true,
    probePort: async () => true,
    spawnSsh: vi.fn(() => ssh.handle),
    fetch: vi.fn(async () => new Response('', { status: 200 })),
    ...overrides,
  };
  const controller = new AbortController();
  const reports: TunnelReport[] = [];
  const events: string[] = [];
  const run = () =>
    runTunnel({
      target: TARGET,
      signal: controller.signal,
      onConnecting: () => events.push('connecting'),
      onReady: (report) => reports.push(report),
      probeIntervalMs: 1,
      deps,
    });
  return { ssh, deps, controller, reports, events, run };
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

describe('runTunnel', () => {
  it('fails without launching ssh when the executable is missing', async () => {
    const { deps, run } = harness({ isSshAvailable: async () => false });

    await expect(run()).rejects.toThrow('The ssh executable was not found in PATH.');
    expect(deps.spawnSsh).not.toHaveBeenCalled();
  });

  it('lists every busy local port and does not launch ssh', async () => {
    const { deps, events, run } = harness({
      isPortFree: async (port) => ![8989, 7878].includes(port),
    });

    await expect(run()).rejects.toThrow(
      'Local port(s) already in use: 8989 (sonarr), 7878 (radarr). Stop the process that holds them (an earlier tunnel or a local Moody Blues stack) and try again.',
    );
    expect(deps.spawnSsh).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('launches ssh with the planned arguments', async () => {
    const { deps, controller, reports, events, run } = harness();

    const finished = run();
    await until(() => reports.length === 1);
    controller.abort();
    await finished;

    expect(events).toEqual(['connecting']);
    const [args] = vi.mocked(deps.spawnSsh).mock.calls[0] ?? [];
    expect(args?.at(-2)).toBe('--');
    expect(args?.at(-1)).toBe(TARGET);
  });

  it('waits until the five local ports accept connections before reporting', async () => {
    let polls = 0;
    const { controller, reports, run } = harness({
      probePort: async (port) => {
        if (port === 8282) {
          polls += 1;
          return polls > 3;
        }
        return true;
      },
    });

    const finished = run();
    await until(() => reports.length === 1);

    expect(polls).toBe(4);
    controller.abort();
    await finished;
  });

  it('reports every forward as reachable when any HTTP response arrives', async () => {
    const { controller, reports, run } = harness({
      fetch: vi.fn(async () => new Response('', { status: 302 })),
    });

    const finished = run();
    await until(() => reports.length === 1);
    controller.abort();
    await finished;

    expect(reports).toHaveLength(1);
    expect(reports[0]?.target).toBe(TARGET);
    expect(reports[0]?.forwards.map((forward) => forward.localPort)).toEqual(ALL_PORTS);
    expect(reports[0]?.forwards.every((forward) => forward.reachable)).toBe(true);
  });

  it('marks a service that does not answer without closing the tunnel', async () => {
    const { ssh, controller, reports, run } = harness({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes(':6767/')) {
          throw new TypeError('fetch failed');
        }
        return new Response('', { status: 200 });
      }),
    });

    const finished = run();
    await until(() => reports.length === 1);

    const status = Object.fromEntries(
      (reports[0]?.forwards ?? []).map((forward) => [forward.service, forward.reachable]),
    );
    expect(status).toEqual({
      sonarr: true,
      radarr: true,
      prowlarr: true,
      bazarr: false,
      decypharr: true,
    });
    expect(ssh.handle.kill).not.toHaveBeenCalled();
    controller.abort();
    await finished;
  });

  it('terminates ssh with SIGTERM and resolves when the signal arrives', async () => {
    const { ssh, controller, reports, run } = harness();

    const finished = run();
    await until(() => reports.length === 1);
    controller.abort();

    await expect(finished).resolves.toBeUndefined();
    expect(ssh.handle.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('closes ssh when the signal arrives before the tunnel is ready', async () => {
    const probePort = vi.fn(async () => false);
    const { ssh, controller, reports, run } = harness({ probePort });

    const finished = run();
    await until(() => probePort.mock.calls.length >= 10);
    expect(ssh.handle.kill).not.toHaveBeenCalled();
    controller.abort();

    await expect(finished).resolves.toBeUndefined();
    expect(ssh.handle.kill).toHaveBeenCalledWith('SIGTERM');
    expect(reports).toHaveLength(0);
  });

  it('fails without reporting URLs when ssh ends with 255 before the tunnel is ready', async () => {
    const { ssh, reports, run } = harness({ probePort: async () => false });

    const finished = run();
    ssh.finish({ code: 255, signal: null });

    await expect(finished).rejects.toThrow('The SSH connection ended (exit code 255).');
    expect(reports).toHaveLength(0);
  });

  it('fails when ssh dies while the tunnel is open', async () => {
    const { ssh, reports, run } = harness();

    const finished = run();
    await until(() => reports.length === 1);
    ssh.finish({ code: 255, signal: null });

    await expect(finished).rejects.toThrow(/The SSH connection ended \(exit code 255\)\. Check/);
  });

  it('does not treat the exit of ssh as a failure when the interrupt reached it first', async () => {
    const { ssh, controller, reports, run } = harness();

    const finished = run();
    await until(() => reports.length === 1);
    ssh.finish({ code: 255, signal: null });
    controller.abort();

    await expect(finished).resolves.toBeUndefined();
  });
});

describe('describeSshExit', () => {
  it('hints at the connection or the credentials for 255', () => {
    expect(describeSshExit({ code: 255, signal: null })).toBe(
      'The SSH connection ended (exit code 255). Check the host, your credentials and the network connection.',
    );
  });

  it('hints at a rejected forward for any other code', () => {
    expect(describeSshExit({ code: 1, signal: null })).toBe(
      'The SSH connection ended (exit code 1). A port forward was rejected: check that the local ports are free.',
    );
  });

  it('reports a signal as the shell exit code', () => {
    expect(describeSshExit({ code: null, signal: 'SIGTERM' })).toBe(
      'The SSH connection ended (exit code 143). The ssh process was stopped by SIGTERM.',
    );
  });
});

import { spawn } from 'node:child_process';
import { access, constants as fsConstants } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { constants as osConstants } from 'node:os';
import { delimiter, join } from 'node:path';

import { delay } from '../utils/async.utils';
import {
  HTTP_PROBE_TIMEOUT_MS,
  LOOPBACK_HOST,
  PORT_CONNECT_TIMEOUT_MS,
  PROBE_INTERVAL_MS,
  SSH_EXIT_GRACE_MS,
} from './tunnel.constants';
import { buildTunnelPlan } from './tunnel.plan';
import type { TunnelForward, TunnelForwardStatus, TunnelReport } from './tunnel.types';

const SSH_CONNECTION_FAILURE_CODE = 255;

export interface SshExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SshHandle {
  exited: Promise<SshExit>;
  kill(signal: NodeJS.Signals): void;
}

export interface TunnelDeps {
  isSshAvailable(): Promise<boolean>;
  isPortFree(port: number): Promise<boolean>;
  probePort(port: number): Promise<boolean>;
  spawnSsh(args: string[]): SshHandle;
  fetch: typeof fetch;
}

export interface RunTunnelOptions {
  target: string;
  signal: AbortSignal;
  onConnecting?: () => void;
  onReady: (report: TunnelReport) => void;
  probeIntervalMs?: number;
  deps?: Partial<TunnelDeps>;
}

export class TunnelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TunnelError';
  }
}

async function isSshAvailable(): Promise<boolean> {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of directories) {
    try {
      await access(join(directory, 'ssh'), fsConstants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: LOOPBACK_HOST, port }, () => server.close(() => resolve(true)));
  });
}

export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: LOOPBACK_HOST, port });
    const settle = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PORT_CONNECT_TIMEOUT_MS);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

function spawnSsh(args: string[]): SshHandle {
  const child = spawn('ssh', args, { stdio: ['inherit', 'ignore', 'inherit'] });
  const exited = new Promise<SshExit>((resolve) => {
    child.once('error', () => resolve({ code: null, signal: null }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { exited, kill: (signal) => child.kill(signal) };
}

const DEFAULT_DEPS: TunnelDeps = {
  isSshAvailable,
  isPortFree,
  probePort,
  spawnSsh,
  fetch: (input, init) => fetch(input, init),
};

function exitCodeOf({ code, signal }: SshExit): number | undefined {
  if (code !== null) {
    return code;
  }
  const signalNumber = signal ? osConstants.signals[signal] : undefined;
  return signalNumber === undefined ? undefined : 128 + signalNumber;
}

export function describeSshExit(exit: SshExit): string {
  const code = exitCodeOf(exit);
  const ended = `The SSH connection ended${code === undefined ? '' : ` (exit code ${code})`}.`;
  if (exit.code === SSH_CONNECTION_FAILURE_CODE) {
    return `${ended} Check the host, your credentials and the network connection.`;
  }
  if (exit.code === null) {
    return `${ended} The ssh process was stopped${exit.signal ? ` by ${exit.signal}` : ''}.`;
  }
  return `${ended} A port forward was rejected: check that the local ports are free.`;
}

async function findBusyPorts(
  forwards: readonly TunnelForward[],
  isFree: TunnelDeps['isPortFree'],
): Promise<TunnelForward[]> {
  const free = await Promise.all(forwards.map(({ localPort }) => isFree(localPort)));
  return forwards.filter((_forward, index) => !free[index]);
}

async function checkReachable(
  forward: TunnelForward,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<TunnelForwardStatus> {
  try {
    const response = await fetcher(`http://${LOOPBACK_HOST}:${forward.localPort}/`, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS)]),
    });
    await response.body?.cancel();
    return { ...forward, reachable: true };
  } catch {
    return { ...forward, reachable: false };
  }
}

export async function runTunnel(options: RunTunnelOptions): Promise<void> {
  const { target, signal, onConnecting, onReady, probeIntervalMs = PROBE_INTERVAL_MS } = options;
  const deps: TunnelDeps = { ...DEFAULT_DEPS, ...options.deps };
  const plan = buildTunnelPlan(target);

  if (!(await deps.isSshAvailable())) {
    throw new TunnelError('The ssh executable was not found in PATH.');
  }

  const busy = await findBusyPorts(plan.forwards, deps.isPortFree);
  if (busy.length > 0) {
    const ports = busy.map(({ localPort, service }) => `${localPort} (${service})`).join(', ');
    throw new TunnelError(
      `Local port(s) already in use: ${ports}. Stop the process that holds them (an earlier tunnel or a local Moody Blues stack) and try again.`,
    );
  }

  onConnecting?.();
  const ssh = deps.spawnSsh(plan.sshArgs);
  const state: { exit?: SshExit } = {};
  void ssh.exited.then((result) => {
    state.exit = result;
  });
  const close = () => ssh.kill('SIGTERM');
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) {
    close();
  }

  try {
    const allOpen = async (): Promise<boolean> => {
      const open = await Promise.all(plan.forwards.map((f) => deps.probePort(f.localPort)));
      return open.every(Boolean);
    };
    while (!state.exit && !signal.aborted && !(await allOpen())) {
      await Promise.race([delay(probeIntervalMs, signal), ssh.exited]);
    }

    if (!state.exit && !signal.aborted) {
      const forwards = await Promise.all(
        plan.forwards.map((forward) => checkReachable(forward, deps.fetch, signal)),
      );
      if (!state.exit && !signal.aborted) {
        onReady({ target: plan.target, forwards });
      }
    }

    const ended = await ssh.exited;
    if (!signal.aborted) {
      await delay(SSH_EXIT_GRACE_MS, signal);
    }
    if (!signal.aborted) {
      throw new TunnelError(describeSshExit(ended));
    }
  } finally {
    signal.removeEventListener('abort', close);
  }
}

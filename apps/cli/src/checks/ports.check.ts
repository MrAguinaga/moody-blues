import net from 'node:net';

import { COMPOSE_PROJECT_NAME } from '../docker';
import { type ExecResult, runCommand } from '../utils/system.utils';
import type { CheckDefinition, CheckResult } from './checks.types';

const DEFINITION = {
  id: 'ports-availability',
  name: 'Port Availability (80 & 443)',
  description:
    'Checks that HTTP (80) and HTTPS (443) ports are available for the reverse proxy gateway',
} as const;

const PORT_LABELS: Readonly<Record<number, string>> = { 80: 'HTTP', 443: 'HTTPS' };

export interface PortsCheckDeps {
  isOccupied?: (port: number) => Promise<boolean>;
  exec?: (file: string, args: string[]) => Promise<ExecResult>;
}

function isPortOccupied(port: number, host = '127.0.0.1', timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = (occupied: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(occupied);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => cleanup(true));
    socket.on('timeout', () => cleanup(false));
    socket.on('error', () => cleanup(false));

    try {
      socket.connect(port, host);
    } catch {
      cleanup(false);
    }
  });
}

const describePort = (port: number): string => `${port} (${PORT_LABELS[port]})`;

export function createPortsCheck(deps: PortsCheckDeps = {}): CheckDefinition {
  const isOccupied = deps.isOccupied ?? ((port: number) => isPortOccupied(port));
  const exec = deps.exec ?? runCommand;

  async function heldByStack(port: number): Promise<boolean> {
    const result = await exec('docker', [
      'ps',
      '--filter',
      `label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}`,
      '--filter',
      `publish=${port}`,
      '--format',
      '{{.Names}}',
    ]);
    return result.exitCode === 0 && result.stdout.trim() !== '';
  }

  return {
    ...DEFINITION,
    run: async (): Promise<CheckResult> => {
      const occupied = (
        await Promise.all([80, 443].map(async (port) => ((await isOccupied(port)) ? port : 0)))
      ).filter((port) => port !== 0);

      if (occupied.length === 0) {
        return {
          ...DEFINITION,
          status: 'success',
          message: 'Ports 80 (HTTP) and 443 (HTTPS) are available',
        };
      }

      const foreign: number[] = [];
      for (const port of occupied) {
        if (!(await heldByStack(port))) {
          foreign.push(port);
        }
      }

      if (foreign.length === 0) {
        return {
          ...DEFINITION,
          status: 'success',
          message:
            occupied.length === 2
              ? 'Ports 80 (HTTP) and 443 (HTTPS) are held by the Moody Blues gateway'
              : `Port ${describePort(occupied[0] as number)} is held by the Moody Blues gateway`,
        };
      }

      return {
        ...DEFINITION,
        status: 'warning',
        message: `Occupied port(s) detected: ${foreign.join(', ')}`,
        suggestion:
          'The Caddy gateway requires ports 80 and 443. If another service (such as Apache, Nginx, or systemd-resolved) is using them, stop or reassign it before starting Moody Blues.',
      };
    },
  };
}

export const portsCheck: CheckDefinition = createPortsCheck();

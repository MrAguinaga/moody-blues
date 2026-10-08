import net from 'node:net';

import type { CheckDefinition, CheckResult } from './checks.types';

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

export const portsCheck: CheckDefinition = {
  id: 'ports-availability',
  name: 'Port Availability (80 & 443)',
  description:
    'Checks that HTTP (80) and HTTPS (443) ports are available for the reverse proxy gateway',
  run: async (): Promise<CheckResult> => {
    const [p80InUse, p443InUse] = await Promise.all([isPortOccupied(80), isPortOccupied(443)]);

    const occupied: number[] = [];

    if (p80InUse) occupied.push(80);
    if (p443InUse) occupied.push(443);

    if (occupied.length > 0) {
      const portList = occupied.join(', ');
      return {
        id: 'ports-availability',
        name: 'Port Availability (80 & 443)',
        description:
          'Checks that HTTP (80) and HTTPS (443) ports are available for the reverse proxy gateway',
        status: 'warning',
        message: `Occupied port(s) detected: ${portList}`,
        suggestion:
          'The Caddy gateway requires ports 80 and 443. If another service (such as Apache, Nginx, or systemd-resolved) is using them, stop or reassign it before starting Moody Blues.',
      };
    }

    return {
      id: 'ports-availability',
      name: 'Port Availability (80 & 443)',
      description:
        'Checks that HTTP (80) and HTTPS (443) ports are available for the reverse proxy gateway',
      status: 'success',
      message: 'Ports 80 (HTTP) and 443 (HTTPS) are available',
    };
  },
};

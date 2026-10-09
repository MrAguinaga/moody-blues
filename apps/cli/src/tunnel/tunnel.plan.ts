import {
  LOOPBACK_HOST,
  MB_SSH_TARGET_ENV,
  SSH_TARGET_PATTERN,
  TUNNEL_SERVICES,
} from './tunnel.constants';
import type { TunnelForward, TunnelPlan, TunnelService } from './tunnel.types';

export function validateSshTarget(target: string): string {
  if (target.startsWith('-') || !SSH_TARGET_PATTERN.test(target)) {
    throw new Error(`Invalid SSH target "${target}".`);
  }
  return target;
}

export function resolveSshTarget(
  argument: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const target = argument || env[MB_SSH_TARGET_ENV];
  if (!target) {
    throw new Error(`Missing SSH target. Pass it as an argument or set ${MB_SSH_TARGET_ENV}.`);
  }
  return validateSshTarget(target);
}

function toForward({ id, port }: TunnelService): TunnelForward {
  return { service: id, localPort: port, remotePort: port, url: `http://localhost:${port}` };
}

export function buildTunnelPlan(
  target: string,
  services: readonly TunnelService[] = TUNNEL_SERVICES,
): TunnelPlan {
  const forwards = services.map(toForward);

  return {
    target: validateSshTarget(target),
    forwards,
    sshArgs: [
      '-N',
      '-T',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      ...forwards.flatMap(({ localPort, remotePort }) => [
        '-L',
        `${LOOPBACK_HOST}:${localPort}:${LOOPBACK_HOST}:${remotePort}`,
      ]),
      '--',
      target,
    ],
  };
}

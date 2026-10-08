import { chownSync } from 'node:fs';

import type { HostIdentity } from '../config/config.types';

export interface ResolveHostIdentityOptions {
  env?: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
}

export interface OwnershipOptions {
  identity?: HostIdentity;
  runAsRoot?: boolean;
  chown?: (path: string, uid: number, gid: number) => void;
}

function parseId(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

export function resolveHostIdentity(options: ResolveHostIdentityOptions = {}): HostIdentity {
  const env = options.env ?? process.env;
  const sudoUid = parseId(env.SUDO_UID);
  const sudoGid = parseId(env.SUDO_GID);
  if (sudoUid !== undefined && sudoGid !== undefined) {
    return { puid: sudoUid, pgid: sudoGid };
  }

  const uid = options.uid ?? process.getuid?.();
  const gid = options.gid ?? process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new Error('Unable to resolve the host user identity on this platform');
  }
  return { puid: uid, pgid: gid };
}

export function isRunningAsRoot(): boolean {
  return process.geteuid?.() === 0;
}

export function applyOwnership(path: string, options: OwnershipOptions): void {
  const runAsRoot = options.runAsRoot ?? isRunningAsRoot();
  if (!runAsRoot || !options.identity) {
    return;
  }
  const chown = options.chown ?? chownSync;
  chown(path, options.identity.puid, options.identity.pgid);
}

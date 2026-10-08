import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveMbHome } from '@moody-blues/provisioner';

import { runCommand } from '../utils/system.utils';
import type { CheckContext, CheckDefinition, CheckResult } from './checks.types';
import { findNearestExistingPath } from './path.utils';

const DEFINITION = {
  id: 'fuse',
  name: 'FUSE Support',
  description: 'Checks that /dev/fuse exists and the mount propagation is shared',
} as const;

const FUSE_DEVICE_PATH = '/dev/fuse';
const STORAGE_DISABLED_NOTE = 'The storage profile will be disabled (Decypharr will not start).';

export interface FuseProbe {
  platform: NodeJS.Platform;
  hasFuseDevice: boolean;
  propagation?: string;
}

export function parsePropagation(output: string): string[] {
  return output
    .trim()
    .split(',')
    .map((flag) => flag.trim())
    .filter(Boolean);
}

export function evaluateFuse(probe: FuseProbe): CheckResult {
  if (probe.platform === 'darwin') {
    return {
      ...DEFINITION,
      status: 'warning',
      message: `FUSE mounts are not supported on macOS. ${STORAGE_DISABLED_NOTE}`,
      suggestion: 'Deploy on a Linux host to use Real-Debrid storage.',
    };
  }

  if (probe.platform !== 'linux') {
    return {
      ...DEFINITION,
      status: 'warning',
      message: `FUSE is not supported on ${probe.platform}. ${STORAGE_DISABLED_NOTE}`,
    };
  }

  if (!probe.hasFuseDevice) {
    return {
      ...DEFINITION,
      status: 'warning',
      message: `${FUSE_DEVICE_PATH} was not found. ${STORAGE_DISABLED_NOTE}`,
      suggestion: 'Install FUSE (`sudo apt install fuse3`) and load the module (`modprobe fuse`).',
    };
  }

  const flags = parsePropagation(probe.propagation ?? '');
  if (!flags.includes('shared')) {
    return {
      ...DEFINITION,
      status: 'warning',
      message: `Mount propagation is ${probe.propagation?.trim() || 'unknown'}, not shared. ${STORAGE_DISABLED_NOTE}`,
      suggestion: 'Run `sudo mount --make-rshared /` and run the setup again.',
    };
  }

  return { ...DEFINITION, status: 'success', message: 'FUSE available with shared propagation' };
}

async function readPropagation(home: string): Promise<string | undefined> {
  const target = findNearestExistingPath(join(home, 'mnt'), existsSync);
  const result = await runCommand('findmnt', ['-no', 'PROPAGATION', '-T', target]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

export const fuseCheck: CheckDefinition = {
  ...DEFINITION,
  run: async (context: CheckContext = {}): Promise<CheckResult> => {
    const platform = process.platform;
    const hasFuseDevice = platform === 'linux' && existsSync(FUSE_DEVICE_PATH);
    const propagation = hasFuseDevice
      ? await readPropagation(context.home ?? resolveMbHome())
      : undefined;

    return evaluateFuse({ platform, hasFuseDevice, propagation });
  },
};

import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';

import { resolveMbHome } from '@moody-blues/provisioner';

import type { CheckContext, CheckDefinition, CheckResult } from './checks.types';
import { findNearestExistingPath } from './path.utils';

const DEFINITION = {
  id: 'disk-space',
  name: 'Disk Space',
  description: 'Checks the free space on the volume that holds the Moody Blues home',
} as const;

const GIB = 1024 ** 3;
export const DISK_ERROR_THRESHOLD_BYTES = 3 * GIB;
export const DISK_WARNING_THRESHOLD_BYTES = 10 * GIB;

function formatGib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

export function evaluateDiskSpace(freeBytes: number, path: string): CheckResult {
  const free = formatGib(freeBytes);

  if (freeBytes < DISK_ERROR_THRESHOLD_BYTES) {
    return {
      ...DEFINITION,
      status: 'error',
      message: `Only ${free} free on the volume of ${path}; at least ${formatGib(DISK_ERROR_THRESHOLD_BYTES)} are required.`,
      suggestion: 'Free disk space or choose another location with --home.',
    };
  }

  if (freeBytes < DISK_WARNING_THRESHOLD_BYTES) {
    return {
      ...DEFINITION,
      status: 'warning',
      message: `${free} free on the volume of ${path}; ${formatGib(DISK_WARNING_THRESHOLD_BYTES)} or more are recommended.`,
      suggestion: 'Docker images and service databases grow over time; free some space soon.',
    };
  }

  return { ...DEFINITION, status: 'success', message: `${free} free` };
}

export const diskSpaceCheck: CheckDefinition = {
  ...DEFINITION,
  run: async (context: CheckContext = {}): Promise<CheckResult> => {
    const home = context.home ?? resolveMbHome();
    const path = findNearestExistingPath(home, existsSync);

    try {
      const stats = await statfs(path);
      return evaluateDiskSpace(stats.bavail * stats.bsize, path);
    } catch (error) {
      return {
        ...DEFINITION,
        status: 'warning',
        message: `Could not read the free space of ${path}.`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

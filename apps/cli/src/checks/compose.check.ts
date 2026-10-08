import { runCommand } from '../utils/system.utils';
import type { CheckDefinition, CheckResult } from './checks.types';

const MIN_VERSION = [2, 20, 2] as const;
const MIN_VERSION_LABEL = MIN_VERSION.join('.');

const DEFINITION = {
  id: 'docker-compose',
  name: 'Docker Compose v2',
  description: `Checks availability of Docker Compose ${MIN_VERSION_LABEL} or higher`,
} as const;

function isBelowMinimum(version: readonly number[]): boolean {
  for (let i = 0; i < MIN_VERSION.length; i++) {
    const difference = (version[i] ?? 0) - MIN_VERSION[i]!;
    if (difference !== 0) {
      return difference < 0;
    }
  }
  return false;
}

export const composeCheck: CheckDefinition = {
  ...DEFINITION,
  run: async (): Promise<CheckResult> => {
    const result = await runCommand('docker', ['compose', 'version', '--short']);

    if (result.exitCode !== 0) {
      return {
        ...DEFINITION,
        status: 'error',
        message: 'Docker Compose is not available or failed to execute.',
        error: result.stderr || result.stdout || 'Command `docker compose version --short` failed.',
        suggestion:
          'Install the official Docker Compose v2 plugin (`docker compose-plugin`) or update Docker Desktop.',
      };
    }

    const versionStr = result.stdout.trim();
    const match = versionStr.match(/v?(\d+)\.(\d+)(?:\.(\d+))?/);

    if (!match) {
      return {
        ...DEFINITION,
        status: 'warning',
        message: `Could not determine exact Docker Compose version (${versionStr}).`,
        suggestion: `Verify manually with \`docker compose version\` that version ${MIN_VERSION_LABEL} or higher is installed.`,
      };
    }

    const version = match.slice(1).map((part) => parseInt(part ?? '0', 10));

    if (isBelowMinimum(version)) {
      return {
        ...DEFINITION,
        status: 'error',
        message: `Found Docker Compose ${versionStr}, but version ${MIN_VERSION_LABEL} or higher is required.`,
        suggestion:
          'Upgrade Docker Compose: the manifests rely on `include`, `depends_on.required` and `start_interval`, which require 2.20.2 or newer.',
      };
    }

    return {
      ...DEFINITION,
      status: 'success',
      message: `Docker Compose v${versionStr}`,
    };
  },
};

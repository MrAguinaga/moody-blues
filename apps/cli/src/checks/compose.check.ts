import { runCommand } from '../utils/system.utils';
import type { CheckDefinition, CheckResult } from './checks.types';

export const composeCheck: CheckDefinition = {
  id: 'docker-compose',
  name: 'Docker Compose v2',
  description: 'Checks availability of Docker Compose version 2 or higher',
  run: async (): Promise<CheckResult> => {
    const result = await runCommand('docker', ['compose', 'version', '--short']);

    if (result.exitCode !== 0) {
      return {
        id: 'docker-compose',
        name: 'Docker Compose v2',
        description: 'Checks availability of Docker Compose version 2 or higher',
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
        id: 'docker-compose',
        name: 'Docker Compose v2',
        description: 'Checks availability of Docker Compose version 2 or higher',
        status: 'warning',
        message: `Could not determine exact Docker Compose version (${versionStr}).`,
        suggestion:
          'Verify manually with `docker compose version` that version 2.0 or higher is installed.',
      };
    }

    const major = parseInt(match[1] ?? '0', 10);

    if (major < 2) {
      return {
        id: 'docker-compose',
        name: 'Docker Compose v2',
        description: 'Checks availability of Docker Compose version 2 or higher',
        status: 'error',
        message: `Found Docker Compose ${versionStr}, but version 2.0.0 or higher is required.`,
        suggestion:
          'Upgrade to Docker Compose v2. Legacy Compose v1 is deprecated and does not support modern specifications.',
      };
    }

    return {
      id: 'docker-compose',
      name: 'Docker Compose v2',
      description: 'Checks availability of Docker Compose version 2 or higher',
      status: 'success',
      message: `Docker Compose v${versionStr}`,
    };
  },
};

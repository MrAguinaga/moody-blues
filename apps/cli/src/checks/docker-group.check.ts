import { runCommand } from '../utils/system.utils';
import type { CheckDefinition, CheckResult } from './checks.types';

const DEFINITION = {
  id: 'docker-group',
  name: 'Docker Group Membership',
  description: 'Checks that the current user can access the Docker socket without sudo',
} as const;

export function isDockerPermissionDenied(stderr: string): boolean {
  return /permission denied/i.test(stderr);
}

export const dockerGroupCheck: CheckDefinition = {
  ...DEFINITION,
  run: async (): Promise<CheckResult> => {
    if (process.platform !== 'linux') {
      return { ...DEFINITION, status: 'success', message: 'Not applicable on this platform' };
    }

    const result = await runCommand('docker', ['info', '--format', '{{.ServerVersion}}']);
    if (result.exitCode === 0) {
      return { ...DEFINITION, status: 'success', message: 'Docker socket is accessible' };
    }

    if (isDockerPermissionDenied(result.stderr)) {
      return {
        ...DEFINITION,
        status: 'error',
        message: 'Permission denied on the Docker socket.',
        error: result.stderr,
        suggestion: 'Run `sudo usermod -aG docker "$USER" && newgrp docker`.',
      };
    }

    return {
      ...DEFINITION,
      status: 'success',
      message: 'Socket permissions are not the cause of the Docker failure',
    };
  },
};

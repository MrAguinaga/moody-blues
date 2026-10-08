import { runCommand } from '../utils/system.utils';
import type { CheckDefinition, CheckResult } from './checks.types';

export const dockerCheck: CheckDefinition = {
  id: 'docker-daemon',
  name: 'Docker Daemon',
  description: 'Verifies connectivity with the Docker engine',
  run: async (): Promise<CheckResult> => {
    const result = await runCommand('docker', ['info', '--format', '{{.ServerVersion}}']);

    if (result.exitCode !== 0) {
      return {
        id: 'docker-daemon',
        name: 'Docker Daemon',
        description: 'Verifies connectivity with the Docker engine',
        status: 'error',
        message: 'Could not communicate with the Docker daemon.',
        error:
          result.stderr || result.stdout || 'Command `docker info` exited with non-zero status.',
        suggestion:
          'Ensure Docker is installed and running (e.g. `sudo systemctl start docker` or launch Docker Desktop) and your user belongs to the `docker` group.',
      };
    }

    const version = result.stdout || 'detected';

    return {
      id: 'docker-daemon',
      name: 'Docker Daemon',
      description: 'Verifies connectivity with the Docker engine',
      status: 'success',
      message: `Docker daemon active (v${version})`,
    };
  },
};

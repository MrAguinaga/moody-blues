import { type ExecResult, runCommand } from '../utils/system.utils';

type RunDocker = (file: string, args: string[]) => Promise<ExecResult>;

export async function detectDockerCpus(run: RunDocker = runCommand): Promise<number | undefined> {
  const result = await run('docker', ['info', '--format', '{{.NCPU}}']);
  if (result.exitCode !== 0 || !/^\d+$/.test(result.stdout)) {
    return undefined;
  }
  const cpus = Number(result.stdout);
  return cpus >= 1 ? cpus : undefined;
}

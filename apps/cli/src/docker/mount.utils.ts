import { runCommand } from '../utils/system.utils';

export async function isMountActive(path: string): Promise<boolean> {
  const result = await runCommand('findmnt', ['--raw', '--noheadings', '--output', 'TARGET']);
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout.split('\n').some((target) => target.trim() === path);
}

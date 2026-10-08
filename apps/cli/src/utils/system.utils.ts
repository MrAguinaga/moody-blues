import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(file: string, args: string[] = []): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      encoding: 'utf8',
      env: process.env,
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };

    return {
      stdout: (error.stdout ?? '').trim(),
      stderr: (error.stderr ?? error.message ?? '').trim(),
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

export function isInteractiveTerminal(): boolean {
  return Boolean(
    process.stdout.isTTY && process.stdin.isTTY && !process.env.CI && process.env.TERM !== 'dumb',
  );
}

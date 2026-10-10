import { spawn } from 'node:child_process';

import { createLineSplitter } from '../utils/line-splitter.utils';
import type { CommandRunner } from './update.types';

const OUTPUT_TAIL_CHARS = 2000;

export class CommandFailedError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly output: string,
  ) {
    const exit = exitCode === null ? '' : ` (exit code ${exitCode})`;
    super(`${command} failed${exit}${output ? `: ${output}` : ''}`);
    this.name = 'CommandFailedError';
  }
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_TAIL_CHARS ? `…${trimmed.slice(-OUTPUT_TAIL_CHARS)}` : trimmed;
}

export const spawnCommand: CommandRunner = (command, args, { cwd, signal, env, onLine }) => {
  const label = [command, ...args].join(' ');

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    const lines = onLine ? createLineSplitter(onLine) : undefined;
    let stdout = '';
    let combined = '';

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      combined += chunk;
      lines?.push(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      combined += chunk;
      lines?.push(chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (signal?.aborted) {
        reject(signal.reason ?? error);
        return;
      }
      const detail = error.code === 'ENOENT' ? `${command} was not found in PATH` : error.message;
      reject(new CommandFailedError(label, null, detail));
    });
    child.on('close', (code) => {
      lines?.flush();
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new CommandFailedError(label, code, tail(combined)));
    });
  });
};

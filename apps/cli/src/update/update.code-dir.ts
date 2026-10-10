import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FindCodeDirOptions {
  startDir?: string;
  exists?: (path: string) => boolean;
}

export const CLI_ENTRYPOINT = join('apps', 'cli', 'dist', 'main.js');

export function findCodeDir(options: FindCodeDirOptions = {}): string {
  const startDir = options.startDir ?? dirname(fileURLToPath(import.meta.url));
  const exists = options.exists ?? existsSync;
  const { root } = parse(startDir);

  for (let current = startDir; ; current = dirname(current)) {
    if (exists(join(current, '.git')) && exists(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    if (current === root) {
      throw new Error(
        `The code of Moody Blues is not a git checkout (searched above ${startDir}). ` +
          'The update command only supports installations made with install.sh.',
      );
    }
  }
}

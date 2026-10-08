import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HardwareAccel } from './hwaccel.utils';

const COMPOSE_ENTRYPOINT = 'compose.yaml';

export interface ResolveComposeDirOptions {
  env?: NodeJS.ProcessEnv;
  startDir?: string;
}

export function resolveComposeDir(options: ResolveComposeDirOptions = {}): string {
  const env = options.env ?? process.env;

  const fromEnv = env.MB_COMPOSE_DIR?.trim();
  if (fromEnv) {
    if (!existsSync(join(fromEnv, COMPOSE_ENTRYPOINT))) {
      throw new Error(`MB_COMPOSE_DIR does not contain ${COMPOSE_ENTRYPOINT}: ${fromEnv}`);
    }
    return fromEnv;
  }

  const startDir = options.startDir ?? dirname(fileURLToPath(import.meta.url));
  const { root } = parse(startDir);
  for (let current = startDir; ; current = dirname(current)) {
    const candidate = join(current, 'compose');
    if (existsSync(join(candidate, COMPOSE_ENTRYPOINT))) {
      return candidate;
    }
    if (current === root) {
      throw new Error(
        `Could not locate the compose manifests (compose/${COMPOSE_ENTRYPOINT}) above ${startDir}. ` +
          'Set MB_COMPOSE_DIR to their directory.',
      );
    }
  }
}

export function buildComposeFiles(composeDir: string, hardware?: HardwareAccel): string[] {
  const files = [join(composeDir, COMPOSE_ENTRYPOINT)];
  if (hardware) {
    files.push(join(composeDir, 'overrides', `jellyfin-${hardware.kind}.yaml`));
  }
  return files;
}

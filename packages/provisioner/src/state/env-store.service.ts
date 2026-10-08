import { readFileSync } from 'node:fs';

import type { OwnershipOptions } from '../home/host-identity.utils';
import { writePrivateFileAtomic } from './atomic-write.utils';
import { parseEnvFile, serializeEnvFile } from './env-file.utils';

export function readEnv(envFile: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export function writeEnv(
  envFile: string,
  record: Record<string, string>,
  ownership: OwnershipOptions = {},
): void {
  writePrivateFileAtomic(envFile, serializeEnvFile(record), ownership);
}

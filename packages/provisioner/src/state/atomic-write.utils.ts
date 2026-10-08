import { randomBytes } from 'node:crypto';
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { applyOwnership, type OwnershipOptions } from '../home/host-identity.utils';

const PRIVATE_FILE_MODE = 0o600;

export function writePrivateFileAtomic(
  path: string,
  content: string,
  ownership: OwnershipOptions = {},
): void {
  const tempPath = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tempPath, content, { mode: PRIVATE_FILE_MODE });
    chmodSync(tempPath, PRIVATE_FILE_MODE);
    applyOwnership(tempPath, ownership);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

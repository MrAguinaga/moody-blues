import { randomBytes } from 'node:crypto';
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { applyOwnership, type OwnershipOptions } from '../home/host-identity.utils';

const PRIVATE_FILE_MODE = 0o600;

export function writeFileAtomic(
  path: string,
  content: string,
  mode: number,
  ownership: OwnershipOptions = {},
): void {
  const tempPath = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tempPath, content, { mode });
    chmodSync(tempPath, mode);
    applyOwnership(tempPath, ownership);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function writePrivateFileAtomic(
  path: string,
  content: string,
  ownership: OwnershipOptions = {},
): void {
  writeFileAtomic(path, content, PRIVATE_FILE_MODE, ownership);
}

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { applyOwnership, type OwnershipOptions } from '../home';
import { writePrivateFileAtomic } from '../state';
import type { SeedOutcome } from './preseed.types';

export interface ExpectedKey {
  label: string;
  value: string;
  read(content: string): string | undefined;
}

export interface SeedFileOptions {
  ownership?: OwnershipOptions;
  expectedKey: ExpectedKey;
}

export class SeedConflictError extends Error {
  constructor(
    readonly path: string,
    label: string,
  ) {
    super(
      `${path} already exists with a different ${label}. ` +
        'Run "moody-blues reset --fresh" to regenerate the service configuration.',
    );
    this.name = 'SeedConflictError';
  }
}

function ensureParentDirectory(path: string, ownership: OwnershipOptions): void {
  const directory = dirname(path);
  const firstCreated = mkdirSync(directory, { recursive: true, mode: 0o775 });
  if (!firstCreated) {
    return;
  }
  for (let current = directory; current.length >= firstCreated.length; current = dirname(current)) {
    applyOwnership(current, ownership);
    if (current === firstCreated) {
      break;
    }
  }
}

export function ensureSeedFile(
  path: string,
  content: string,
  options: SeedFileOptions,
): SeedOutcome {
  const { ownership = {}, expectedKey } = options;

  if (existsSync(path)) {
    let existing: string | undefined;
    try {
      existing = expectedKey.read(readFileSync(path, 'utf8'));
    } catch {
      existing = undefined;
    }
    if (existing !== expectedKey.value) {
      throw new SeedConflictError(path, expectedKey.label);
    }
    return { status: 'unchanged', path };
  }

  ensureParentDirectory(path, ownership);
  writePrivateFileAtomic(path, content, ownership);
  return { status: 'created', path };
}

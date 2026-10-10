import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { HostIdentity } from '../config/config.types';
import { type MbHomeLayout, SERVICE_NAMES } from './home.paths';
import { applyOwnership, type OwnershipOptions } from './host-identity.utils';

const DIRECTORY_MODE = 0o775;
const RECYCLE_DIRECTORY = '.recycle';

export interface HostTreeResult {
  created: string[];
}

export function listTreeDirectories(layout: MbHomeLayout): string[] {
  return [
    layout.root,
    layout.configDir,
    ...SERVICE_NAMES.map((service) => layout.configFor(service)),
    join(layout.configFor('caddy'), 'data'),
    join(layout.configFor('caddy'), 'config'),
    join(layout.configFor('caddy'), 'etc'),
    layout.cacheDir,
    join(layout.cacheDir, 'jellyfin'),
    layout.mntDir,
    layout.debridMountDir,
    layout.dataDir,
    layout.downloadsDir,
    join(layout.downloadsDir, 'radarr'),
    join(layout.downloadsDir, 'sonarr'),
    layout.mediaDir,
    join(layout.mediaDir, 'movies'),
    join(layout.mediaDir, 'tv'),
    join(layout.mediaDir, RECYCLE_DIRECTORY),
  ];
}

function createDirectory(path: string, recursive: boolean): void {
  try {
    mkdirSync(path, { mode: DIRECTORY_MODE, recursive });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Permission denied creating ${path}. Create the directory first with: ` +
          `sudo install -d -o "$USER" -g "$USER" ${path}`,
      );
    }
    throw error;
  }
}

export function ensureHostTree(
  layout: MbHomeLayout,
  identity: HostIdentity,
  options: Omit<OwnershipOptions, 'identity'> = {},
): HostTreeResult {
  const created: string[] = [];

  for (const directory of listTreeDirectories(layout)) {
    if (existsSync(directory)) {
      continue;
    }
    createDirectory(directory, directory === layout.root);
    chmodSync(directory, DIRECTORY_MODE);
    applyOwnership(directory, { ...options, identity });
    created.push(directory);
  }

  return { created };
}

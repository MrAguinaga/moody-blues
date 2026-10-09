import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MoodyBluesConfig } from '../config/config.types';
import type { MbHomeLayout } from '../home/home.paths';
import { writeFileAtomic } from '../state/atomic-write.utils';
import { renderCaddyfile } from './caddyfile.generator';

const CADDYFILE_MODE = 0o644;

export interface CaddyfileWriteResult {
  changed: boolean;
}

function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export function caddyfilePath(layout: MbHomeLayout): string {
  return join(layout.configFor('caddy'), 'etc', 'Caddyfile');
}

export function writeCaddyfile(
  layout: MbHomeLayout,
  config: MoodyBluesConfig,
): CaddyfileWriteResult {
  const path = caddyfilePath(layout);
  const content = renderCaddyfile(config);

  if (readIfExists(path) === content) {
    return { changed: false };
  }

  writeFileAtomic(path, content, CADDYFILE_MODE, {
    identity: config.host,
  });
  return { changed: true };
}

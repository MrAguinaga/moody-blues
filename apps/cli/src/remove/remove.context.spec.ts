import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDefaultConfig,
  createLayout,
  SERVICE_KEY_ENV_KEYS,
  writeEnv,
  writeState,
} from '@moody-blues/provisioner';

import { createRemoveClients } from './remove.context';

describe('createRemoveClients', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mb-remove-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const install = (extra: Record<string, string> = {}) => {
    const layout = createLayout(home);
    writeState(layout.stateFile, createDefaultConfig({ host: { puid: 1000, pgid: 1000 } }));
    writeEnv(layout.envFile, {
      MB_HOME: home,
      ...Object.fromEntries(SERVICE_KEY_ENV_KEYS.map((key) => [key, `${key}-value`])),
      ...extra,
    });
  };

  it('builds the five clients from the saved installation', () => {
    install({ JELLYFIN_API_KEY: 'jellyfin-key' });

    const clients = createRemoveClients({ home, signal: new AbortController().signal });

    expect(Object.keys(clients).sort()).toEqual([
      'decypharr',
      'jellyfin',
      'radarr',
      'seerr',
      'sonarr',
    ]);
  });

  it('fails the Jellyfin refresh with the reason when the API key is missing', async () => {
    install();

    const clients = createRemoveClients({ home, signal: new AbortController().signal });

    await expect(clients.jellyfin.refreshLibrary()).rejects.toThrow(/JELLYFIN_API_KEY is missing/);
  });

  it('fails clearly when Moody Blues is not set up', () => {
    expect(() =>
      createRemoveClients({ home: join(home, 'missing'), signal: new AbortController().signal }),
    ).toThrow(/not set up yet/);
  });
});

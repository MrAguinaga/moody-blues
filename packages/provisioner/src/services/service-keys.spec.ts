import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLayout, type MbHomeLayout } from '../home';
import { SERVICE_CATALOG } from './service-catalog';
import { loadServiceKeys } from './service-keys';

const FULL_ENV = [
  'SONARR_API_KEY=sonarr-key',
  'RADARR_API_KEY=radarr-key',
  'PROWLARR_API_KEY=prowlarr-key',
  'BAZARR_API_KEY=bazarr-key',
  'DECYPHARR_API_TOKEN=decypharr-token',
  'SEERR_API_KEY=seerr-key',
  '',
].join('\n');

describe('SERVICE_CATALOG', () => {
  it('fixes ports, internal urls and host urls', () => {
    expect(SERVICE_CATALOG.sonarr).toEqual({
      id: 'sonarr',
      port: 8989,
      internalUrl: 'http://sonarr:8989',
      hostUrl: 'http://127.0.0.1:8989',
    });
    expect(Object.values(SERVICE_CATALOG).map((service) => [service.id, service.port])).toEqual([
      ['sonarr', 8989],
      ['radarr', 7878],
      ['prowlarr', 9696],
      ['bazarr', 6767],
      ['decypharr', 8282],
      ['flaresolverr', 8191],
    ]);
  });

  it('never ends internal urls with a slash', () => {
    for (const service of Object.values(SERVICE_CATALOG)) {
      expect(service.internalUrl.endsWith('/')).toBe(false);
    }
  });
});

describe('loadServiceKeys', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-keys-'));
    layout = createLayout(sandbox);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('reads every service key from the environment file', () => {
    writeFileSync(layout.envFile, FULL_ENV);

    expect(loadServiceKeys(layout)).toEqual({
      sonarrApiKey: 'sonarr-key',
      radarrApiKey: 'radarr-key',
      prowlarrApiKey: 'prowlarr-key',
      bazarrApiKey: 'bazarr-key',
      decypharrApiToken: 'decypharr-token',
      seerrApiKey: 'seerr-key',
    });
  });

  it('names every missing key', () => {
    writeFileSync(layout.envFile, 'SONARR_API_KEY=sonarr-key\nRADARR_API_KEY=\n');

    expect(() => loadServiceKeys(layout)).toThrow(
      /RADARR_API_KEY, PROWLARR_API_KEY, BAZARR_API_KEY, DECYPHARR_API_TOKEN, SEERR_API_KEY/,
    );
  });

  it('fails when the environment file does not exist', () => {
    expect(() => loadServiceKeys(layout)).toThrow(/Missing service keys/);
  });
});

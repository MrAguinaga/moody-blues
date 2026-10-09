import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { DEFAULT_REQUEST_PERMISSIONS, SEERR_PERMISSIONS } from './seerr.constants';
import {
  arrApiKeyReadable,
  arrInstanceDrift,
  buildArrConnection,
  buildArrInstance,
  buildJellyfinConnectionUpdate,
  desiredApplicationUrl,
  desiredExternalHostname,
  desiredMainSettings,
  regionOf,
} from './seerr.settings';

const identity = { puid: 1000, pgid: 1000 };
const profile = { id: 7, name: 'Moody Blues' };

function configFor(domain: string, ui = 'es-MX') {
  const base = createDefaultConfig({ host: identity, domain });
  return { ...base, languages: { ...base.languages, ui } };
}

describe('default request permissions', () => {
  const has = (flag: keyof typeof SEERR_PERMISSIONS) =>
    (DEFAULT_REQUEST_PERMISSIONS & SEERR_PERMISSIONS[flag]) !== 0;

  it('is the request plus auto-approve bitmask', () => {
    expect(DEFAULT_REQUEST_PERMISSIONS).toBe(160);
  });

  it('allows requesting and approves automatically', () => {
    expect(has('REQUEST')).toBe(true);
    expect(has('AUTO_APPROVE')).toBe(true);
  });

  it.each([
    'REQUEST_ADVANCED',
    'REQUEST_4K',
    'AUTO_APPROVE_4K',
    'MANAGE_REQUESTS',
    'ADMIN',
  ] as const)('does not grant %s', (flag) => {
    expect(has(flag)).toBe(false);
  });

  it('uses the documented bit values', () => {
    expect(SEERR_PERMISSIONS).toMatchObject({
      ADMIN: 2,
      MANAGE_REQUESTS: 16,
      REQUEST: 32,
      AUTO_APPROVE: 128,
      REQUEST_4K: 1024,
      REQUEST_ADVANCED: 8192,
      AUTO_APPROVE_4K: 32768,
    });
  });
});

describe('desiredMainSettings', () => {
  it('derives the language, region and URL from the configuration', () => {
    expect(desiredMainSettings(configFor('example.org'))).toEqual({
      applicationTitle: 'Moody Blues',
      applicationUrl: 'https://discover.example.org',
      locale: 'es-MX',
      discoverRegion: 'MX',
      streamingRegion: 'MX',
      defaultPermissions: 160,
      mediaServerLogin: true,
      newPlexLogin: true,
      cacheImages: false,
    });
  });

  it('keeps the local mode URL without a trailing slash', () => {
    expect(desiredMainSettings(configFor('localhost')).applicationUrl).toBe(
      'https://discover.localhost',
    );
    expect(desiredApplicationUrl('example.org').endsWith('/')).toBe(false);
  });

  it('never enables the image cache', () => {
    expect(desiredMainSettings(configFor('example.org')).cacheImages).toBe(false);
  });

  it('never carries the API key or the original language', () => {
    const keys = Object.keys(desiredMainSettings(configFor('example.org')));

    expect(keys).not.toContain('apiKey');
    expect(keys).not.toContain('originalLanguage');
  });

  it('uses an empty region when the language has none', () => {
    const settings = desiredMainSettings(configFor('example.org', 'es'));

    expect(settings.locale).toBe('es');
    expect(settings.discoverRegion).toBe('');
  });

  it('rejects an invalid language tag', () => {
    expect(() => regionOf('not a tag')).toThrow(/not a valid language tag/);
  });
});

describe('buildJellyfinConnectionUpdate', () => {
  it('uses ip and not hostname', () => {
    const update = buildJellyfinConnectionUpdate(
      { ip: 'jellyfin', port: 8096, useSsl: false, urlBase: '', apiKey: 'k', libraries: [] },
      desiredExternalHostname('example.org'),
    );

    expect(update).toEqual({
      ip: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      apiKey: 'k',
      externalHostname: 'https://watch.example.org',
    });
    expect(update).not.toHaveProperty('hostname');
  });
});

describe('buildArrInstance', () => {
  const sonarr = buildArrInstance('sonarr', {
    apiKey: 'sonarr-key',
    profile,
    directory: '/data/media/tv',
  });
  const radarr = buildArrInstance('radarr', {
    apiKey: 'radarr-key',
    profile,
    directory: '/data/media/movies',
  });

  it.each([
    ['sonarr', sonarr, 'sonarr', 8989],
    ['radarr', radarr, 'radarr', 7878],
  ] as const)('addresses %s by bare host name and port', (_kind, instance, host, port) => {
    expect(instance.hostname).toBe(host);
    expect(instance.hostname).not.toMatch(/[:/]/);
    expect(instance.port).toBe(port);
    expect(instance.useSsl).toBe(false);
    expect(instance.baseUrl).toBe('');
  });

  it('is the default non-4K server with the master profile', () => {
    for (const instance of [sonarr, radarr]) {
      expect(instance.is4k).toBe(false);
      expect(instance.isDefault).toBe(true);
      expect(instance.activeProfileId).toBe(7);
      expect(instance.activeProfileName).toBe('Moody Blues');
    }
    expect(sonarr.name).toBe('Sonarr');
    expect(radarr.name).toBe('Radarr');
    expect(sonarr.activeDirectory).toBe('/data/media/tv');
    expect(radarr.activeDirectory).toBe('/data/media/movies');
  });

  it('carries every field the server requires', () => {
    const common = [
      'name',
      'hostname',
      'port',
      'apiKey',
      'useSsl',
      'activeProfileId',
      'activeProfileName',
      'activeDirectory',
      'is4k',
      'isDefault',
    ];

    expect(Object.keys(sonarr)).toEqual(expect.arrayContaining([...common, 'enableSeasonFolders']));
    expect(Object.keys(radarr)).toEqual(expect.arrayContaining([...common, 'minimumAvailability']));
    expect(radarr).not.toHaveProperty('enableSeasonFolders');
    expect(sonarr).not.toHaveProperty('minimumAvailability');
  });

  it('omits the anime profile fields instead of sending nulls', () => {
    for (const [key, value] of Object.entries(sonarr)) {
      expect(value, key).not.toBeNull();
    }
    expect(sonarr).not.toHaveProperty('activeAnimeProfileId');
    expect(sonarr).not.toHaveProperty('activeLanguageProfileId');
  });

  it('builds the connection for the test call', () => {
    expect(buildArrConnection(sonarr)).toEqual({
      hostname: 'sonarr',
      port: 8989,
      apiKey: 'sonarr-key',
      useSsl: false,
      baseUrl: '',
    });
  });
});

describe('arrInstanceDrift', () => {
  const desired = buildArrInstance('radarr', {
    apiKey: 'radarr-key',
    profile,
    directory: '/data/media/movies',
  });
  const stored = { ...desired, id: 0 };

  it('finds no drift in an identical instance', () => {
    expect(arrInstanceDrift(stored, desired)).toEqual([]);
  });

  it('reports a different profile id and directory', () => {
    expect(
      arrInstanceDrift({ ...stored, activeProfileId: 3, activeDirectory: '/x' }, desired),
    ).toEqual(['activeProfileId', 'activeDirectory']);
  });

  it('treats an absent base URL as an empty one', () => {
    const withoutBaseUrl: Partial<typeof stored> = { ...stored };
    delete withoutBaseUrl.baseUrl;

    expect(arrInstanceDrift(withoutBaseUrl as typeof stored, desired)).toEqual([]);
    expect(arrInstanceDrift({ ...stored, baseUrl: '/radarr' }, desired)).toEqual(['baseUrl']);
  });

  it('reports a flag that flipped', () => {
    expect(arrInstanceDrift({ ...stored, is4k: true, isDefault: false }, desired)).toEqual([
      'is4k',
      'isDefault',
    ]);
  });

  it('compares the API key only when it can be read', () => {
    const hidden: Partial<typeof stored> = { ...stored };
    delete hidden.apiKey;

    expect(arrApiKeyReadable(stored)).toBe(true);
    expect(arrApiKeyReadable(hidden as typeof stored)).toBe(false);
    expect(arrApiKeyReadable({ ...stored, apiKey: '' })).toBe(false);
    expect(arrInstanceDrift({ ...stored, apiKey: 'other' }, desired)).toEqual(['apiKey']);
    expect(arrInstanceDrift(hidden as typeof stored, desired)).toEqual([]);
  });
});

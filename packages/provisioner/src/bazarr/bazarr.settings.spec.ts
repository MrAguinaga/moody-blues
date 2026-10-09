import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { desiredProviders, desiredSettings, findDrift } from './bazarr.settings';
import type { BazarrSettings } from './bazarr.types';

const input = {
  sonarrApiKey: 'sonarr-key',
  radarrApiKey: 'radarr-key',
  adminUsername: 'Admin',
  adminPassword: 'secret',
};

function matching(): BazarrSettings {
  return {
    general: {
      use_sonarr: true,
      use_radarr: true,
      enabled_providers: ['gestdown'],
      serie_default_enabled: true,
      serie_default_profile: 1,
      movie_default_enabled: true,
      movie_default_profile: 1,
    },
    auth: {
      type: 'form',
      username: 'Admin',
      password: createHash('md5').update('secret').digest('hex'),
    },
    sonarr: { ip: 'sonarr', port: 8989, base_url: '', ssl: false, apikey: 'sonarr-key' },
    radarr: { ip: 'radarr', port: 7878, base_url: null, ssl: false, apikey: 'radarr-key' },
  };
}

describe('desiredProviders', () => {
  it('always includes gestdown and adds opensubtitlescom only on request', () => {
    expect(desiredProviders([], false)).toEqual(['gestdown']);
    expect(desiredProviders(['gestdown'], true)).toEqual(['gestdown', 'opensubtitlescom']);
  });

  it('drops opensubtitlescom without credentials and keeps unrelated providers', () => {
    expect(desiredProviders(['embeddedsubtitles', 'opensubtitlescom'], false)).toEqual([
      'embeddedsubtitles',
      'gestdown',
    ]);
  });
});

describe('findDrift', () => {
  it('reports nothing when the stored settings match', () => {
    const settings = matching();

    expect(findDrift(settings, desiredSettings(settings, input))).toEqual([]);
  });

  it('treats numeric strings, empty strings and nulls as equal to their typed values', () => {
    const settings = matching();
    settings.general = { ...settings.general, serie_default_profile: '1' };
    settings.sonarr = { ...settings.sonarr, port: '8989', base_url: null };

    expect(findDrift(settings, desiredSettings(settings, input))).toEqual([]);
  });

  it('ignores provider order and extra providers but flags a missing gestdown', () => {
    const keys = (settings: BazarrSettings) =>
      findDrift(settings, desiredSettings(settings, input)).map((entry) => entry.key);
    const settings = matching();

    settings.general = { ...settings.general, enabled_providers: ['subx', 'gestdown'] };
    expect(keys(settings)).not.toContain('enabled_providers');
    settings.general = { ...settings.general, enabled_providers: ['subx'] };
    expect(keys(settings)).toContain('enabled_providers');
  });

  it('compares the administrator password against its stored hash', () => {
    const settings = matching();
    settings.auth = { ...settings.auth, password: 'stale-hash' };

    const drift = findDrift(settings, desiredSettings(settings, input));

    expect(drift.map((entry) => `${entry.section}.${entry.key}`)).toEqual(['auth.password']);
    expect(drift[0]?.value).toBe('secret');
  });

  it('flags only the keys that differ', () => {
    const settings = matching();
    settings.radarr = { ...settings.radarr, ip: 'elsewhere' };

    expect(
      findDrift(settings, desiredSettings(settings, input)).map(
        (entry) => `${entry.section}.${entry.key}`,
      ),
    ).toEqual(['radarr.ip']);
  });
});

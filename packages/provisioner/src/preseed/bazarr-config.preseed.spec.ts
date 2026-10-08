import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { readBazarrApiKey, renderBazarrConfig } from './bazarr-config.preseed';
import type { BazarrSeedInput } from './preseed.types';

const input: BazarrSeedInput = {
  apiKey: 'bazarrkey1',
  sonarrApiKey: '1234567890abcdef',
  radarrApiKey: 'fedcba0987654321',
  adminUsername: 'admin',
  adminPassword: 'p@ss word',
};

type Rendered = {
  general: Record<string, unknown>;
  auth: Record<string, unknown>;
  sonarr: Record<string, unknown>;
  radarr: Record<string, unknown>;
  opensubtitlescom?: Record<string, unknown>;
};

function render(overrides: Partial<BazarrSeedInput> = {}): Rendered {
  return parse(renderBazarrConfig({ ...input, ...overrides })) as Rendered;
}

describe('renderBazarrConfig', () => {
  it('serializes numbers and booleans as native YAML types', () => {
    const { general, sonarr, radarr } = render();

    expect(general).toMatchObject({
      port: 6767,
      auto_update: false,
      use_sonarr: true,
      use_radarr: true,
      serie_default_enabled: true,
      serie_default_profile: 1,
      movie_default_enabled: true,
      movie_default_profile: 1,
      use_embedded_subs: true,
    });
    expect(sonarr).toMatchObject({ ip: 'sonarr', port: 8989, ssl: false, base_url: '' });
    expect(radarr).toMatchObject({ ip: 'radarr', port: 7878, ssl: false, base_url: '' });
  });

  it('stores the MD5 digest of the admin password', () => {
    const { auth } = render();

    expect(auth.password).toBe(createHash('md5').update('p@ss word').digest('hex'));
    expect(auth).toMatchObject({ type: 'form', username: 'admin', apikey: 'bazarrkey1' });
  });

  it('keeps every text value quoted so it is never retyped', () => {
    const { sonarr } = render({ sonarrApiKey: '1234567890' });

    expect(sonarr.apikey).toBe('1234567890');
    expect(renderBazarrConfig({ ...input, sonarrApiKey: '1234567890' })).toContain(
      "apikey: '1234567890'",
    );
  });

  it('rejects an API key without letters', () => {
    expect(() => renderBazarrConfig({ ...input, apiKey: '1234567890' })).toThrow(
      /at least one letter/,
    );
  });

  it('enables only gestdown without OpenSubtitles credentials', () => {
    const rendered = render();

    expect(rendered.general.enabled_providers).toEqual(['gestdown']);
    expect(rendered.opensubtitlescom).toBeUndefined();
  });

  it('adds opensubtitlescom with its credentials when provided', () => {
    const rendered = render({ opensubtitles: { username: 'os-user', password: 'os-pass' } });

    expect(rendered.general.enabled_providers).toEqual(['gestdown', 'opensubtitlescom']);
    expect(rendered.opensubtitlescom).toEqual({ username: 'os-user', password: 'os-pass' });
  });

  it('leaves the path mappings empty', () => {
    const { general } = render();

    expect(general.path_mappings).toEqual([]);
    expect(general.path_mappings_movie).toEqual([]);
  });

  it('reads the API key back as text', () => {
    expect(readBazarrApiKey(renderBazarrConfig(input))).toBe('bazarrkey1');
    expect(readBazarrApiKey('auth:\n  apikey: 1234\n')).toBe('1234');
    expect(readBazarrApiKey('')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config/config.defaults';
import { createLayout } from '../home/home.paths';
import { buildHostEnv, resolveJellyfinCpuLimit } from './host-env.service';
import {
  ensureServiceKeys,
  parseUserSecrets,
  serviceKeysFromEnv,
  serviceKeysToEnv,
} from './secrets.service';

const HEX_KEY = /^[0-9a-f]{32}$/;

describe('ensureServiceKeys', () => {
  it('generates every key as 32 lowercase hex characters', () => {
    const keys = ensureServiceKeys({});
    expect(Object.keys(keys)).toHaveLength(6);
    for (const value of Object.values(keys)) {
      expect(value).toMatch(HEX_KEY);
    }
  });

  it('keeps existing keys and only generates the missing ones', () => {
    const existing = { sonarrApiKey: 'custom-key', seerrApiKey: 'b'.repeat(32) };
    const keys = ensureServiceKeys(existing);
    expect(keys.sonarrApiKey).toBe('custom-key');
    expect(keys.seerrApiKey).toBe('b'.repeat(32));
    expect(keys.radarrApiKey).toMatch(HEX_KEY);
  });

  it('is idempotent', () => {
    const first = ensureServiceKeys({});
    expect(ensureServiceKeys(first)).toEqual(first);
  });

  it('round-trips through the env record', () => {
    const keys = ensureServiceKeys({});
    expect(serviceKeysFromEnv(serviceKeysToEnv(keys))).toEqual(keys);
    expect(Object.keys(serviceKeysToEnv(keys)).at(-1)).toBe('SEERR_API_KEY');
  });
});

describe('parseUserSecrets', () => {
  const valid = { RD_API_TOKEN: 't', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw' };

  it('accepts required secrets and leaves OpenSubtitles optional', () => {
    const result = parseUserSecrets(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        secrets: { rdApiToken: 't', adminUsername: 'admin', adminPassword: 'pw' },
        unknownKeys: [],
      },
    });
  });

  it('reports one readable error per missing or empty key', () => {
    const result = parseUserSecrets({ RD_API_TOKEN: '  ', ADMIN_USERNAME: 'a' });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toEqual([
        'RD_API_TOKEN is required and must not be empty',
        'ADMIN_PASSWORD is required and must not be empty',
      ]);
    }
  });

  it('reports unknown keys and keeps OpenSubtitles credentials', () => {
    const result = parseUserSecrets({
      ...valid,
      OPENSUBTITLES_USERNAME: 'u',
      OPENSUBTITLES_PASSWORD: 'p',
      WHATEVER: '1',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        secrets: { opensubtitlesUsername: 'u', opensubtitlesPassword: 'p' },
        unknownKeys: ['WHATEVER'],
      },
    });
  });
});

describe('buildHostEnv', () => {
  const layout = createLayout('/opt/moody-blues');

  it('derives host values with rslave propagation when storage is enabled', () => {
    const config = createDefaultConfig({
      timezone: 'America/Mexico_City',
      storage: { enabled: true },
      host: { puid: 1000, pgid: 1001 },
    });
    expect(buildHostEnv(config, layout)).toEqual({
      MB_HOME: '/opt/moody-blues',
      MB_DOMAIN: 'localhost',
      PUID: '1000',
      PGID: '1001',
      TZ: 'America/Mexico_City',
      COMPOSE_PROFILES: 'storage',
      MNT_PROPAGATION: 'rslave',
      JELLYFIN_CPU_LIMIT: '1',
    });
  });

  it('carries the CPU limit it is given', () => {
    const env = buildHostEnv(createDefaultConfig(), layout, undefined, '3');
    expect(env.JELLYFIN_CPU_LIMIT).toBe('3');
  });

  it('uses rprivate propagation when storage is disabled', () => {
    const config = createDefaultConfig({ storage: { enabled: false } });
    const env = buildHostEnv(config, layout);
    expect(env.MNT_PROPAGATION).toBe('rprivate');
    expect(env.COMPOSE_PROFILES).toBe('');
  });
});

describe('resolveJellyfinCpuLimit', () => {
  it.each([
    [8, undefined, '7'],
    [2, undefined, '1'],
    [1, undefined, '1'],
    [12, '3', '11'],
  ])('leaves one core free out of %i', (dockerCpus, current, expected) => {
    expect(resolveJellyfinCpuLimit(dockerCpus, current)).toBe(expected);
  });

  it.each([0, -2, 1.5, Number.NaN])('ignores the invalid core count %s', (dockerCpus) => {
    expect(resolveJellyfinCpuLimit(dockerCpus, undefined)).toBe('1');
  });

  it('keeps the stored limit when Docker reports nothing', () => {
    expect(resolveJellyfinCpuLimit(undefined, '5')).toBe('5');
  });

  it.each(['', '0', '-1', '2.5', 'many'])('replaces the invalid stored limit %j', (current) => {
    expect(resolveJellyfinCpuLimit(undefined, current)).toBe('1');
  });
});

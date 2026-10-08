import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from './config.defaults';
import { parseConfig } from './config.schema';

describe('parseConfig', () => {
  it('accepts the default configuration', () => {
    const result = parseConfig(createDefaultConfig({ host: { puid: 1000, pgid: 1000 } }));
    expect(result.ok).toBe(true);
  });

  it('applies the documented defaults', () => {
    const config = createDefaultConfig();
    expect(config).toMatchObject({
      mode: 'local',
      domain: 'localhost',
      transcoding: 'off',
      acme: { staging: false },
      storage: { downloadUncached: false },
      tiers: [{ id: 'hd', label: '1080p', maxResolution: '1080p' }],
      languages: { ui: 'es-MX', subtitles: ['es-419'] },
    });
  });

  it('requires a valid FQDN in remote mode', () => {
    for (const domain of ['localhost', 'nodots', 'bad_domain.com']) {
      const result = parseConfig(createDefaultConfig({ mode: 'remote', domain }));
      expect(result.ok).toBe(false);
    }
    const valid = parseConfig(createDefaultConfig({ mode: 'remote', domain: 'media.example.com' }));
    expect(valid.ok).toBe(true);
  });

  it('requires localhost in local mode', () => {
    const result = parseConfig(createDefaultConfig({ mode: 'local', domain: 'media.example.com' }));
    expect(result.ok).toBe(false);
  });

  it('keeps acme.email optional but validates its format', () => {
    const remote = { mode: 'remote', domain: 'media.example.com' } as const;
    expect(parseConfig(createDefaultConfig(remote)).ok).toBe(true);
    expect(parseConfig(createDefaultConfig({ ...remote, acme: { email: 'a@b.co' } })).ok).toBe(
      true,
    );
    expect(parseConfig(createDefaultConfig({ ...remote, acme: { email: 'nope' } })).ok).toBe(false);
  });

  it('fails explicitly on an unknown schemaVersion', () => {
    const result = parseConfig({ ...createDefaultConfig(), schemaVersion: 2 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error.join('\n')).toContain('schemaVersion');
    }
  });
});

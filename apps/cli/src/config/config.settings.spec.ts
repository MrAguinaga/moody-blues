import { describe, expect, it } from 'vitest';

import { createDefaultConfig } from '@moody-blues/provisioner';

import {
  CONFIG_SETTINGS,
  parseConfigKey,
  parseSettingValue,
  readSettings,
} from './config.settings';

describe('parseConfigKey', () => {
  it.each(['transcoding', 'quality-cap', ' Transcoding '])('accepts %j', (raw) => {
    expect(parseConfigKey(raw)).toBe(raw.trim().toLowerCase());
  });

  it.each(['download-uncached', 'mode', ''])('rejects %j listing the available settings', (raw) => {
    expect(() => parseConfigKey(raw)).toThrow(/Available settings: transcoding, quality-cap\./);
  });
});

describe('parseSettingValue', () => {
  it.each(['off', 'cpu', 'hardware', 'CPU'])('accepts transcoding %j', (raw) => {
    expect(parseSettingValue('transcoding', raw)).toBe(raw.toLowerCase());
  });

  it('rejects an unknown transcoding mode listing the allowed ones', () => {
    expect(() => parseSettingValue('transcoding', 'gpu')).toThrow(
      /Invalid value "gpu" for transcoding\. Allowed values: off, cpu, hardware\./,
    );
  });

  it('accepts 1080p as the quality cap', () => {
    expect(parseSettingValue('quality-cap', '1080p')).toBe('1080p');
  });

  it.each(['720p', '2160p', '4k'])('rejects the quality cap %j with the reason', (raw) => {
    expect(() => parseSettingValue('quality-cap', raw)).toThrow(
      /Only 1080p is available.*4K arrives in 0\.2\.0/,
    );
  });
});

describe('readSettings', () => {
  it('reads both settings from the configuration', () => {
    const settings = readSettings(createDefaultConfig({ transcoding: 'cpu' }));

    expect(settings).toEqual([
      { key: 'transcoding', value: 'cpu', allowed: ['off', 'cpu', 'hardware'], writable: true },
      { key: 'quality-cap', value: '1080p', allowed: ['1080p'], writable: false },
    ]);
  });
});

describe('CONFIG_SETTINGS', () => {
  it('applies a transcoding mode without mutating the input', () => {
    const config = createDefaultConfig({ transcoding: 'off' });

    const next = CONFIG_SETTINGS.transcoding.apply(config, 'hardware');

    expect(next.transcoding).toBe('hardware');
    expect(config.transcoding).toBe('off');
  });

  it('applies the quality cap to the first tier only', () => {
    const config = createDefaultConfig();

    const next = CONFIG_SETTINGS['quality-cap'].apply(config, '1080p');

    expect(next).toEqual(config);
    expect(next.tiers).not.toBe(config.tiers);
  });
});

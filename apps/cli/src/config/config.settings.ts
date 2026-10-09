import {
  CONFIG_KEYS,
  type MoodyBluesConfig,
  TRANSCODING_MODES,
  type TranscodingMode,
} from '@moody-blues/provisioner';

import type { ConfigKey, SettingView } from './config.types';

export interface SettingDefinition {
  key: ConfigKey;
  allowed: readonly string[];
  writable: boolean;
  readOnlyNote?: string;
  read(config: MoodyBluesConfig): string;
  apply(config: MoodyBluesConfig, value: string): MoodyBluesConfig;
}

const QUALITY_CAP_VALUE = '1080p';

export const CONFIG_SETTINGS: Readonly<Record<ConfigKey, SettingDefinition>> = {
  transcoding: {
    key: 'transcoding',
    allowed: TRANSCODING_MODES,
    writable: true,
    read: (config) => config.transcoding,
    apply: (config, value) => ({ ...config, transcoding: value as TranscodingMode }),
  },
  'quality-cap': {
    key: 'quality-cap',
    allowed: [QUALITY_CAP_VALUE],
    writable: false,
    readOnlyNote: 'read-only in this version (4K arrives in 0.2.0)',
    read: (config) => config.tiers[0]?.maxResolution ?? QUALITY_CAP_VALUE,
    apply: (config, value) => ({
      ...config,
      tiers: config.tiers.map((tier, index) =>
        index === 0 ? { ...tier, maxResolution: value } : tier,
      ),
    }),
  },
};

export function parseConfigKey(raw: string): ConfigKey {
  const key = raw.trim().toLowerCase();
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown setting "${raw}". Available settings: ${CONFIG_KEYS.join(', ')}.`);
  }
  return key as ConfigKey;
}

export function parseSettingValue(key: ConfigKey, raw: string): string {
  const value = raw.trim().toLowerCase();
  const { allowed } = CONFIG_SETTINGS[key];

  if (allowed.includes(value)) {
    return value;
  }
  if (key === 'quality-cap') {
    throw new Error(
      `Unsupported quality cap "${raw}". Only ${QUALITY_CAP_VALUE} is available: the Master Profile ` +
        'defines a single 1080p tier and 4K arrives in 0.2.0.',
    );
  }
  throw new Error(`Invalid value "${raw}" for ${key}. Allowed values: ${allowed.join(', ')}.`);
}

export function readSettings(config: MoodyBluesConfig): SettingView[] {
  return CONFIG_KEYS.map((key) => {
    const { allowed, writable, read } = CONFIG_SETTINGS[key];
    return { key, value: read(config), allowed: [...allowed], writable };
  });
}

import { resolveHostIdentity } from '../home/host-identity.utils';
import { PROVISIONER_VERSION } from '../provisioner.service';
import {
  type AcmeSettings,
  CONFIG_SCHEMA_VERSION,
  type LanguageSettings,
  type MoodyBluesConfig,
  type StorageSettings,
} from './config.types';

export type ConfigOverrides = Partial<
  Omit<MoodyBluesConfig, 'acme' | 'storage' | 'languages' | 'host'>
> & {
  acme?: Partial<AcmeSettings>;
  storage?: Partial<StorageSettings>;
  languages?: Partial<LanguageSettings>;
  host?: Partial<MoodyBluesConfig['host']>;
};

export function createDefaultConfig(overrides: ConfigOverrides = {}): MoodyBluesConfig {
  const { acme, storage, languages, host, ...rest } = overrides;
  const identity = resolveHostIdentity();

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    mode: 'local',
    domain: 'localhost',
    transcoding: 'off',
    tiers: [{ id: 'hd', label: '1080p', maxResolution: '1080p' }],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    provisionedVersion: PROVISIONER_VERSION,
    ...rest,
    acme: { staging: false, ...acme },
    storage: { enabled: false, downloadUncached: false, ...storage },
    languages: {
      ui: 'es-MX',
      audioPriority: ['es-419+original', 'es-419', 'original', 'es-ES'],
      subtitles: ['es-419'],
      ...languages,
    },
    host: { puid: identity.puid, pgid: identity.pgid, ...host },
  };
}

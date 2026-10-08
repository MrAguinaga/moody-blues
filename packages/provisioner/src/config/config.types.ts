export const DEPLOY_MODES = ['local', 'remote'] as const;
export type DeployMode = (typeof DEPLOY_MODES)[number];

export const TRANSCODING_MODES = ['off', 'cpu', 'hardware'] as const;
export type TranscodingMode = (typeof TRANSCODING_MODES)[number];

export const CONFIG_SCHEMA_VERSION = 1;

export interface AcmeSettings {
  email?: string;
  staging: boolean;
}

export interface StorageSettings {
  enabled: boolean;
  downloadUncached: boolean;
}

export interface QualityTier {
  id: string;
  label: string;
  maxResolution: string;
}

export interface LanguageSettings {
  ui: string;
  audioPriority: string[];
  subtitles: string[];
}

export interface HostIdentity {
  puid: number;
  pgid: number;
}

export interface MoodyBluesConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  mode: DeployMode;
  domain: string;
  acme: AcmeSettings;
  transcoding: TranscodingMode;
  storage: StorageSettings;
  tiers: QualityTier[];
  languages: LanguageSettings;
  timezone: string;
  host: HostIdentity;
  provisionedVersion: string;
}

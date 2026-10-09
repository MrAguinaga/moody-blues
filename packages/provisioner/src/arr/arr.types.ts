import type { ProviderResource } from '../http/provider-fields';

export const ARR_KINDS = ['sonarr', 'radarr'] as const;
export type ArrKind = (typeof ARR_KINDS)[number];

export const ARR_CONFIG_NAMES = [
  'host',
  'downloadclient',
  'mediamanagement',
  'naming',
  'ui',
  'indexer',
] as const;
export type ArrConfigName = (typeof ARR_CONFIG_NAMES)[number];

export interface ArrConfigResource {
  id: number;
  [key: string]: unknown;
}

export interface HostConfigResource extends ArrConfigResource {
  authenticationMethod: string;
  authenticationRequired: string;
  analyticsEnabled: boolean;
  logLevel: string;
  username: string;
  password: string;
  passwordConfirmation: string;
}

export interface SystemStatusResource {
  appName: string;
  version: string;
  authentication: string;
  [key: string]: unknown;
}

export interface HealthResource {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface RootFolderResource {
  id?: number;
  path: string;
}

export interface LanguageResource {
  id: number;
  name: string;
}

export interface DownloadClientResource extends ProviderResource {
  id?: number;
  name: string;
  implementation: string;
  configContract: string;
  enable: boolean;
  protocol: string;
  priority: number;
  removeCompletedDownloads: boolean;
  removeFailedDownloads: boolean;
  tags: number[];
}

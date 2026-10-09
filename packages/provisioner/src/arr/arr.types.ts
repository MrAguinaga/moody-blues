import type { ProviderField, ProviderResource } from '../http/provider-fields';

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

export const QUEUE_STATES = [
  'downloading',
  'importBlocked',
  'importPending',
  'importing',
  'imported',
  'failedPending',
  'failed',
  'ignored',
] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export interface QueueStatusMessage {
  title?: string;
  messages?: string[];
}

export interface QueueRecord {
  id: number;
  title?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: QueueStatusMessage[];
  errorMessage?: string;
  added?: string;
  movieId?: number;
  seriesId?: number;
  episodeId?: number;
}

export interface QueuePage {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: QueueRecord[];
}

export interface QueueRemovalOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
  skipRedownload?: boolean;
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

export interface SelectOption {
  value: number;
  name: string;
}

export interface CustomFormatSpecificationResource {
  id?: number;
  name: string;
  implementation: string;
  negate: boolean;
  required: boolean;
  fields: ProviderField[];
  [key: string]: unknown;
}

export interface CustomFormatResource {
  id?: number;
  name: string;
  includeCustomFormatWhenRenaming: boolean;
  specifications: CustomFormatSpecificationResource[];
}

export interface ReleaseProfileResource {
  id?: number;
  name: string;
  enabled: boolean;
  required: string[];
  ignored: string[];
  indexerId: number;
  tags: number[];
}

export interface SpecificationSchemaField extends ProviderField {
  selectOptions?: SelectOption[];
}

export interface SpecificationSchemaResource {
  implementation: string;
  fields: SpecificationSchemaField[];
  [key: string]: unknown;
}

export interface QualityResource {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface QualityProfileItemResource {
  id?: number;
  name?: string | null;
  quality?: QualityResource | null;
  items: QualityProfileItemResource[];
  allowed: boolean;
}

export interface QualityProfileFormatItemResource {
  format: number;
  name: string;
  score: number;
}

export interface QualityProfileResource {
  id?: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
  items: QualityProfileItemResource[];
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore: number;
  formatItems: QualityProfileFormatItemResource[];
  language?: LanguageResource;
}

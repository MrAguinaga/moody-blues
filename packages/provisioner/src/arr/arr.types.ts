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
  downloadId?: string;
  outputPath?: string;
}

export interface QueueListOptions {
  includeUnknownSeries?: boolean;
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

export interface TitleResource {
  id: number;
  title: string;
  originalTitle?: string;
  year?: number;
  path?: string;
  tmdbId?: number;
  tvdbId?: number;
  alternateTitles?: { title: string }[];
}

export interface HistoryRecord {
  id?: number;
  eventType: string;
  downloadId?: string;
  sourceTitle?: string;
  movieId?: number;
  seriesId?: number;
}

export interface HistoryPage {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: HistoryRecord[];
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

export interface NotificationResource extends ProviderResource {
  id?: number;
  name: string;
  implementation: string;
  configContract: string;
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

export interface EpisodeResource {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  airDateUtc?: string;
  monitored: boolean;
  hasFile: boolean;
  episodeFileId?: number;
}

export interface MissingEpisodeSeries {
  id: number;
  title: string;
  year?: number;
  monitored?: boolean;
  added?: string;
}

export interface MissingEpisodeResource extends EpisodeResource {
  series?: MissingEpisodeSeries;
}

export interface MissingPage {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: MissingEpisodeResource[];
}

export interface ReleaseQualityResource {
  quality: QualityResource;
  revision?: Record<string, unknown>;
}

export interface EpisodeFileResource {
  id: number;
  seriesId: number;
  seasonNumber: number;
  quality?: ReleaseQualityResource;
}

export interface ReleaseResource {
  guid: string;
  indexerId: number;
  indexer?: string;
  title: string;
  quality: ReleaseQualityResource;
  languages?: LanguageResource[];
  seeders?: number;
  size?: number;
  customFormatScore?: number;
  fullSeason?: boolean;
  rejections?: string[];
}

export interface ReleaseGrab {
  guid: string;
  indexerId: number;
  quality: ReleaseQualityResource;
  languages: LanguageResource[];
  shouldOverride: true;
  seriesId: number;
  episodeIds: number[];
}

export interface ManualImportFile {
  path: string;
  seriesId: number;
  episodeIds: number[];
  quality: ReleaseQualityResource;
  languages: LanguageResource[];
  releaseGroup?: string;
  downloadId?: string;
}

export interface ArrCommandResource {
  id: number;
  name?: string;
  status: string;
  message?: string;
}

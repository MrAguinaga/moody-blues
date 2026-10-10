import type { HealthResource } from '../arr/arr.types';
import type { ProviderResource } from '../http/provider-fields';

export interface TagResource {
  id: number;
  label: string;
}

export interface IndexerProxyResource extends ProviderResource {
  id?: number;
  name: string;
  implementation: string;
  configContract: string;
  onHealthIssue: boolean;
  tags: number[];
}

export type ApplicationSyncLevel = 'disabled' | 'addOnly' | 'fullSync';

export interface ApplicationResource extends ProviderResource {
  id?: number;
  name: string;
  implementation: string;
  configContract: string;
  enable: boolean;
  syncLevel: ApplicationSyncLevel;
  tags: number[];
}

export interface IndexerResource extends ProviderResource {
  id?: number;
  name: string;
  definitionName?: string;
  implementation: string;
  configContract: string;
  enable: boolean;
  appProfileId: number;
  priority: number;
  protocol: string;
  privacy: string;
  tags: number[];
}

export interface AppProfileResource {
  id: number;
  name: string;
  minimumSeeders: number;
  [key: string]: unknown;
}

export interface CommandResource {
  id: number;
  name: string;
  status: string;
  message?: string;
}

export interface IndexerStatusResource {
  id: number;
  indexerId: number;
  disabledTill?: string | null;
  mostRecentFailure?: string | null;
  initialFailure?: string | null;
}

export interface IndexerSpec {
  definitionName: string;
}

export type ApplicationUrls = {
  prowlarrUrl: string;
  baseUrl: string;
};

export interface IndexerContext {
  appProfileId: number;
  flaresolverrTagId: number;
  existing: readonly IndexerResource[];
}

export type IndexerChange =
  | { result: 'created' | 'updated' | 'unchanged'; definitionName: string }
  | { result: 'skipped'; definitionName: string; reason: string };

export type ProxyTestResult = { ok: true } | { ok: false; reason: string };

export interface BlockedIndexer {
  indexerId: number;
  name: string;
  disabledTill: string;
}

export interface ProwlarrStatus {
  applications: ApplicationResource[];
  indexerCount: number;
  blocked: BlockedIndexer[];
  health: HealthResource[];
}

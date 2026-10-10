import type {
  ArrClient,
  DecypharrClient,
  EpisodeResource,
  ReleaseResource,
} from '@moody-blues/provisioner';

import type { RemoveTarget } from '../remove';

export type RetrySonarr = Pick<
  ArrClient,
  | 'listTitles'
  | 'getConfig'
  | 'listEpisodes'
  | 'listEpisodeFiles'
  | 'searchReleases'
  | 'grabRelease'
  | 'listHistory'
  | 'listHistoryByDownloadId'
  | 'listQueue'
  | 'removeQueueItem'
  | 'blocklistHistory'
  | 'manualImport'
  | 'getCommand'
>;

export interface RetryClients {
  sonarr: RetrySonarr;
  decypharr: Pick<DecypharrClient, 'deleteTorrent'>;
}

export interface RetryLog {
  text: string;
  modifiedAt: number;
}

export interface RetryRuntime {
  now(): number;
  sleep(ms: number): Promise<void>;
  listVideoFiles(directory: string): Promise<string[]>;
  probe(path: string): Promise<void>;
  readDecypharrLog(): Promise<RetryLog>;
  timeZone?: string;
}

export type RetryTarget = RemoveTarget;

export interface RetrySeason {
  seasonNumber: number;
  episodes: EpisodeResource[];
  missing: EpisodeResource[];
}

export interface RetryCandidate {
  position: number;
  release: ReleaseResource;
  qualityName: string;
  rank: number;
  recognized: boolean;
  score: number;
  seeders: number;
}

export interface CandidateSearch {
  candidates: RetryCandidate[];
  excluded: number;
}

export type EpisodeAction = 'fill' | 'replace' | 'keep';

export interface EpisodeDisposition {
  episode: EpisodeResource;
  action: EpisodeAction;
  existingQuality?: string;
}

export interface RetryPlan {
  target: RetryTarget;
  season: RetrySeason;
  candidate: RetryCandidate;
  dispositions: EpisodeDisposition[];
}

export interface PackAssignment {
  path: string;
  episode: EpisodeResource;
  releaseGroup?: string;
}

export interface PackMatch {
  assignments: PackAssignment[];
  ignored: string[];
  ambiguous: string[];
}

export type RetryStepId = 'decypharr' | 'verify' | 'rollback' | 'sonarr';

export type RetryStepStatus = 'ok' | 'failed' | 'skipped';

export interface RetryStepResult {
  id: RetryStepId;
  status: RetryStepStatus;
  message: string;
  details?: string[];
  hint?: string;
}

export type RetryOutcome = 'imported' | 'rejected' | 'unverified' | 'failed';

export interface RetryResult {
  plan: RetryPlan;
  steps: RetryStepResult[];
  outcome: RetryOutcome;
  imported: number;
  success: boolean;
}

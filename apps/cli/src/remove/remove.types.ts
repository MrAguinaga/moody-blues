import type {
  ArrClient,
  DecypharrClient,
  JellyfinClient,
  SeerrClient,
  TitleResource,
} from '@moody-blues/provisioner';

export type RemoveKind = 'movie' | 'series';

export type RemoveArrClient = Pick<
  ArrClient,
  'listTitles' | 'listHistory' | 'listHistoryByDownloadId' | 'deleteTitle'
>;

export interface RemoveClients {
  radarr: RemoveArrClient;
  sonarr: RemoveArrClient;
  decypharr: Pick<DecypharrClient, 'deleteTorrent'>;
  seerr: Pick<SeerrClient, 'findMedia' | 'deleteMedia'>;
  jellyfin: Pick<JellyfinClient, 'refreshLibrary'>;
}

export interface RemoveLibrary {
  movies: TitleResource[];
  series: TitleResource[];
}

export interface RemoveTarget {
  kind: RemoveKind;
  id: number;
  title: string;
  year?: number;
  path?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface RemoveTorrent {
  infohash: string;
  name?: string;
}

export interface KeptTorrent extends RemoveTorrent {
  reason: string;
}

export interface RemovePlan {
  target: RemoveTarget;
  torrents: RemoveTorrent[];
  kept: KeptTorrent[];
  keepDebrid: boolean;
}

export type RemoveStepId = 'library' | 'decypharr' | 'seerr' | 'jellyfin';

export type RemoveStepStatus = 'ok' | 'failed' | 'skipped';

export interface RemoveStepResult {
  id: RemoveStepId;
  status: RemoveStepStatus;
  message: string;
  details?: string[];
  hint?: string;
}

export interface RemoveResult {
  plan: RemovePlan;
  steps: RemoveStepResult[];
  libraryDeleted: boolean;
  pendingInfohashes: string[];
  success: boolean;
}

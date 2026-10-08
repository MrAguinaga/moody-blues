import type { HostIdentity } from '../config';

export type SeedStatus = 'created' | 'unchanged';

export interface SeedOutcome {
  status: SeedStatus;
  path: string;
}

export type ArrService = 'sonarr' | 'radarr' | 'prowlarr';

export interface ArrConfigInput {
  service: ArrService;
  apiKey: string;
}

export interface OpenSubtitlesCredentials {
  username: string;
  password: string;
}

export interface BazarrSeedInput {
  apiKey: string;
  sonarrApiKey: string;
  radarrApiKey: string;
  adminUsername: string;
  adminPassword: string;
  opensubtitles?: OpenSubtitlesCredentials;
}

export interface DecypharrSeedInput {
  rdApiToken: string;
  apiToken: string;
  sonarrApiKey: string;
  radarrApiKey: string;
  downloadUncached: boolean;
  host: HostIdentity;
  sessionSecret: string;
  strmSecret: string;
}

export interface DecypharrAuthInput {
  adminUsername: string;
  adminPassword: string;
  apiToken: string;
  sessionVersion: string;
}

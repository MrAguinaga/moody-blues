export interface PublicSettings {
  initialized: boolean;
  mediaServerType: number;
  [key: string]: unknown;
}

export interface SeerrUser {
  id: number;
  permissions: number;
  [key: string]: unknown;
}

export interface MainSettings {
  applicationTitle?: string;
  applicationUrl?: string;
  locale?: string;
  discoverRegion?: string;
  streamingRegion?: string;
  originalLanguage?: string;
  mediaServerLogin?: boolean;
  newPlexLogin?: boolean;
  cacheImages?: boolean;
  defaultPermissions?: number;
  [key: string]: unknown;
}

export type DesiredMainSettings = {
  applicationTitle: string;
  applicationUrl: string;
  locale: string;
  discoverRegion: string;
  streamingRegion: string;
  defaultPermissions: number;
  mediaServerLogin: boolean;
  newPlexLogin: boolean;
  cacheImages: boolean;
};

export interface SeerrLibrary {
  id: string;
  name: string;
  enabled: boolean;
  type?: string;
  [key: string]: unknown;
}

export interface JellyfinSettings {
  name?: string;
  ip: string;
  port: number;
  useSsl?: boolean;
  urlBase?: string;
  externalHostname?: string;
  apiKey?: string;
  libraries?: SeerrLibrary[];
  [key: string]: unknown;
}

export interface JellyfinConnectionUpdate {
  ip: string;
  port: number;
  useSsl: boolean;
  urlBase: string;
  apiKey: string;
  externalHostname: string;
}

export interface JellyfinLoginCredentials {
  username: string;
  password: string;
  hostname: string;
  port: number;
}

export type SeerrArrKind = 'sonarr' | 'radarr';

export interface ArrInstance {
  id?: number;
  name: string;
  hostname: string;
  port: number;
  apiKey?: string;
  useSsl: boolean;
  baseUrl?: string;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  is4k: boolean;
  isDefault: boolean;
  [key: string]: unknown;
}

export interface ArrConnection {
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  baseUrl: string;
}

export interface ArrTestResult {
  [key: string]: unknown;
}

export type SeerrMediaType = 'movie' | 'tv';

export interface SeerrMedia {
  id: number;
  mediaType: SeerrMediaType;
  tmdbId?: number;
  tvdbId?: number | null;
  [key: string]: unknown;
}

export interface SeerrMediaPage {
  pageInfo?: { pages?: number; page?: number; results?: number };
  results: SeerrMedia[];
}

export interface SeerrMediaQuery {
  mediaType: SeerrMediaType;
  tmdbId?: number;
  tvdbId?: number;
}

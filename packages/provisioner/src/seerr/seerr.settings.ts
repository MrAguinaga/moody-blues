import type { MoodyBluesConfig } from '../config';
import { driftedKeys } from '../jellyfin/jellyfin.settings';
import { SERVICE_CATALOG } from '../services/service-catalog';
import {
  ARR_INSTANCE_NAMES,
  DEFAULT_REQUEST_PERMISSIONS,
  SEERR_APPLICATION_TITLE,
} from './seerr.constants';
import type {
  ArrConnection,
  ArrInstance,
  DesiredMainSettings,
  JellyfinConnectionUpdate,
  JellyfinSettings,
  SeerrArrKind,
} from './seerr.types';

export interface ProfileReference {
  id: number;
  name: string;
}

export interface ArrInstanceInputs {
  apiKey: string;
  profile: ProfileReference;
  directory: string;
}

// The anime profile, directory and language profile fields stay absent: Seerr's validator rejects
// null for them and, when absent, anime requests fall back to the default profile and directory.
const SONARR_ONLY_FIELDS = {
  enableSeasonFolders: true,
  seriesType: 'standard',
  animeSeriesType: 'anime',
  monitorNewItems: 'all',
  animeTags: [],
} as const;

const RADARR_ONLY_FIELDS = {
  minimumAvailability: 'released',
} as const;

export function regionOf(languageTag: string): string {
  try {
    return new Intl.Locale(languageTag.trim().replace(/_/g, '-')).region ?? '';
  } catch {
    throw new Error(`The interface language "${languageTag}" is not a valid language tag`);
  }
}

export function desiredApplicationUrl(domain: string): string {
  return `https://discover.${domain}`;
}

export function desiredExternalHostname(domain: string): string {
  return `https://watch.${domain}`;
}

export function desiredMainSettings(
  config: Pick<MoodyBluesConfig, 'domain' | 'languages'>,
): DesiredMainSettings {
  const region = regionOf(config.languages.ui);
  return {
    applicationTitle: SEERR_APPLICATION_TITLE,
    applicationUrl: desiredApplicationUrl(config.domain),
    locale: config.languages.ui,
    discoverRegion: region,
    streamingRegion: region,
    defaultPermissions: DEFAULT_REQUEST_PERMISSIONS,
    mediaServerLogin: true,
    newPlexLogin: true,
    cacheImages: false,
  };
}

export function buildJellyfinConnectionUpdate(
  current: JellyfinSettings & { apiKey: string },
  externalHostname: string,
): JellyfinConnectionUpdate {
  return {
    ip: current.ip,
    port: current.port,
    useSsl: current.useSsl ?? false,
    urlBase: current.urlBase ?? '',
    apiKey: current.apiKey,
    externalHostname,
  };
}

export function buildArrInstance(kind: SeerrArrKind, inputs: ArrInstanceInputs): ArrInstance {
  const { id: hostname, port } = SERVICE_CATALOG[kind];
  return {
    name: ARR_INSTANCE_NAMES[kind],
    hostname,
    port,
    apiKey: inputs.apiKey,
    useSsl: false,
    baseUrl: '',
    activeProfileId: inputs.profile.id,
    activeProfileName: inputs.profile.name,
    activeDirectory: inputs.directory,
    is4k: false,
    isDefault: true,
    tags: [],
    externalUrl: '',
    syncEnabled: true,
    preventSearch: false,
    tagRequests: false,
    ...(kind === 'sonarr' ? SONARR_ONLY_FIELDS : RADARR_ONLY_FIELDS),
  };
}

export function buildArrConnection(instance: ArrInstance): ArrConnection {
  return {
    hostname: instance.hostname,
    port: instance.port,
    apiKey: instance.apiKey as string,
    useSsl: instance.useSsl,
    baseUrl: instance.baseUrl ?? '',
  };
}

export function arrInstanceDrift(current: ArrInstance, desired: ArrInstance): string[] {
  const { apiKey, baseUrl, ...rest } = desired;
  const comparable: Record<string, unknown> = { ...rest, baseUrl: baseUrl ?? '' };
  const readable = typeof current.apiKey === 'string' && current.apiKey !== '';
  const target = readable ? { ...comparable, apiKey } : comparable;
  return driftedKeys({ ...current, baseUrl: current.baseUrl ?? '' }, target);
}

export function arrApiKeyReadable(current: ArrInstance): boolean {
  return typeof current.apiKey === 'string' && current.apiKey !== '';
}

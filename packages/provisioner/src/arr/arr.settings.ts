import { SERVICE_CATALOG } from '../services/service-catalog';
import type { ArrKind, LanguageResource } from './arr.types';

export const DECYPHARR_CLIENT_NAME = 'Decypharr';
export const DECYPHARR_IMPLEMENTATION = 'QBittorrent';
export const FALLBACK_UI_LANGUAGE = 'English';

export const ROOT_FOLDER_PATHS: Readonly<Record<ArrKind, string>> = {
  sonarr: '/data/media/tv',
  radarr: '/data/media/movies',
};

export interface DecypharrClientSettings {
  properties: {
    name: string;
    implementation: string;
    configContract: string;
    enable: boolean;
    protocol: string;
    priority: number;
    removeCompletedDownloads: boolean;
    removeFailedDownloads: boolean;
    tags: number[];
  };
  fields: Record<string, unknown>;
  comparableFields: Record<string, unknown>;
}

export function buildHostSettings(): Record<string, unknown> {
  return {
    authenticationMethod: 'forms',
    authenticationRequired: 'enabled',
    analyticsEnabled: false,
    logLevel: 'info',
  };
}

export function buildDecypharrClient(kind: ArrKind, apiKey: string): DecypharrClientSettings {
  const categoryFields =
    kind === 'sonarr'
      ? {
          tvCategory: 'sonarr',
          tvImportedCategory: '',
          recentTvPriority: 0,
          olderTvPriority: 0,
        }
      : {
          movieCategory: 'radarr',
          movieImportedCategory: '',
          recentMoviePriority: 0,
          olderMoviePriority: 0,
        };
  const comparableFields = {
    host: SERVICE_CATALOG.decypharr.id,
    port: SERVICE_CATALOG.decypharr.port,
    useSsl: false,
    urlBase: '',
    apiKey: '',
    username: SERVICE_CATALOG[kind].internalUrl,
    ...categoryFields,
    initialState: 0,
    sequentialOrder: false,
    firstAndLast: false,
    contentLayout: 0,
  };
  return {
    properties: {
      name: DECYPHARR_CLIENT_NAME,
      implementation: DECYPHARR_IMPLEMENTATION,
      configContract: 'QBittorrentSettings',
      enable: true,
      protocol: 'torrent',
      priority: 1,
      removeCompletedDownloads: true,
      removeFailedDownloads: false,
      tags: [],
    },
    fields: { ...comparableFields, password: apiKey },
    comparableFields,
  };
}

export function buildDownloadClientConfigSettings(kind: ArrKind): Record<string, unknown> {
  return {
    enableCompletedDownloadHandling: true,
    autoRedownloadFailed: true,
    autoRedownloadFailedFromInteractiveSearch: true,
    ...(kind === 'radarr' ? { checkForFinishedDownloadInterval: 1 } : {}),
  };
}

export function buildMediaManagementSettings(): Record<string, unknown> {
  return {
    skipFreeSpaceCheckWhenImporting: true,
    recycleBin: '',
    downloadPropersAndRepacks: 'doNotPrefer',
    rescanAfterRefresh: 'afterManual',
    copyUsingHardlinks: true,
    enableMediaInfo: true,
  };
}

export function buildNamingSettings(kind: ArrKind): Record<string, unknown> {
  if (kind === 'sonarr') {
    return {
      renameEpisodes: true,
      replaceIllegalCharacters: true,
      standardEpisodeFormat:
        '{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} ' +
        '[{Custom Formats}{Quality Full}]{[MediaInfo VideoDynamicRangeType]}' +
        '{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{MediaInfo AudioLanguages}' +
        '{[MediaInfo VideoCodec]}{-Release Group}',
      seriesFolderFormat: '{Series TitleYear} {imdb-{ImdbId}}',
      seasonFolderFormat: 'Season {season:00}',
    };
  }
  return {
    renameMovies: true,
    replaceIllegalCharacters: true,
    standardMovieFormat:
      '{Movie CleanTitle} {(Release Year)} {imdb-{ImdbId}} {edition-{Edition Tags}} ' +
      '{[Custom Formats]}{[Quality Full]}{[MediaInfo 3D]}{[MediaInfo VideoDynamicRangeType]}' +
      '{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[Mediainfo VideoCodec]}{-Release Group}',
    movieFolderFormat: '{Movie CleanTitle} ({Release Year}) {imdb-{ImdbId}}',
  };
}

export function buildUiSettings(uiLanguageId: number): Record<string, unknown> {
  return { uiLanguage: uiLanguageId };
}

export function buildIndexerSettings(kind: ArrKind): Record<string, unknown> {
  return {
    minimumAge: 0,
    retention: 0,
    maximumSize: 0,
    rssSyncInterval: 30,
    ...(kind === 'radarr' ? { allowHardcodedSubs: false, availabilityDelay: 0 } : {}),
  };
}

export function uiLanguageName(locale: string): string {
  try {
    const { language } = new Intl.Locale(locale);
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(language);
    return name && name !== language ? name : FALLBACK_UI_LANGUAGE;
  } catch {
    return FALLBACK_UI_LANGUAGE;
  }
}

export function resolveUiLanguageId(
  languages: readonly LanguageResource[],
  locale: string,
): number | undefined {
  const find = (name: string) =>
    languages.find((language) => language.name.toLowerCase() === name.toLowerCase());
  return (find(uiLanguageName(locale)) ?? find(FALLBACK_UI_LANGUAGE))?.id;
}

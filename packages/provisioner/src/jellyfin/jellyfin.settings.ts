import { valuesEqual } from '../http/provider-fields';
import {
  ENCODING_SAFEGUARDS,
  JELLYFIN_SERVER_SETTINGS,
  LIBRARY_ITEM_TYPES,
  METADATA_PROVIDER,
} from './jellyfin.constants';
import type {
  EncodingOptions,
  LibraryOptions,
  LibrarySpec,
  LibraryTypeOptions,
  ServerConfiguration,
} from './jellyfin.types';

export interface MetadataLocale {
  language: string;
  country?: string;
}

const LIBRARY_DRIFT_KEYS = [
  'Enabled',
  'EnableRealtimeMonitor',
  'EnableLUFSScan',
  'EnableChapterImageExtraction',
  'ExtractChapterImagesDuringLibraryScan',
  'EnableTrickplayImageExtraction',
  'ExtractTrickplayImagesDuringLibraryScan',
  'SaveTrickplayWithMedia',
  'AutomaticRefreshIntervalDays',
  'SaveLocalMetadata',
  'PreferredMetadataLanguage',
  'MetadataCountryCode',
] as const;

export function parseMetadataLocale(tag: string): MetadataLocale {
  const normalized = tag.trim().replace(/_/g, '-');
  try {
    const { language, region } = new Intl.Locale(normalized);
    return { language, ...(region ? { country: region } : {}) };
  } catch {
    throw new Error(`The interface language "${tag}" is not a valid language tag`);
  }
}

export function driftedKeys(
  current: Readonly<Record<string, unknown>>,
  desired: Readonly<Record<string, unknown>>,
): string[] {
  return Object.entries(desired)
    .filter(([key, value]) => !valuesEqual(current[key], value))
    .map(([key]) => key);
}

export function desiredServerSettings(
  uiCulture: string,
  locale: MetadataLocale,
): Partial<ServerConfiguration> {
  return {
    ...JELLYFIN_SERVER_SETTINGS,
    UICulture: uiCulture,
    PreferredMetadataLanguage: locale.language,
    ...(locale.country ? { MetadataCountryCode: locale.country } : {}),
  };
}

export function desiredEncodingSettings(): Partial<EncodingOptions> {
  return { ...ENCODING_SAFEGUARDS };
}

export function desiredTypeOptions(spec: LibrarySpec): LibraryTypeOptions[] {
  return LIBRARY_ITEM_TYPES[spec.collectionType].map((Type) => ({
    Type,
    MetadataFetchers: [METADATA_PROVIDER],
    ImageFetchers: [METADATA_PROVIDER],
  }));
}

export function buildLibraryOptions(spec: LibrarySpec, locale: MetadataLocale): LibraryOptions {
  return {
    Enabled: true,
    EnablePhotos: false,
    EnableRealtimeMonitor: true,
    EnableLUFSScan: false,
    EnableChapterImageExtraction: false,
    ExtractChapterImagesDuringLibraryScan: false,
    EnableTrickplayImageExtraction: false,
    ExtractTrickplayImagesDuringLibraryScan: false,
    SaveTrickplayWithMedia: false,
    PathInfos: [{ Path: spec.path }],
    SaveLocalMetadata: false,
    EnableInternetProviders: true,
    EnableAutomaticSeriesGrouping: true,
    EnableEmbeddedTitles: false,
    EnableEmbeddedExtrasTitles: false,
    EnableEmbeddedEpisodeInfos: false,
    AutomaticRefreshIntervalDays: 0,
    PreferredMetadataLanguage: locale.language,
    ...(locale.country ? { MetadataCountryCode: locale.country } : {}),
    SeasonZeroDisplayName: 'Specials',
    MetadataSavers: [],
    DisabledLocalMetadataReaders: [],
    LocalMetadataReaderOrder: ['Nfo'],
    DisabledSubtitleFetchers: [],
    SubtitleFetcherOrder: [],
    DisabledMediaSegmentProviders: [],
    MediaSegmentProviderOrder: [],
    SkipSubtitlesIfEmbeddedSubtitlesPresent: false,
    SkipSubtitlesIfAudioTrackMatches: false,
    SubtitleDownloadLanguages: [],
    RequirePerfectSubtitleMatch: true,
    SaveSubtitlesWithMedia: true,
    SaveLyricsWithMedia: false,
    DisabledLyricFetchers: [],
    LyricFetcherOrder: [],
    PreferNonstandardArtistsTag: false,
    UseCustomTagDelimiters: false,
    CustomTagDelimiters: [],
    DelimiterWhitelist: [],
    AutomaticallyAddToCollection: false,
    AllowEmbeddedSubtitles: 'AllowAll',
    TypeOptions: desiredTypeOptions(spec),
  };
}

function sameProviders(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return (
    left !== undefined && left.length === right.length && right.every((name) => left.includes(name))
  );
}

function typeOptionsDrift(current: LibraryOptions, spec: LibrarySpec): LibraryTypeOptions[] | null {
  const existing = current.TypeOptions ?? [];
  const desired = desiredTypeOptions(spec);
  const matches = desired.every((wanted) => {
    const entry = existing.find((candidate) => candidate.Type === wanted.Type);
    return (
      entry !== undefined &&
      sameProviders(entry.MetadataFetchers, wanted.MetadataFetchers) &&
      sameProviders(entry.ImageFetchers, wanted.ImageFetchers)
    );
  });
  if (matches) {
    return null;
  }
  const wantedTypes = desired.map(({ Type }) => Type);
  return [
    ...existing.filter((entry) => !wantedTypes.includes(entry.Type)),
    ...desired.map((wanted) => ({
      ...existing.find((entry) => entry.Type === wanted.Type),
      ...wanted,
    })),
  ];
}

export function correctLibraryOptions(
  current: LibraryOptions,
  spec: LibrarySpec,
  locale: MetadataLocale,
): { options: LibraryOptions; drifted: string[] } | null {
  const desired = buildLibraryOptions(spec, locale);
  const drifted: string[] = driftedKeys(
    current,
    Object.fromEntries(
      LIBRARY_DRIFT_KEYS.filter((key) => key in desired).map((key) => [key, desired[key]]),
    ),
  );
  const typeOptions = typeOptionsDrift(current, spec);
  if (drifted.length === 0 && typeOptions === null) {
    return null;
  }
  const corrections = Object.fromEntries(drifted.map((key) => [key, desired[key]]));
  return {
    options: { ...current, ...corrections, ...(typeOptions ? { TypeOptions: typeOptions } : {}) },
    drifted: typeOptions ? [...drifted, 'TypeOptions'] : drifted,
  };
}

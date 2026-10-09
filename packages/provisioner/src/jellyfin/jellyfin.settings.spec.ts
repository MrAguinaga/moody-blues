import { describe, expect, it } from 'vitest';

import {
  ENCODING_SAFEGUARDS,
  JELLYFIN_LIBRARIES,
  JELLYFIN_SERVER_SETTINGS,
} from './jellyfin.constants';
import {
  buildLibraryOptions,
  correctLibraryOptions,
  desiredEncodingSettings,
  desiredServerSettings,
  driftedKeys,
  parseMetadataLocale,
} from './jellyfin.settings';

const LOCALE = { language: 'es', country: 'MX' };
const EXTRACTION_FLAGS = [
  'EnableChapterImageExtraction',
  'ExtractChapterImagesDuringLibraryScan',
  'EnableTrickplayImageExtraction',
  'ExtractTrickplayImagesDuringLibraryScan',
  'SaveTrickplayWithMedia',
  'EnableLUFSScan',
] as const;

describe('parseMetadataLocale', () => {
  it('derives the language and the region from the interface language', () => {
    expect(parseMetadataLocale('es-MX')).toEqual({ language: 'es', country: 'MX' });
    expect(parseMetadataLocale('pt_BR')).toEqual({ language: 'pt', country: 'BR' });
  });

  it('leaves the country out when the tag has no region', () => {
    expect(parseMetadataLocale('es')).toEqual({ language: 'es' });
  });

  it('rejects a tag that is not a language', () => {
    expect(() => parseMetadataLocale('not a tag')).toThrow(/not a valid language tag/);
  });
});

describe('desiredServerSettings', () => {
  it('sets the name, the languages and the fixed security switches', () => {
    expect(desiredServerSettings('es-MX', LOCALE)).toEqual({
      ServerName: 'Moody Blues',
      UICulture: 'es-MX',
      PreferredMetadataLanguage: 'es',
      MetadataCountryCode: 'MX',
      EnableLegacyAuthorization: false,
      EnableMetrics: false,
    });
  });

  it('does not touch the country when the interface language has no region', () => {
    const settings = desiredServerSettings('es', { language: 'es' });

    expect(settings).not.toHaveProperty('MetadataCountryCode');
    expect(settings.PreferredMetadataLanguage).toBe('es');
  });

  it('keeps the constants as the single source of the fixed values', () => {
    expect(desiredServerSettings('es-MX', LOCALE)).toMatchObject(JELLYFIN_SERVER_SETTINGS);
  });
});

describe('ADR-014 encoding safeguards', () => {
  it('keeps the transcoding temp path in the bounded cache mount', () => {
    expect(desiredEncodingSettings().TranscodingTempPath).toBe('/cache/transcodes');
  });

  it('deletes delivered segments and throttles the transcoder', () => {
    const settings = desiredEncodingSettings();

    expect(settings.EnableSegmentDeletion).toBe(true);
    expect(settings.EnableThrottling).toBe(true);
    expect(settings.SegmentKeepSeconds).toBe(300);
  });

  it('writes nothing that depends on the transcoding mode', () => {
    expect(Object.keys(ENCODING_SAFEGUARDS).sort()).toEqual([
      'EnableSegmentDeletion',
      'EnableThrottling',
      'SegmentKeepSeconds',
      'TranscodingTempPath',
    ]);
  });
});

describe('buildLibraryOptions', () => {
  it.each(JELLYFIN_LIBRARIES)(
    'ADR-014: never extracts trickplay, chapter images or loudness in $name',
    (spec) => {
      const options = buildLibraryOptions(spec, LOCALE);

      for (const flag of EXTRACTION_FLAGS) {
        expect(options[flag]).toBe(false);
      }
    },
  );

  it('sends the complete option object with the metadata language and country', () => {
    const [movies] = JELLYFIN_LIBRARIES;
    const options = buildLibraryOptions(movies!, LOCALE);

    expect(options).toMatchObject({
      Enabled: true,
      EnableRealtimeMonitor: true,
      AutomaticRefreshIntervalDays: 0,
      PreferredMetadataLanguage: 'es',
      MetadataCountryCode: 'MX',
      PathInfos: [{ Path: '/data/media/movies' }],
      LocalMetadataReaderOrder: ['Nfo'],
      AllowEmbeddedSubtitles: 'AllowAll',
    });
    expect(Object.keys(options).length).toBeGreaterThan(40);
  });

  it('omits the country when the locale has none', () => {
    const options = buildLibraryOptions(JELLYFIN_LIBRARIES[0]!, { language: 'es' });

    expect(options).not.toHaveProperty('MetadataCountryCode');
  });

  it('keeps the screen grabber and embedded image extractors out of every item type', () => {
    for (const spec of JELLYFIN_LIBRARIES) {
      const typeOptions = buildLibraryOptions(spec, LOCALE).TypeOptions ?? [];

      expect(typeOptions.length).toBeGreaterThan(0);
      for (const entry of typeOptions) {
        expect(entry.ImageFetchers).toEqual(['TheMovieDb']);
        expect(entry.MetadataFetchers).toEqual(['TheMovieDb']);
      }
    }
    expect(
      (buildLibraryOptions(JELLYFIN_LIBRARIES[1]!, LOCALE).TypeOptions ?? []).map(
        (entry) => entry.Type,
      ),
    ).toEqual(['Series', 'Season', 'Episode']);
  });
});

describe('correctLibraryOptions', () => {
  const spec = JELLYFIN_LIBRARIES[0]!;

  it('reports nothing when the stored options match, even with extra server defaults', () => {
    const stored = {
      ...buildLibraryOptions(spec, LOCALE),
      SomethingNew: 'kept',
      TypeOptions: [
        {
          Type: 'Movie',
          MetadataFetchers: ['TheMovieDb'],
          ImageFetchers: ['TheMovieDb'],
          ImageOptions: [],
        },
      ],
    };

    expect(correctLibraryOptions(stored, spec, LOCALE)).toBeNull();
  });

  it('corrects only the drifted keys and forwards the rest untouched', () => {
    const stored = {
      ...buildLibraryOptions(spec, LOCALE),
      EnableTrickplayImageExtraction: true,
      PreferredMetadataLanguage: 'en',
      SubtitleDownloadLanguages: ['eng'],
    };

    const correction = correctLibraryOptions(stored, spec, LOCALE);

    expect(correction?.drifted).toEqual([
      'EnableTrickplayImageExtraction',
      'PreferredMetadataLanguage',
    ]);
    expect(correction?.options).toMatchObject({
      EnableTrickplayImageExtraction: false,
      PreferredMetadataLanguage: 'es',
      SubtitleDownloadLanguages: ['eng'],
    });
  });

  it('removes the screen grabber from a library that enabled it', () => {
    const stored = {
      ...buildLibraryOptions(spec, LOCALE),
      TypeOptions: [
        {
          Type: 'Movie',
          MetadataFetchers: ['TheMovieDb'],
          ImageFetchers: ['TheMovieDb', 'Screen Grabber'],
          ImageOptions: [{ Type: 'Primary', Limit: 1 }],
        },
        { Type: 'Other', MetadataFetchers: [], ImageFetchers: [] },
      ],
    };

    const correction = correctLibraryOptions(stored, spec, LOCALE);

    expect(correction?.drifted).toEqual(['TypeOptions']);
    expect(correction?.options.TypeOptions).toEqual([
      { Type: 'Other', MetadataFetchers: [], ImageFetchers: [] },
      {
        Type: 'Movie',
        MetadataFetchers: ['TheMovieDb'],
        ImageFetchers: ['TheMovieDb'],
        ImageOptions: [{ Type: 'Primary', Limit: 1 }],
      },
    ]);
  });
});

describe('driftedKeys', () => {
  it('lists the keys whose current value differs, including missing ones', () => {
    expect(driftedKeys({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3], c: true })).toEqual(['b', 'c']);
  });
});

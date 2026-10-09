import { describe, expect, it } from 'vitest';

import {
  buildLanguageProfile,
  languageProfilesEquivalent,
  mergeLanguageProfiles,
  toBazarrLanguageCodes,
  UnsupportedSubtitleLanguageError,
} from './bazarr.languages';

describe('toBazarrLanguageCodes', () => {
  it('maps the configured languages to Bazarr codes', () => {
    expect(toBazarrLanguageCodes(['es-419', 'es-ES', 'en'])).toEqual(['ea', 'es', 'en']);
  });

  it('drops duplicates that map to the same code', () => {
    expect(toBazarrLanguageCodes(['es-ES', 'es', 'en'])).toEqual(['es', 'en']);
  });

  it('rejects an unknown language', () => {
    expect(() => toBazarrLanguageCodes(['es-419', 'fr'])).toThrow(UnsupportedSubtitleLanguageError);
    expect(() => toBazarrLanguageCodes(['fr'])).toThrow(/"fr"/);
  });
});

describe('buildLanguageProfile', () => {
  it('builds the Spanish Latino profile for the default language', () => {
    expect(buildLanguageProfile(['es-419'])).toEqual({
      profileId: 1,
      name: 'Spanish Latino',
      items: [
        {
          id: 1,
          language: 'ea',
          audio_exclude: 'False',
          audio_only_include: 'False',
          hi: 'False',
          forced: 'False',
        },
      ],
      cutoff: 1,
      originalFormat: false,
      mustContain: [],
      mustNotContain: [],
      tag: null,
    });
  });

  it('numbers the items in configured order and points the cutoff at the first', () => {
    const profile = buildLanguageProfile(['es-419', 'es-ES', 'en']);

    expect(profile.items.map((item) => [item.id, item.language])).toEqual([
      [1, 'ea'],
      [2, 'es'],
      [3, 'en'],
    ]);
    expect(profile.cutoff).toBe(profile.items[0]?.id);
  });

  it('never uses JSON booleans inside the items', () => {
    const items = buildLanguageProfile(['es-419', 'en']).items;

    for (const item of items) {
      for (const field of ['audio_exclude', 'audio_only_include', 'hi', 'forced'] as const) {
        expect(typeof item[field]).toBe('string');
      }
    }
    expect(JSON.stringify(items)).not.toMatch(/:(true|false)/);
  });

  it('rejects unknown and empty language lists', () => {
    expect(() => buildLanguageProfile(['pt-BR'])).toThrow(UnsupportedSubtitleLanguageError);
    expect(() => buildLanguageProfile([])).toThrow(/At least one subtitle language/);
  });
});

describe('mergeLanguageProfiles', () => {
  it('keeps foreign profiles and replaces the one with the same id', () => {
    const stale = { ...buildLanguageProfile(['en']), name: 'Old' };
    const foreign = { ...buildLanguageProfile(['en']), profileId: 2, name: 'Mine' };
    const desired = buildLanguageProfile(['es-419']);

    expect(mergeLanguageProfiles([foreign, stale], desired)).toEqual([desired, foreign]);
  });

  it('adds the profile when none exists', () => {
    const desired = buildLanguageProfile(['es-419']);

    expect(mergeLanguageProfiles([], desired)).toEqual([desired]);
  });
});

describe('languageProfilesEquivalent', () => {
  it('ignores the representation Bazarr stores for originalFormat and empty tags', () => {
    const desired = buildLanguageProfile(['es-419']);
    const stored = { ...desired, originalFormat: 0, tag: null };

    expect(languageProfilesEquivalent(stored, desired)).toBe(true);
  });

  it('detects changed items, cutoff and name', () => {
    const desired = buildLanguageProfile(['es-419']);

    expect(languageProfilesEquivalent(buildLanguageProfile(['es-419', 'en']), desired)).toBe(false);
    expect(languageProfilesEquivalent({ ...desired, cutoff: 9 }, desired)).toBe(false);
    expect(languageProfilesEquivalent({ ...desired, name: 'Other' }, desired)).toBe(false);
  });
});

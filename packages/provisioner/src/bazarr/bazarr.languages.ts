import type { LanguageProfile, ProfileItem } from './bazarr.types';

export const SPANISH_LATINO_PROFILE_ID = 1;
export const SPANISH_LATINO_PROFILE_NAME = 'Spanish Latino';

const BAZARR_LANGUAGE_CODES: Readonly<Record<string, string>> = {
  'es-419': 'ea',
  'es-ES': 'es',
  es: 'es',
  en: 'en',
};

export class UnsupportedSubtitleLanguageError extends Error {
  constructor(readonly language: string) {
    super(
      `Subtitle language "${language}" has no Bazarr mapping; supported languages: ` +
        Object.keys(BAZARR_LANGUAGE_CODES).join(', '),
    );
    this.name = 'UnsupportedSubtitleLanguageError';
  }
}

export function toBazarrLanguageCodes(languages: readonly string[]): string[] {
  const codes = languages.map((language) => {
    const code = BAZARR_LANGUAGE_CODES[language];
    if (code === undefined) {
      throw new UnsupportedSubtitleLanguageError(language);
    }
    return code;
  });
  return [...new Set(codes)];
}

export function buildLanguageProfile(languages: readonly string[]): LanguageProfile {
  const codes = toBazarrLanguageCodes(languages);
  if (codes.length === 0) {
    throw new Error(
      'At least one subtitle language is required to build a Bazarr language profile',
    );
  }
  const items: ProfileItem[] = codes.map((language, index) => ({
    id: index + 1,
    language,
    audio_exclude: 'False',
    audio_only_include: 'False',
    hi: 'False',
    forced: 'False',
  }));
  return {
    profileId: SPANISH_LATINO_PROFILE_ID,
    name: SPANISH_LATINO_PROFILE_NAME,
    items,
    cutoff: 1,
    originalFormat: false,
    mustContain: [],
    mustNotContain: [],
    tag: null,
  };
}

export function mergeLanguageProfiles(
  existing: readonly LanguageProfile[],
  desired: LanguageProfile,
): LanguageProfile[] {
  const others = existing.filter((profile) => profile.profileId !== desired.profileId);
  return [desired, ...others].sort((left, right) => left.profileId - right.profileId);
}

function normalizeFlag(value: unknown): string {
  return typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
}

function normalizeProfile(profile: LanguageProfile): unknown {
  return {
    profileId: Number(profile.profileId),
    name: profile.name,
    items: [...profile.items]
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map((item) => ({
        id: Number(item.id),
        language: item.language,
        audio_exclude: normalizeFlag(item.audio_exclude),
        audio_only_include: normalizeFlag(item.audio_only_include),
        hi: normalizeFlag(item.hi),
        forced: normalizeFlag(item.forced),
      })),
    cutoff: profile.cutoff == null ? null : Number(profile.cutoff),
    originalFormat: Boolean(profile.originalFormat),
    mustContain: [...(profile.mustContain ?? [])],
    mustNotContain: [...(profile.mustNotContain ?? [])],
    tag: profile.tag || null,
  };
}

export function languageProfilesEquivalent(left: LanguageProfile, right: LanguageProfile): boolean {
  return JSON.stringify(normalizeProfile(left)) === JSON.stringify(normalizeProfile(right));
}

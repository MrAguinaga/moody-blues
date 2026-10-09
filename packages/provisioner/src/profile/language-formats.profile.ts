import {
  type CustomFormatDefinition,
  type ScoredFormat,
  type SpecificationDefinition,
  UnsupportedAudioPriorityError,
} from './profile.types';

// Sonarr matches custom format regular expressions against the whole release name, series title
// included, so a marker only counts after the year, the episode tag or the resolution.
const AFTER_TITLE = String.raw`(?<=\b(?:(?:19|20)\d{2}|S\d{1,3}(?:E\d{1,4})?|\d{1,2}x\d{2,4}|(?:480|576|720|1080|2160)[pi])\b.*)`;
const NOT_PRECEDED_BY_SUBS = String.raw`(?<!\bsub(?:s|titles?)?[ ._-]?)`;
const NOT_FOLLOWED_BY_SUBS = String.raw`(?![ ._-]?sub)`;

export const LATINO_RE =
  AFTER_TITLE +
  NOT_PRECEDED_BY_SUBS +
  String.raw`(?:\b(?:latino|latam|lat)\b|espa[ñn]ol[ ._-]?latino|spanish[ ._-]?\(?latino\)?|latin[ ._-]?(?:spanish|audio)|\bes[ ._-]?(?:419|la|mx)\b)`;

export const DUAL_MARKER_RE =
  AFTER_TITLE +
  String.raw`(?:\b(?:dual|multi|lat[ ._-]?eng|eng[ ._-]?lat|esp[ ._-]?lat|lat[ ._-]?esp)\b|` +
  NOT_PRECEDED_BY_SUBS +
  String.raw`\b(?:eng(?:lish)?|ingl[eé]s|original)\b` +
  NOT_FOLLOWED_BY_SUBS +
  ')';

export const CASTELLANO_RE =
  AFTER_TITLE +
  NOT_PRECEDED_BY_SUBS +
  String.raw`(?:\b(?:castellano|cast|esp|spa|spanish)\b|espa[ñn]ol(?![ ._-]?latino))` +
  NOT_FOLLOWED_BY_SUBS;

export const LANGUAGE_SCORE_STEP = 1000;

export const AUDIO_PRIORITY_SYMBOLS = ['es-419+original', 'es-419', 'original', 'es-ES'] as const;
export type AudioPrioritySymbol = (typeof AUDIO_PRIORITY_SYMBOLS)[number];

function title(name: string, pattern: string, negate = false): SpecificationDefinition {
  return {
    name,
    implementation: 'ReleaseTitleSpecification',
    negate,
    required: true,
    fields: { value: pattern },
  };
}

const LANGUAGE_FORMATS: Readonly<Record<AudioPrioritySymbol, CustomFormatDefinition>> = {
  'es-419+original': {
    name: 'Dual Latino',
    includeCustomFormatWhenRenaming: true,
    specifications: [title('Latino', LATINO_RE), title('Dual marker', DUAL_MARKER_RE)],
  },
  'es-419': {
    name: 'Latino',
    includeCustomFormatWhenRenaming: true,
    specifications: [title('Latino', LATINO_RE), title('Not dual', DUAL_MARKER_RE, true)],
  },
  original: {
    name: 'Original',
    includeCustomFormatWhenRenaming: false,
    specifications: [
      {
        name: 'Original language',
        implementation: 'LanguageSpecification',
        negate: false,
        required: true,
        fields: { value: { option: 'Original' }, exceptLanguage: false },
      },
      title('Not Latino', LATINO_RE, true),
    ],
  },
  'es-ES': {
    name: 'Castellano',
    includeCustomFormatWhenRenaming: true,
    specifications: [
      title('Castellano', CASTELLANO_RE),
      title('Not Latino', LATINO_RE, true),
      {
        name: 'Not original language',
        implementation: 'LanguageSpecification',
        negate: true,
        required: true,
        fields: { value: { option: 'Original' }, exceptLanguage: false },
      },
    ],
  },
};

function isSupported(symbol: string): symbol is AudioPrioritySymbol {
  return (AUDIO_PRIORITY_SYMBOLS as readonly string[]).includes(symbol);
}

export function buildLanguageFormats(audioPriority: readonly string[]): ScoredFormat[] {
  const seen = new Set<string>();
  return audioPriority.map((symbol, index) => {
    if (!isSupported(symbol)) {
      throw new UnsupportedAudioPriorityError(symbol, AUDIO_PRIORITY_SYMBOLS, 'unknown');
    }
    if (seen.has(symbol)) {
      throw new UnsupportedAudioPriorityError(symbol, AUDIO_PRIORITY_SYMBOLS, 'repeated');
    }
    seen.add(symbol);
    return {
      format: LANGUAGE_FORMATS[symbol],
      score: (audioPriority.length - index) * LANGUAGE_SCORE_STEP,
    };
  });
}

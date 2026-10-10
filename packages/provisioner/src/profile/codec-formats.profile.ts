import type { ArrKind } from '../arr/arr.types';
import { AFTER_TITLE } from './language-formats.profile';
import type { ScoredFormat, SpecificationDefinition } from './profile.types';

export const RESOLUTION_1080P_SCORE = 400;
export const REMUX_SCORE = -300;
export const FOREIGN_SUBTITLES_SCORE = -1500;
export const H264_SCORE = 150;
export const REPACK_SCORE = 5;
export const BLOCKING_SCORE = -10000;

// Spanish, English and Japanese are the owner's own languages and MultiSub names no language, so none of them appear here.
const FOREIGN_LANGUAGE = String.raw`(?:ita(?:lian[oa]?)?|fre(?:nch)?|fra|fr|ger(?:man)?|deu|rus(?:sian)?|ara(?:bic)?|por(?:tuguese)?|pt(?:[ ._-]?br)?|kor(?:ean)?|chi(?:nese)?|chs|cht|pol(?:ish)?|tur(?:kish)?|dut(?:ch)?|nld|swe|dan|nor|fin|hin(?:di)?|tha|vie|ind|heb|gre|cze|hun|rum|ukr|bul)`;
const SUBTITLES_WORD = String.raw`(?:hard)?sub(?:s|bed|titles?)?`;

// A bare language tag such as ITA is also an audio track in multi-audio releases, so a mark only counts next to the word "sub".
export const FOREIGN_SUBTITLES_RE =
  AFTER_TITLE +
  String.raw`(?:\b${FOREIGN_LANGUAGE}[ ._-]?${SUBTITLES_WORD}\b|\b${SUBTITLES_WORD}[ ._-]?${FOREIGN_LANGUAGE}\b|\bVOST(?:FR|A|IT|DE|RU|PT)\b)`;

const SOURCE_OPTIONS: Readonly<Record<ArrKind, { webDl: string; webRip: string }>> = {
  radarr: { webDl: 'WEBDL', webRip: 'WEBRIP' },
  sonarr: { webDl: 'Web', webRip: 'WebRip' },
};

function title(
  name: string,
  pattern: string,
  { negate = false, required = true } = {},
): SpecificationDefinition {
  return {
    name,
    implementation: 'ReleaseTitleSpecification',
    negate,
    required,
    fields: { value: pattern },
  };
}

function source(name: string, option: string): SpecificationDefinition {
  return {
    name,
    implementation: 'SourceSpecification',
    negate: false,
    required: false,
    fields: { value: { option } },
  };
}

// Sonarr has no quality modifier condition: its Remux is the BlurayRaw source.
const REMUX_SPECIFICATION: Readonly<Record<ArrKind, SpecificationDefinition>> = {
  radarr: {
    name: 'Remux',
    implementation: 'QualityModifierSpecification',
    negate: false,
    required: true,
    fields: { value: { option: 'REMUX' } },
  },
  sonarr: {
    name: 'Remux',
    implementation: 'SourceSpecification',
    negate: false,
    required: true,
    fields: { value: { option: 'BlurayRaw' } },
  },
};

export function buildCodecFormats(kind: ArrKind): ScoredFormat[] {
  const sources = SOURCE_OPTIONS[kind];
  return [
    {
      score: RESOLUTION_1080P_SCORE,
      format: {
        name: '1080p',
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: '1080p',
            implementation: 'ResolutionSpecification',
            negate: false,
            required: true,
            fields: { value: 1080 },
          },
        ],
      },
    },
    {
      score: REMUX_SCORE,
      format: {
        name: 'Remux',
        includeCustomFormatWhenRenaming: false,
        specifications: [REMUX_SPECIFICATION[kind]],
      },
    },
    {
      score: H264_SCORE,
      format: {
        name: 'H.264',
        includeCustomFormatWhenRenaming: false,
        specifications: [title('x264 or AVC', String.raw`\b(x|h)[ ._-]?264\b|\bAVC\b`)],
      },
    },
    {
      score: REPACK_SCORE,
      format: {
        name: 'Repack/Proper',
        includeCustomFormatWhenRenaming: false,
        specifications: [
          title('Repack or Proper', String.raw`\b(Repack|Proper|Rerip)\b`),
          title(
            'Not Repack2 or Proper2',
            String.raw`\b((repack|proper)[23])\b|\bREAL\.(REAL\.)?(PROPER|REPACK)\b`,
            {
              negate: true,
            },
          ),
        ],
      },
    },
    {
      score: FOREIGN_SUBTITLES_SCORE,
      format: {
        name: 'Subtítulos ajenos',
        includeCustomFormatWhenRenaming: false,
        specifications: [title('Foreign subtitles', FOREIGN_SUBTITLES_RE)],
      },
    },
    {
      score: BLOCKING_SCORE,
      format: {
        name: 'DV sin fallback HDR10',
        includeCustomFormatWhenRenaming: false,
        specifications: [
          title('Dolby Vision', String.raw`\b(dv|dovi|dolby[ .]?V(ision)?)\b`),
          source('WEBDL', sources.webDl),
          source('WEBRIP', sources.webRip),
          {
            name: 'Not Flights',
            implementation: 'ReleaseGroupSpecification',
            negate: true,
            required: true,
            fields: { value: String.raw`\b(Flights)\b` },
          },
          title('Not HDR', String.raw`\bHDR(\b|\d)`, { negate: true }),
          title('Not Hulu', String.raw`\b(hulu)\b`, { negate: true }),
        ],
      },
    },
    {
      score: BLOCKING_SCORE,
      format: {
        name: 'AV1',
        includeCustomFormatWhenRenaming: false,
        specifications: [title('AV1', String.raw`\bAV1\b`)],
      },
    },
  ];
}

import type { ArrKind } from '../arr/arr.types';
import type { ScoredFormat, SpecificationDefinition } from './profile.types';

export const H264_SCORE = 150;
export const REPACK_SCORE = 5;
export const BLOCKING_SCORE = -10000;

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

export function buildCodecFormats(kind: ArrKind): ScoredFormat[] {
  const sources = SOURCE_OPTIONS[kind];
  return [
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

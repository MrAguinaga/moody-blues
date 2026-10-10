import type { ReleaseResource, TitleResource } from '@moody-blues/provisioner';

import { normalizeText } from '../remove';
import type { CandidateSearch, RetryCandidate } from './retry.types';

const NOT_PARSED_REJECTIONS: readonly RegExp[] = [/^Unable to parse release/i, /^Unknown Series/i];
const HARMLESS_REJECTIONS: readonly RegExp[] = [/^Existing file on disk/i, /\bin queue\b/i];

const RESOLUTION = /(\d{3,4})p/;
const DEFAULT_RESOLUTION = 480;
const RAW_HD_RESOLUTION = 1080;
const RESOLUTION_STEP = 10;
const SOURCE_WEIGHTS: readonly (readonly [RegExp, number])[] = [
  [/remux/i, 6],
  [/blu-?ray/i, 5],
  [/web-?dl/i, 4],
  [/web-?rip/i, 3],
  [/hdtv|raw-hd/i, 2],
  [/dvd/i, 1],
];

export function qualityRank(name: string | undefined): number {
  if (!name || /^unknown$/i.test(name)) {
    return 0;
  }
  const resolution = /raw-hd/i.test(name)
    ? RAW_HD_RESOLUTION
    : Number(RESOLUTION.exec(name)?.[1] ?? DEFAULT_RESOLUTION);
  const source = SOURCE_WEIGHTS.find(([pattern]) => pattern.test(name))?.[1] ?? 0;
  return resolution * RESOLUTION_STEP + source;
}

function looseText(text: string): string {
  return ` ${normalizeText(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

export function namesOfSeries(series: TitleResource): string[] {
  return [series.title, series.originalTitle, ...(series.alternateTitles ?? []).map((a) => a.title)]
    .flatMap((name) => (name ? [name] : []))
    .filter((name, index, all) => all.indexOf(name) === index);
}

function mentionsSeries(release: ReleaseResource, names: readonly string[]): boolean {
  const title = looseText(release.title);
  return names.some((name) => title.includes(looseText(name)));
}

type Recognition = 'recognized' | 'unrecognized' | 'excluded';

function recognitionOf(release: ReleaseResource, names: readonly string[]): Recognition {
  const rejections = release.rejections ?? [];
  const notParsed = rejections.filter((reason) =>
    NOT_PARSED_REJECTIONS.some((pattern) => pattern.test(reason)),
  );
  const others = rejections.filter(
    (reason) =>
      !NOT_PARSED_REJECTIONS.some((pattern) => pattern.test(reason)) &&
      !HARMLESS_REJECTIONS.some((pattern) => pattern.test(reason)),
  );
  if (others.length > 0) {
    return 'excluded';
  }
  if (notParsed.length > 0) {
    return mentionsSeries(release, names) ? 'unrecognized' : 'excluded';
  }
  return release.fullSeason ? 'recognized' : 'excluded';
}

function compareCandidates(left: RetryCandidate, right: RetryCandidate): number {
  return (
    right.rank - left.rank ||
    right.score - left.score ||
    right.seeders - left.seeders ||
    left.release.title.localeCompare(right.release.title)
  );
}

export function classifyReleases(
  releases: readonly ReleaseResource[],
  names: readonly string[],
): CandidateSearch {
  const usable: Omit<RetryCandidate, 'position'>[] = [];
  let excluded = 0;

  for (const release of releases) {
    const recognition = recognitionOf(release, names);
    if (recognition === 'excluded') {
      excluded += 1;
      continue;
    }
    const qualityName = release.quality.quality.name;
    usable.push({
      release,
      qualityName,
      rank: qualityRank(qualityName),
      recognized: recognition === 'recognized',
      score: release.customFormatScore ?? 0,
      seeders: release.seeders ?? 0,
    });
  }

  const candidates = usable
    .map((candidate) => ({ position: 0, ...candidate }))
    .sort(compareCandidates)
    .map((candidate, index) => ({ ...candidate, position: index + 1 }));
  return { candidates, excluded };
}

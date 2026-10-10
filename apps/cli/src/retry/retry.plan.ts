import type { EpisodeFileResource, EpisodeResource } from '@moody-blues/provisioner';

import { qualityRank } from './retry.candidates';
import type {
  EpisodeDisposition,
  PackAssignment,
  PackMatch,
  RetryCandidate,
  RetryPlan,
  RetrySeason,
  RetryTarget,
} from './retry.types';

const VIDEO_EXTENSION = /\.(mkv|mp4|m4v|avi|ts|wmv|mov)$/i;
const BRACKETED = /\[[^\]]*\]|\([^)]*\)/g;
const SEASON_AND_EPISODE = /\bS\d{1,2}[ ._-]?E(\d{1,3})\b/i;
const DASHED_NUMBER = /\s-\s*(\d{1,3})(?:v\d)?(?=\s|$)/;
const EPISODE_WORD = /\bE(?:p|pisode)?[ ._]?(\d{1,3})(?:v\d)?\b/i;
const TRAILING_NUMBER = /[\s._](\d{2,3})(?:v\d)?\s*$/;
const LEADING_GROUP = /^\[([^\]]+)\]/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSION.test(path);
}

export function parseEpisodeNumber(path: string): number | undefined {
  const stem = basename(path).replace(VIDEO_EXTENSION, '');
  const clean = stem.replace(BRACKETED, ' ').replace(/\s+/g, ' ').trim();
  for (const pattern of [SEASON_AND_EPISODE, DASHED_NUMBER, EPISODE_WORD, TRAILING_NUMBER]) {
    const found = pattern.exec(clean)?.[1];
    if (found !== undefined) {
      return Number(found);
    }
  }
  return undefined;
}

export function releaseGroupOf(path: string): string | undefined {
  return LEADING_GROUP.exec(basename(path))?.[1];
}

export function matchPackFiles(
  paths: readonly string[],
  episodes: readonly EpisodeResource[],
): PackMatch {
  const byNumber = new Map(episodes.map((episode) => [episode.episodeNumber, episode]));
  const claims = new Map<number, string[]>();
  const ignored: string[] = [];

  for (const path of paths.filter(isVideoFile)) {
    const number = parseEpisodeNumber(path);
    if (number === undefined || !byNumber.has(number)) {
      ignored.push(path);
      continue;
    }
    claims.set(number, [...(claims.get(number) ?? []), path]);
  }

  const assignments: PackAssignment[] = [];
  const ambiguous: string[] = [];
  for (const [number, claimed] of [...claims].sort(([left], [right]) => left - right)) {
    const [path] = claimed;
    if (claimed.length > 1 || path === undefined) {
      ambiguous.push(...claimed);
      continue;
    }
    assignments.push({
      path,
      episode: byNumber.get(number) as EpisodeResource,
      releaseGroup: releaseGroupOf(path),
    });
  }
  return { assignments, ignored, ambiguous };
}

export function dispositionsFor(
  season: RetrySeason,
  files: readonly EpisodeFileResource[],
  candidate: RetryCandidate,
): EpisodeDisposition[] {
  const fileById = new Map(files.map((file) => [file.id, file]));
  return season.episodes.map((episode) => {
    const file =
      episode.hasFile && episode.episodeFileId !== undefined
        ? fileById.get(episode.episodeFileId)
        : undefined;
    if (!episode.hasFile) {
      return { episode, action: 'fill' };
    }
    const existingQuality = file?.quality?.quality.name;
    return {
      episode,
      action: qualityRank(existingQuality) < candidate.rank ? 'replace' : 'keep',
      existingQuality,
    };
  });
}

export function buildRetryPlan(
  target: RetryTarget,
  season: RetrySeason,
  files: readonly EpisodeFileResource[],
  candidate: RetryCandidate,
): RetryPlan {
  return { target, season, candidate, dispositions: dispositionsFor(season, files, candidate) };
}

export function countActions(plan: RetryPlan): Record<EpisodeDisposition['action'], number> {
  const counts = { fill: 0, replace: 0, keep: 0 };
  for (const { action } of plan.dispositions) {
    counts[action] += 1;
  }
  return counts;
}

export function replacedQualities(plan: RetryPlan): string[] {
  const names = plan.dispositions
    .filter(({ action }) => action === 'replace')
    .map(({ existingQuality }) => existingQuality ?? 'Unknown');
  return [...new Set(names)];
}

export function isWorthSending(plan: RetryPlan): boolean {
  const { fill, replace } = countActions(plan);
  return fill + replace > 0;
}

export function importableAssignments(plan: RetryPlan, match: PackMatch): PackAssignment[] {
  const wanted = new Set(
    plan.dispositions.filter(({ action }) => action !== 'keep').map(({ episode }) => episode.id),
  );
  return match.assignments.filter(({ episode }) => wanted.has(episode.id));
}

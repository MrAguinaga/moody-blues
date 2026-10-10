import { RECYCLE_BIN_CLEANUP_DAYS } from '@moody-blues/provisioner';

import type {
  RetryCandidate,
  RetryPlan,
  RetryResult,
  RetrySeason,
  RetryStepResult,
  RetryTarget,
} from '../retry';
import { countActions, replacedQualities } from '../retry';

const LABEL_WIDTH = 10;
const STEP_LABEL_WIDTH = 13;
const DETAIL_PREFIX = '   ↳';
const RELEASE_WIDTH = 56;

const STEP_MARKS: Record<RetryStepResult['status'], string> = {
  ok: '✔',
  failed: '✖',
  skipped: '-',
};

const STEP_LABELS: Record<RetryStepResult['id'], string> = {
  decypharr: 'Decypharr',
  verify: 'Verify',
  rollback: 'Rollback',
  sonarr: 'Sonarr',
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function row(label: string, text: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${text}`;
}

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

export function describeSeries({ title, year }: RetryTarget): string {
  return year ? `${title} (${year})` : title;
}

export function describeSeason(target: RetryTarget, season: RetrySeason): string {
  return `${describeSeries(target)} — season ${season.seasonNumber}, ${season.missing.length} of ${plural(season.episodes.length, 'episode')} missing`;
}

export function describeCandidate(candidate: RetryCandidate): string {
  const parsed = candidate.recognized ? 'parsed by Sonarr' : 'not parsed by Sonarr';
  return `${candidate.position}. ${truncate(candidate.release.title, RELEASE_WIDTH)} — ${candidate.qualityName}, score ${candidate.score}, ${plural(candidate.seeders, 'seed')}, ${parsed}`;
}

export function formatRetryCandidates(candidates: readonly RetryCandidate[]): string[] {
  const titles = candidates.map((candidate) => truncate(candidate.release.title, RELEASE_WIDTH));
  const qualities = candidates.map((candidate) => candidate.qualityName);
  const releaseWidth = Math.max('Release'.length, ...titles.map((title) => title.length));
  const qualityWidth = Math.max('Quality'.length, ...qualities.map((quality) => quality.length));
  const header = `  ${'#'.padStart(2)}  ${'Release'.padEnd(releaseWidth)}  ${'Quality'.padEnd(qualityWidth)}  Score  Seeds  Parsed`;
  return [
    header,
    ...candidates.map(
      (candidate, index) =>
        `  ${String(candidate.position).padStart(2)}  ${(titles[index] ?? '').padEnd(releaseWidth)}  ${(qualities[index] ?? '').padEnd(qualityWidth)}  ${String(candidate.score).padStart(5)}  ${String(candidate.seeders).padStart(5)}  ${candidate.recognized ? 'yes' : 'no'}`,
    ),
  ];
}

export function formatRetryPlan(plan: RetryPlan): string[] {
  const { fill, replace, keep } = countActions(plan);
  const qualities = replacedQualities(plan).join(', ');
  return [
    `Series: ${describeSeries(plan.target)}`,
    row('Release', `${plan.candidate.position}. ${plan.candidate.release.title}`),
    row(
      'Assign',
      `season ${plan.season.seasonNumber}, ${plural(plan.season.episodes.length, 'episode')} (${fill} new, ${replace} replaced, ${keep} kept)`,
    ),
    ...(replace > 0
      ? [
          row(
            'Replace',
            `${plural(replace, 'episode')} in ${qualities}; the recycle bin keeps the old files ${RECYCLE_BIN_CLEANUP_DAYS} days`,
          ),
        ]
      : []),
    ...(keep > 0
      ? [row('Keep', `${plural(keep, 'episode')} already have a file of equal or better quality`)]
      : []),
    row('Verify', 'every file is read through the mount first; if one fails nothing is replaced'),
  ];
}

export function formatRetryStep(step: RetryStepResult): string[] {
  return [
    `${STEP_MARKS[step.status]} ${STEP_LABELS[step.id].padEnd(STEP_LABEL_WIDTH)}${step.message}`,
    ...(step.details ?? []).map((detail) => `${DETAIL_PREFIX} ${detail}`),
    ...(step.status === 'failed' && step.hint ? [`${DETAIL_PREFIX} ${step.hint}`] : []),
  ];
}

export function formatRetrySummary(result: RetryResult): string[] {
  switch (result.outcome) {
    case 'imported':
      return [];
    case 'rejected':
      return ['✖ Decypharr rejected the release; the library was not touched.'];
    case 'unverified':
      return ['✖ The release did not pass the verification; the library was not touched.'];
    case 'failed':
      return ['✖ The import did not finish; check Sonarr (Activity > History).'];
  }
}

function targetJson(target: RetryTarget) {
  return {
    id: target.id,
    title: target.title,
    year: target.year ?? null,
    tvdbId: target.tvdbId ?? null,
  };
}

function seasonJson(season: RetrySeason) {
  return {
    number: season.seasonNumber,
    episodes: season.episodes.length,
    missing: season.missing.length,
  };
}

function candidateJson(candidate: RetryCandidate) {
  return {
    position: candidate.position,
    title: candidate.release.title,
    quality: candidate.qualityName,
    score: candidate.score,
    seeders: candidate.seeders,
    indexer: candidate.release.indexer ?? null,
    size: candidate.release.size ?? null,
    recognized: candidate.recognized,
  };
}

function planJson(plan: RetryPlan) {
  const counts = countActions(plan);
  return {
    release: plan.candidate.position,
    title: plan.candidate.release.title,
    episodes: plan.season.episodes.length,
    ...counts,
    replacedQualities: replacedQualities(plan),
    recycleBinDays: RECYCLE_BIN_CLEANUP_DAYS,
  };
}

export interface RetryJsonInput {
  target: RetryTarget;
  season: RetrySeason;
  candidates: readonly RetryCandidate[];
  excluded: number;
  plan?: RetryPlan;
  result?: RetryResult;
  message?: string;
}

export function toRetryJson(input: RetryJsonInput): Record<string, unknown> {
  const { target, season, candidates, excluded, plan, result, message } = input;
  return {
    success: result?.success ?? false,
    executed: result !== undefined,
    ...(message ? { error: message } : {}),
    target: targetJson(target),
    season: seasonJson(season),
    candidates: candidates.map(candidateJson),
    excluded,
    plan: plan ? planJson(plan) : null,
    result: result
      ? {
          outcome: result.outcome,
          imported: result.imported,
          steps: result.steps.map((step) => ({
            id: step.id,
            status: step.status,
            message: step.message,
            details: step.details ?? [],
            ...(step.hint ? { hint: step.hint } : {}),
          })),
        }
      : null,
  };
}

export function toRetryNothingJson(target: RetryTarget): Record<string, unknown> {
  return {
    success: true,
    executed: false,
    nothingToRetry: true,
    target: targetJson(target),
  };
}

export function toRetryRefusedJson(
  message: string,
  seasons: readonly number[] = [],
): Record<string, unknown> {
  return { success: false, executed: false, error: message, seasons: [...seasons] };
}

import type {
  RemovePlan,
  RemoveResult,
  RemoveStepResult,
  RemoveTarget,
  RemoveTorrent,
} from '../remove';

const LABEL_WIDTH = 16;
const STEP_LABEL_WIDTH = 13;
const DETAIL_PREFIX = '   ↳';

const STEP_MARKS: Record<RemoveStepResult['status'], string> = {
  ok: '✔',
  failed: '✖',
  skipped: '-',
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function row(label: string, text: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${text}`;
}

function continuation(text: string): string {
  return `  ${' '.repeat(LABEL_WIDTH)}${text}`;
}

function nameOf(torrent: RemoveTorrent): string {
  return torrent.name ?? torrent.infohash;
}

export function describeTarget({ title, year, kind }: RemoveTarget): string {
  return `${title}${year ? ` (${year})` : ''} — ${kind}`;
}

export function selectorFor(target: RemoveTarget): string {
  return target.kind === 'movie' ? `--movie ${target.tmdbId}` : `--series ${target.tvdbId}`;
}

function debridLines(plan: RemovePlan): string[] {
  const { torrents, kept, keepDebrid } = plan;
  const lines: string[] = [];
  if (torrents.length > 0) {
    lines.push(
      row('Real-Debrid', `${plural(torrents.length, 'torrent')} will be deleted`),
      ...torrents.map((torrent) => continuation(nameOf(torrent))),
    );
  } else if (keepDebrid) {
    lines.push(row('Real-Debrid', 'nothing will be deleted (--keep-debrid)'));
  } else {
    lines.push(row('Real-Debrid', 'no torrents in the download history of the title'));
  }
  if (kept.length > 0) {
    lines.push(
      row('Kept', `${plural(kept.length, 'torrent')} stay in Real-Debrid`),
      ...kept.map((torrent) => continuation(`${nameOf(torrent)} (${torrent.reason})`)),
    );
  }
  return lines;
}

export function formatRemovePlan(plan: RemovePlan): string[] {
  const { target } = plan;
  return [
    `Title: ${describeTarget(target)}`,
    ...(target.path ? [row('Folder', target.path)] : []),
    ...debridLines(plan),
    row('Seerr', 'the title becomes requestable again'),
  ];
}

export function formatRemoveCandidates(query: string, candidates: RemoveTarget[]): string[] {
  const width = Math.max(...candidates.map((candidate) => selectorFor(candidate).length));
  return [
    `${plural(candidates.length, 'title')} match "${query}"; repeat the command with one of these options:`,
    ...candidates.map(
      (candidate) => `  ${selectorFor(candidate).padEnd(width)}  ${describeTarget(candidate)}`,
    ),
  ];
}

function stepLabel(step: RemoveStepResult, plan: RemovePlan): string {
  if (step.id === 'library') {
    return plan.target.kind === 'movie' ? 'Radarr' : 'Sonarr';
  }
  return { decypharr: 'Decypharr', seerr: 'Seerr', jellyfin: 'Jellyfin' }[step.id];
}

export function formatRemoveStep(step: RemoveStepResult, plan: RemovePlan): string[] {
  return [
    `${STEP_MARKS[step.status]} ${stepLabel(step, plan).padEnd(STEP_LABEL_WIDTH)}${step.message}`,
    ...(step.details ?? []).map((detail) => `${DETAIL_PREFIX} ${detail}`),
    ...(step.status === 'failed' && step.hint ? [`${DETAIL_PREFIX} ${step.hint}`] : []),
  ];
}

export function formatRemoveSummary(result: RemoveResult): string[] {
  if (result.success) {
    return [];
  }
  if (!result.libraryDeleted) {
    return ['✖ The title was not deleted.'];
  }
  return [
    '✖ The title was deleted from the library, but a later step failed.',
    ...(result.pendingInfohashes.length > 0
      ? [`${DETAIL_PREFIX} Pending torrents: ${result.pendingInfohashes.join(', ')}`]
      : []),
  ];
}

export function formatRemoveResult(result: RemoveResult): string[] {
  return [
    ...result.steps.flatMap((step) => formatRemoveStep(step, result.plan)),
    ...formatRemoveSummary(result),
  ];
}

function targetJson(target: RemoveTarget) {
  return {
    kind: target.kind,
    id: target.id,
    title: target.title,
    year: target.year ?? null,
    path: target.path ?? null,
    tmdbId: target.tmdbId ?? null,
    tvdbId: target.tvdbId ?? null,
  };
}

export function toRemoveJson(
  plan: RemovePlan,
  result?: RemoveResult,
  message?: string,
): Record<string, unknown> {
  return {
    success: result?.success ?? false,
    executed: result !== undefined,
    ...(message ? { error: message } : {}),
    target: targetJson(plan.target),
    plan: {
      keepDebrid: plan.keepDebrid,
      torrents: plan.torrents.map((torrent) => ({
        infohash: torrent.infohash,
        name: torrent.name ?? null,
      })),
      kept: plan.kept.map((torrent) => ({
        infohash: torrent.infohash,
        name: torrent.name ?? null,
        reason: torrent.reason,
      })),
    },
    steps: (result?.steps ?? []).map((step) => ({
      id: step.id,
      status: step.status,
      message: step.message,
      details: step.details ?? [],
      ...(step.hint ? { hint: step.hint } : {}),
    })),
    pendingInfohashes: result?.pendingInfohashes ?? [],
  };
}

export function toRemoveRefusedJson(
  message: string,
  candidates: RemoveTarget[] = [],
): Record<string, unknown> {
  return {
    success: false,
    executed: false,
    error: message,
    candidates: candidates.map((candidate) => ({
      ...targetJson(candidate),
      selector: selectorFor(candidate),
    })),
  };
}

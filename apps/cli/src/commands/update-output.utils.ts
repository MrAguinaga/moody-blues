import type { ApplyUpdateResult, UpdateCheck, UpdateStepResult } from '../update';

export const CHANGELOG_MAX_LINES = 40;

const STEP_MARKS: Record<UpdateStepResult['status'], string> = {
  ok: '✔',
  failed: '✖',
  skipped: '-',
};

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatChangelog(body: string, url: string): string[] {
  const lines = body
    .replaceAll('\r', '')
    .split('\n')
    .map((line) => line.trimEnd());
  while (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return ['  (the release has no notes)'];
  }
  const shown = lines.slice(0, CHANGELOG_MAX_LINES).map((line) => `  ${line}`.trimEnd());
  const hidden = lines.length - shown.length;
  return hidden > 0
    ? [
        ...shown,
        `  … ${hidden} more line${hidden === 1 ? '' : 's'}${url ? `; full notes: ${url}` : ''}`,
      ]
    : shown;
}

export function formatCheck(check: UpdateCheck): string[] {
  const { latest, current } = check;
  if (!latest) {
    return [`✔ No release has been published yet. Moody Blues v${current} is up to date.`];
  }
  if (!check.updateAvailable) {
    return [`✔ Moody Blues v${current} is up to date (latest release: ${latest.tag}).`];
  }
  return [
    `Update available: v${current} -> ${latest.tag}`,
    ...(latest.url ? [`Release: ${latest.url}`] : []),
    '',
    'Changelog:',
    ...formatChangelog(latest.body, latest.url),
  ];
}

export function formatUpdateStart(title: string): string {
  return `${title}...`;
}

export function formatUpdateStep(step: UpdateStepResult): string[] {
  const detail = step.message ? ` — ${step.message}` : '';
  return [
    `      ${STEP_MARKS[step.status]} ${step.title}${detail} [${formatSeconds(step.durationMs)}]`,
  ];
}

export function toCheckJson(check: UpdateCheck): Record<string, unknown> {
  return {
    success: true,
    current: check.current,
    latest: check.latest?.tag ?? null,
    latestVersion: check.latest?.version ?? null,
    url: check.latest?.url ?? null,
    changelog: check.latest?.body ?? null,
    updateAvailable: check.updateAvailable,
    source: check.source,
    checkedAt: check.checkedAt,
  };
}

export function toApplyJson(
  check: UpdateCheck,
  result?: ApplyUpdateResult,
  error?: string,
): Record<string, unknown> {
  return {
    success: error === undefined && (result?.success ?? true),
    current: check.current,
    target: check.latest?.version ?? null,
    updated: result?.codeUpdated ?? false,
    redeployed: result?.redeployed ?? false,
    rolledBack: result?.rolledBack ?? false,
    steps: result?.steps ?? [],
    ...(error ? { error } : {}),
  };
}

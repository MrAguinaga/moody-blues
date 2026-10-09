import type { DoctorCounts, DoctorReport, DoctorResult, DoctorStatus, FixOutcome } from '../doctor';

const BADGES: Record<DoctorStatus, string> = {
  ok: '[OK]',
  warning: '[WARN]',
  error: '[FAIL]',
  skipped: '[SKIP]',
};

const DETAIL_PREFIX = '   ↳';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function formatDoctorLines(result: DoctorResult): string[] {
  const lines = [`${BADGES[result.status]} ${result.name} — ${result.message}`];
  result.details?.forEach((detail) => lines.push(`${DETAIL_PREFIX} ${detail}`));
  if (result.suggestion && (result.status === 'warning' || result.status === 'error')) {
    lines.push(`${DETAIL_PREFIX} Suggestion: ${result.suggestion}`);
  }
  return lines;
}

export function formatDoctorSummary(counts: DoctorCounts): string {
  if (counts.error > 0) {
    const parts = [
      plural(counts.error, 'error'),
      plural(counts.warning, 'warning'),
      `${counts.ok} ok`,
      ...(counts.skipped > 0 ? [`${counts.skipped} skipped`] : []),
    ];
    return `✖ ${parts.join(', ')}.`;
  }
  if (counts.warning > 0) {
    return `⚠ ${plural(counts.warning, 'warning')}, no errors.`;
  }
  return '✔ All checks passed.';
}

function pendingLine(outcome: FixOutcome): string[] {
  return outcome.pending > 0
    ? [
        `${DETAIL_PREFIX} ${plural(outcome.pending, 'more stuck download')} remain; run the command again to handle them`,
      ]
    : [];
}

export function formatFixLines(outcome: FixOutcome): string[] {
  if (!outcome.applied && outcome.removed === 0 && outcome.failed.length === 0) {
    return [
      `Fix not applied: ${outcome.note ?? 'nothing was removed.'}`,
      ...outcome.items.map((item) => `${DETAIL_PREFIX} ${item}`),
      ...pendingLine(outcome),
    ];
  }

  return [
    `Fix applied: ${plural(outcome.removed, 'stuck download')} removed and blocklisted.`,
    ...outcome.items.map((item) => `${DETAIL_PREFIX} ${item}`),
    ...outcome.failed.map((failure) => `${DETAIL_PREFIX} Failed: ${failure}`),
    ...pendingLine(outcome),
    `${DETAIL_PREFIX} Decypharr re-insertions in the window: ${outcome.reinsertionsBefore} before, ${outcome.reinsertionsAfter} after${outcome.loopStopped ? '' : ' (the loop is still active)'}`,
  ];
}

export function toDoctorJson(report: DoctorReport): Record<string, unknown> {
  return {
    timestamp: report.timestamp,
    version: report.version,
    home: report.home,
    success: report.success,
    counts: report.counts,
    checks: report.checks.map((check) => ({
      id: check.id,
      name: check.name,
      status: check.status,
      message: check.message,
      details: check.details ?? [],
      ...(check.suggestion ? { suggestion: check.suggestion } : {}),
      fixable: check.fixable === true,
    })),
    fixes: report.fixes,
  };
}

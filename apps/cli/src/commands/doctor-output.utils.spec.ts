import { describe, expect, it } from 'vitest';

import type { DoctorReport, DoctorResult } from '../doctor';
import { TEST_KEYS } from '../doctor/doctor-context.testing';
import {
  formatDoctorLines,
  formatDoctorSummary,
  formatFixLines,
  toDoctorJson,
} from './doctor-output.utils';

const result = (overrides: Partial<DoctorResult> = {}): DoctorResult => ({
  id: 'containers',
  name: 'Containers',
  status: 'ok',
  message: '9 of 9 services are healthy',
  ...overrides,
});

describe('formatDoctorLines', () => {
  it.each([
    ['ok', '[OK]'],
    ['warning', '[WARN]'],
    ['error', '[FAIL]'],
    ['skipped', '[SKIP]'],
  ] as const)('marks %s with %s', (status, badge) => {
    expect(formatDoctorLines(result({ status }))[0]).toBe(
      `${badge} Containers — 9 of 9 services are healthy`,
    );
  });

  it('prints the details and the suggestion of a failure', () => {
    const lines = formatDoctorLines(
      result({
        id: 'stuck-downloads',
        name: 'Stuck downloads',
        status: 'error',
        message: '1 download has been stuck for more than 10 minutes',
        details: [
          'radarr #12 "Big.Buck.Bunny.2008.1080p.BluRay.x264-GRP" importPending for 34 min: Unable to parse file',
        ],
        suggestion:
          'Run "moody-blues doctor --fix" to remove it, blocklist the release and search for another one.',
      }),
    );

    expect(lines).toEqual([
      '[FAIL] Stuck downloads — 1 download has been stuck for more than 10 minutes',
      '   ↳ radarr #12 "Big.Buck.Bunny.2008.1080p.BluRay.x264-GRP" importPending for 34 min: Unable to parse file',
      '   ↳ Suggestion: Run "moody-blues doctor --fix" to remove it, blocklist the release and search for another one.',
    ]);
  });

  it('does not print the suggestion of an ok or skipped check', () => {
    expect(formatDoctorLines(result({ suggestion: 'Choose hardware' }))).toHaveLength(1);
    expect(formatDoctorLines(result({ status: 'skipped', suggestion: 'x' }))).toHaveLength(1);
  });
});

describe('formatDoctorSummary', () => {
  it('summarizes a clean run', () => {
    expect(formatDoctorSummary({ ok: 15, warning: 0, error: 0, skipped: 6 })).toBe(
      '✔ All checks passed.',
    );
  });

  it('summarizes warnings without errors', () => {
    expect(formatDoctorSummary({ ok: 10, warning: 2, error: 0, skipped: 0 })).toBe(
      '⚠ 2 warnings, no errors.',
    );
    expect(formatDoctorSummary({ ok: 10, warning: 1, error: 0, skipped: 0 })).toBe(
      '⚠ 1 warning, no errors.',
    );
  });

  it('summarizes errors with warnings and ok', () => {
    expect(formatDoctorSummary({ ok: 19, warning: 1, error: 1, skipped: 0 })).toBe(
      '✖ 1 error, 1 warning, 19 ok.',
    );
    expect(formatDoctorSummary({ ok: 12, warning: 0, error: 2, skipped: 6 })).toBe(
      '✖ 2 errors, 0 warnings, 12 ok, 6 skipped.',
    );
  });
});

describe('formatFixLines', () => {
  it('describes an applied fix', () => {
    const lines = formatFixLines({
      id: 'remove-stuck-downloads',
      applied: true,
      removed: 2,
      failed: ['radarr #3: boom'],
      items: ['radarr #12', 'sonarr #4'],
      pending: 0,
      reinsertionsBefore: 6,
      reinsertionsAfter: 6,
      loopStopped: true,
    });

    expect(lines).toEqual([
      'Fix applied: 2 stuck downloads removed and blocklisted.',
      '   ↳ radarr #12',
      '   ↳ sonarr #4',
      '   ↳ Failed: radarr #3: boom',
      '   ↳ Decypharr re-insertions in the window: 6 before, 6 after',
    ]);
  });

  it('flags a loop that is still active', () => {
    const lines = formatFixLines({
      id: 'remove-stuck-downloads',
      applied: true,
      removed: 1,
      failed: [],
      items: ['radarr #12'],
      pending: 0,
      reinsertionsBefore: 2,
      reinsertionsAfter: 5,
      loopStopped: false,
    });

    expect(lines.at(-1)).toContain('(the loop is still active)');
  });

  it('tells how many stuck downloads remain after the limit', () => {
    const lines = formatFixLines({
      id: 'remove-stuck-downloads',
      applied: true,
      removed: 10,
      failed: [],
      items: ['radarr #1'],
      pending: 3,
      reinsertionsBefore: 0,
      reinsertionsAfter: 0,
      loopStopped: true,
    });

    expect(lines).toContain(
      '   ↳ 3 more stuck downloads remain; run the command again to handle them',
    );
  });

  it('describes a fix that was not applied', () => {
    const lines = formatFixLines({
      id: 'remove-stuck-downloads',
      applied: false,
      removed: 0,
      failed: [],
      items: ['radarr #12'],
      pending: 0,
      reinsertionsBefore: 0,
      reinsertionsAfter: 0,
      loopStopped: false,
      note: 'Confirmation is required: pass --yes to apply the fix without a terminal.',
    });

    expect(lines).toEqual([
      'Fix not applied: Confirmation is required: pass --yes to apply the fix without a terminal.',
      '   ↳ radarr #12',
    ]);
  });
});

describe('toDoctorJson', () => {
  const report: DoctorReport = {
    timestamp: '2026-10-09T15:04:05.000Z',
    version: '0.1.0',
    home: '/opt/moody-blues',
    success: false,
    counts: { ok: 1, warning: 0, error: 1, skipped: 0 },
    checks: [
      result(),
      result({
        id: 'stuck-downloads',
        name: 'Stuck downloads',
        status: 'error',
        message: '1 download has been stuck for more than 10 minutes',
        details: ['radarr #12 "Big.Buck.Bunny" importPending for 34 min'],
        suggestion: 'Run "moody-blues doctor --fix" to remove it.',
        fixable: true,
        stuckItems: [
          {
            app: 'radarr',
            queueId: 12,
            title: 'Big.Buck.Bunny',
            state: 'importPending',
            ageMinutes: 34,
          },
        ],
      }),
    ],
    fixes: [],
  };

  it('has exactly the documented shape and keeps the order of the checks', () => {
    expect(toDoctorJson(report)).toEqual({
      timestamp: '2026-10-09T15:04:05.000Z',
      version: '0.1.0',
      home: '/opt/moody-blues',
      success: false,
      counts: { ok: 1, warning: 0, error: 1, skipped: 0 },
      checks: [
        {
          id: 'containers',
          name: 'Containers',
          status: 'ok',
          message: '9 of 9 services are healthy',
          details: [],
          fixable: false,
        },
        {
          id: 'stuck-downloads',
          name: 'Stuck downloads',
          status: 'error',
          message: '1 download has been stuck for more than 10 minutes',
          details: ['radarr #12 "Big.Buck.Bunny" importPending for 34 min'],
          suggestion: 'Run "moody-blues doctor --fix" to remove it.',
          fixable: true,
        },
      ],
      fixes: [],
    });
  });

  it('never carries the internal list of stuck items', () => {
    expect(JSON.stringify(toDoctorJson(report))).not.toContain('stuckItems');
  });

  it('includes the outcome of a fix', () => {
    const outcome = {
      id: 'remove-stuck-downloads' as const,
      applied: true,
      removed: 1,
      failed: [],
      items: ['radarr #12'],
      pending: 0,
      reinsertionsBefore: 6,
      reinsertionsAfter: 6,
      loopStopped: true,
    };

    expect(toDoctorJson({ ...report, fixes: [outcome] }).fixes).toEqual([outcome]);
  });

  it('serializes to JSON without any known secret', () => {
    const text = JSON.stringify(toDoctorJson(report));

    for (const secret of Object.values(TEST_KEYS)) {
      expect(text).not.toContain(secret);
    }
  });
});

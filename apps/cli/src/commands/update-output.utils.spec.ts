import { describe, expect, it } from 'vitest';

import type { ApplyUpdateResult, UpdateCheck } from '../update';
import {
  CHANGELOG_MAX_LINES,
  formatChangelog,
  formatCheck,
  formatUpdateStart,
  formatUpdateStep,
  toApplyJson,
  toCheckJson,
} from './update-output.utils';

const AVAILABLE: UpdateCheck = {
  current: '0.1.0',
  latest: {
    tag: 'v0.2.0',
    version: '0.2.0',
    url: 'https://example.test/v0.2.0',
    body: '## Changes\n- One\n- Two',
  },
  updateAvailable: true,
  source: 'github',
  checkedAt: '2026-10-10T12:00:00.000Z',
};

describe('update output', () => {
  it('prints the available update with its release link and changelog', () => {
    expect(formatCheck(AVAILABLE)).toEqual([
      'Update available: v0.1.0 -> v0.2.0',
      'Release: https://example.test/v0.2.0',
      '',
      'Changelog:',
      '  ## Changes',
      '  - One',
      '  - Two',
    ]);
  });

  it('says up to date, with and without a published release', () => {
    expect(formatCheck({ ...AVAILABLE, current: '0.2.0', updateAvailable: false })).toEqual([
      '✔ Moody Blues v0.2.0 is up to date (latest release: v0.2.0).',
    ]);
    expect(
      formatCheck({
        current: '0.1.0',
        updateAvailable: false,
        source: 'github',
        checkedAt: AVAILABLE.checkedAt,
      }),
    ).toEqual(['✔ No release has been published yet. Moody Blues v0.1.0 is up to date.']);
  });

  it('truncates a long changelog and points to the full notes', () => {
    const body = Array.from(
      { length: CHANGELOG_MAX_LINES + 3 },
      (_, index) => `- item ${index}`,
    ).join('\n');

    const lines = formatChangelog(body, 'https://example.test/r');

    expect(lines).toHaveLength(CHANGELOG_MAX_LINES + 1);
    expect(lines.at(-1)).toBe('  … 3 more lines; full notes: https://example.test/r');
  });

  it('handles an empty changelog and Windows line endings', () => {
    expect(formatChangelog('', '')).toEqual(['  (the release has no notes)']);
    expect(formatChangelog('- a\r\n- b\r\n', '')).toEqual(['  - a', '  - b']);
  });

  it('formats the progress of a step', () => {
    expect(formatUpdateStart('Install dependencies')).toBe('Install dependencies...');
    expect(
      formatUpdateStep({
        id: 'install',
        title: 'Install dependencies',
        status: 'ok',
        durationMs: 1234,
      }),
    ).toEqual(['      ✔ Install dependencies [1.2s]']);
    expect(
      formatUpdateStep({
        id: 'build',
        title: 'Build',
        status: 'failed',
        message: 'tsup exploded',
        durationMs: 500,
      }),
    ).toEqual(['      ✖ Build — tsup exploded [0.5s]']);
  });

  it('serializes the check', () => {
    expect(toCheckJson(AVAILABLE)).toEqual({
      success: true,
      current: '0.1.0',
      latest: 'v0.2.0',
      latestVersion: '0.2.0',
      url: 'https://example.test/v0.2.0',
      changelog: '## Changes\n- One\n- Two',
      updateAvailable: true,
      source: 'github',
      checkedAt: '2026-10-10T12:00:00.000Z',
    });
    expect(toCheckJson({ ...AVAILABLE, latest: undefined, updateAvailable: false })).toMatchObject({
      latest: null,
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it('serializes the result of an update and its refusal', () => {
    const result: ApplyUpdateResult = {
      success: true,
      codeUpdated: true,
      redeployed: true,
      rolledBack: false,
      steps: [{ id: 'build', title: 'Build', status: 'ok', durationMs: 10 }],
    };

    expect(toApplyJson(AVAILABLE, result)).toMatchObject({
      success: true,
      target: '0.2.0',
      updated: true,
      redeployed: true,
      steps: [{ id: 'build' }],
    });
    expect(toApplyJson(AVAILABLE, undefined, 'Pass --yes to update.')).toMatchObject({
      success: false,
      updated: false,
      error: 'Pass --yes to update.',
    });
    expect(toApplyJson({ ...AVAILABLE, updateAvailable: false })).toMatchObject({
      success: true,
      updated: false,
    });
  });
});

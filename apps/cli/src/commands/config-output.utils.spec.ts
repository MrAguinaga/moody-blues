import { describe, expect, it } from 'vitest';

import type { ConfigPlanView, ConfigRunReport, SettingView } from '../config';
import {
  formatPlanLines,
  formatSettingsLines,
  toConfigRefusedJson,
  toConfigRunJson,
  toSettingsJson,
} from './config-output.utils';

const SETTINGS: SettingView[] = [
  { key: 'transcoding', value: 'off', allowed: ['off', 'cpu', 'hardware'], writable: true },
  { key: 'quality-cap', value: '1080p', allowed: ['1080p'], writable: false },
];

const PLAN: ConfigPlanView = {
  key: 'transcoding',
  previous: 'off',
  value: 'cpu',
  stepIds: ['persist-state', 'jellyfin-transcoding'],
  disruptive: false,
  notes: ['CPU transcoding is selected and no GPU was found; the CPU may saturate'],
};

const REPORT: ConfigRunReport = {
  success: true,
  key: 'transcoding',
  previous: 'off',
  value: 'cpu',
  changed: true,
  steps: ['persist-state', 'jellyfin-transcoding'],
  pipeline: {
    scope: 'config',
    success: true,
    aborted: false,
    steps: [
      {
        id: 'persist-state',
        title: 'Persist installation state',
        status: 'changed',
        durationMs: 3,
      },
    ],
  },
};

describe('formatSettingsLines', () => {
  it('prints the value and the allowed values of a writable setting', () => {
    const [transcoding] = formatSettingsLines(SETTINGS);

    expect(transcoding).toBe('  transcoding  off    off | cpu | hardware');
  });

  it('describes the read-only setting instead of listing its values', () => {
    const [, qualityCap] = formatSettingsLines(SETTINGS);

    expect(qualityCap).toBe(
      '  quality-cap  1080p  read-only in this version (4K arrives in 0.2.0)',
    );
  });

  it('prints one line per setting', () => {
    expect(formatSettingsLines(SETTINGS.slice(0, 1))).toHaveLength(1);
  });
});

describe('toSettingsJson', () => {
  it('has the exact shape of the query', () => {
    expect(toSettingsJson(SETTINGS)).toEqual({
      settings: [
        {
          key: 'transcoding',
          value: 'off',
          allowed: ['off', 'cpu', 'hardware'],
          writable: true,
        },
        { key: 'quality-cap', value: '1080p', allowed: ['1080p'], writable: false },
      ],
    });
  });
});

describe('formatPlanLines', () => {
  it('prints the change, the affected steps and the notes', () => {
    expect(formatPlanLines(PLAN)).toEqual([
      'transcoding: off -> cpu',
      'Affected steps: persist-state, jellyfin-transcoding',
      '⚠ CPU transcoding is selected and no GPU was found; the CPU may saturate',
    ]);
  });
});

describe('toConfigRunJson', () => {
  it('has the exact keys of the change with the full pipeline report', () => {
    const json = toConfigRunJson(REPORT);

    expect(Object.keys(json)).toEqual([
      'success',
      'key',
      'previous',
      'value',
      'changed',
      'steps',
      'pipeline',
    ]);
    expect(json.pipeline).toBe(REPORT.pipeline);
  });
});

describe('toConfigRefusedJson', () => {
  it('describes what would have run without a pipeline', () => {
    expect(toConfigRefusedJson(PLAN, 'needs --yes')).toEqual({
      success: false,
      key: 'transcoding',
      previous: 'off',
      value: 'cpu',
      changed: true,
      steps: ['persist-state', 'jellyfin-transcoding'],
      error: 'needs --yes',
    });
  });
});

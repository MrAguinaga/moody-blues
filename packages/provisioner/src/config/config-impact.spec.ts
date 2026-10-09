import { describe, expect, it } from 'vitest';

import { PROVISIONING_PIPELINE } from '../pipeline/provisioning.pipeline';
import { createDefaultConfig } from './config.defaults';
import { TRANSCODING_MODES, type TranscodingMode } from './config.types';
import { CONFIG_KEYS, type ConfigChange, type ConfigKey, planConfigChange } from './config-impact';

const SAFE_STEP_IDS = [
  'persist-state',
  'containers-up',
  'wait-healthy',
  'jellyfin-transcoding',
  'master-profile',
];

const transcoding = (from: TranscodingMode, to: TranscodingMode): ConfigChange => ({
  key: 'transcoding',
  value: to,
  current: createDefaultConfig({ transcoding: from }),
  next: createDefaultConfig({ transcoding: to }),
});

const qualityCap = (): ConfigChange => ({
  key: 'quality-cap',
  value: '1080p',
  current: createDefaultConfig(),
  next: createDefaultConfig(),
});

const allChanges = (): ConfigChange[] => [
  ...TRANSCODING_MODES.flatMap((from) => TRANSCODING_MODES.map((to) => transcoding(from, to))),
  qualityCap(),
];

describe('planConfigChange', () => {
  it.each([
    ['off', 'cpu'],
    ['cpu', 'off'],
    ['off', 'off'],
    ['cpu', 'cpu'],
  ] as const)('applies transcoding %s to %s with the playback policy only', (from, to) => {
    const plan = planConfigChange(transcoding(from, to));

    expect(plan.stepIds).toEqual(['persist-state', 'jellyfin-transcoding']);
    expect(plan.disruptive).toBe(false);
    expect(plan.disruption).toBeUndefined();
    expect(plan.preconditions).toEqual(['jellyfin-running']);
  });

  it.each([
    ['off', 'hardware'],
    ['cpu', 'hardware'],
  ] as const)('recreates Jellyfin when moving from %s to %s', (from, to) => {
    const plan = planConfigChange(transcoding(from, to));

    expect(plan.stepIds).toEqual([
      'persist-state',
      'containers-up',
      'wait-healthy',
      'jellyfin-transcoding',
    ]);
    expect(plan.disruptive).toBe(true);
    expect(plan.disruption).toMatch(/playback sessions will be interrupted/);
    expect(plan.preconditions).toEqual(['gpu']);
  });

  it.each([
    ['hardware', 'off'],
    ['hardware', 'cpu'],
  ] as const)('recreates Jellyfin when moving from %s to %s without needing a GPU', (from, to) => {
    const plan = planConfigChange(transcoding(from, to));

    expect(plan.stepIds).toContain('containers-up');
    expect(plan.disruptive).toBe(true);
    expect(plan.preconditions).toEqual([]);
  });

  it('reapplies hardware to hardware in place and still requires the GPU', () => {
    const plan = planConfigChange(transcoding('hardware', 'hardware'));

    expect(plan.stepIds).toEqual(['persist-state', 'jellyfin-transcoding']);
    expect(plan.disruptive).toBe(false);
    expect(plan.preconditions).toEqual(['gpu', 'jellyfin-running']);
  });

  it('notes that off keeps remux and audio conversion', () => {
    expect(planConfigChange(transcoding('cpu', 'off')).warnings).toEqual([
      expect.stringMatching(/never re-encoded.*remux and audio transcoding are allowed/),
    ]);
    expect(planConfigChange(transcoding('off', 'cpu')).warnings).toEqual([]);
  });

  it('reapplies the master profile for quality-cap', () => {
    expect(planConfigChange(qualityCap())).toEqual({
      stepIds: ['persist-state', 'master-profile'],
      disruptive: false,
      preconditions: ['arr-running'],
      warnings: [],
    });
  });

  it('only plans safe steps that exist in the pipeline with the config scope', () => {
    const pipelineScopes = new Map(PROVISIONING_PIPELINE.map((step) => [step.id, step.scopes]));

    for (const change of allChanges()) {
      const { stepIds } = planConfigChange(change);
      for (const id of stepIds) {
        expect(SAFE_STEP_IDS).toContain(id);
        expect(pipelineScopes.get(id)).toContain('config');
      }
      expect(
        stepIds.filter((id) => /^(host-tree|seed-|ensure-env|reset-|gateway-)/.test(id)),
      ).toEqual([]);
    }
  });

  it('plans containers-up and wait-healthy only when hardware is crossed', () => {
    for (const change of allChanges()) {
      const crosses =
        change.key === 'transcoding' &&
        (change.current.transcoding === 'hardware') !== (change.next.transcoding === 'hardware');
      const { stepIds } = planConfigChange(change);

      expect(stepIds.includes('containers-up')).toBe(crosses);
      expect(stepIds.includes('wait-healthy')).toBe(crosses);
    }
  });

  it('plans persist-state first for every key', () => {
    const keys = new Set<ConfigKey>();
    for (const change of allChanges()) {
      keys.add(change.key);
      expect(planConfigChange(change).stepIds[0]).toBe('persist-state');
    }
    expect([...keys].sort()).toEqual([...CONFIG_KEYS].sort());
  });
});

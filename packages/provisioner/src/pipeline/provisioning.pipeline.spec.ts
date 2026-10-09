import { describe, expect, it } from 'vitest';

import { insertSteps } from './compose-pipeline';
import type { ProvisionStep } from './pipeline.types';
import { PROVISIONING_PIPELINE } from './provisioning.pipeline';

function step(id: string): ProvisionStep {
  return { id, title: id, scopes: ['setup'], run: async () => ({ status: 'unchanged' }) };
}

describe('PROVISIONING_PIPELINE', () => {
  it('places the seed steps before containers-up and the service provisioning steps last', () => {
    expect(PROVISIONING_PIPELINE.map((entry) => entry.id)).toEqual([
      'host-tree',
      'persist-state',
      'ensure-env',
      'gateway-config',
      'seed-arr-config',
      'seed-bazarr-config',
      'seed-decypharr-config',
      'containers-up',
      'wait-healthy',
      'gateway-reload',
      'jellyfin-provision',
      'sonarr-provision',
      'radarr-provision',
      'master-profile',
      'prowlarr-provision',
      'bazarr-provision',
      'decypharr-verify',
      'seerr-provision',
    ]);
  });

  it('has unique step ids', () => {
    const ids = PROVISIONING_PIPELINE.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('insertSteps', () => {
  const base = [step('a'), step('b'), step('c')];
  const ids = (steps: readonly ProvisionStep[]) => steps.map((entry) => entry.id);

  it('inserts before the anchor', () => {
    expect(ids(insertSteps(base, 'b', 'before', [step('x'), step('y')]))).toEqual([
      'a',
      'x',
      'y',
      'b',
      'c',
    ]);
  });

  it('inserts after the anchor', () => {
    expect(ids(insertSteps(base, 'c', 'after', [step('x')]))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('does not mutate the input', () => {
    insertSteps(base, 'a', 'after', [step('x')]);

    expect(ids(base)).toEqual(['a', 'b', 'c']);
  });

  it('fails when the anchor does not exist', () => {
    expect(() => insertSteps(base, 'missing', 'before', [])).toThrow(/"missing"/);
  });
});

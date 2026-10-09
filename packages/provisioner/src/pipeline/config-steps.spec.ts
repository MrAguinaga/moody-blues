import { describe, expect, it } from 'vitest';

import { selectConfigSteps } from './config-steps';
import type { ProvisionScope, ProvisionStep } from './pipeline.types';
import { PROVISIONING_PIPELINE } from './provisioning.pipeline';

function step(id: string, scopes: ProvisionScope[]): ProvisionStep {
  return { id, title: id, scopes, run: async () => ({ status: 'unchanged' }) };
}

describe('selectConfigSteps', () => {
  const pipeline = [step('a', ['setup', 'config']), step('b', ['config']), step('c', ['setup'])];

  it('returns the steps in the order of the identifiers', () => {
    expect(selectConfigSteps(pipeline, ['b', 'a']).map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('fails on an identifier that does not exist', () => {
    expect(() => selectConfigSteps(pipeline, ['a', 'missing'])).toThrow(
      /"missing".*does not exist/,
    );
  });

  it('fails on a step without the config scope', () => {
    expect(() => selectConfigSteps(pipeline, ['c'])).toThrow(/"c".*config scope/);
  });

  it('selects the real steps of the provisioning pipeline', () => {
    const ids = ['persist-state', 'containers-up', 'wait-healthy', 'jellyfin-transcoding'];

    expect(selectConfigSteps(PROVISIONING_PIPELINE, ids).map((entry) => entry.id)).toEqual(ids);
  });

  it('refuses the steps that must never run from config', () => {
    for (const id of ['host-tree', 'seed-arr-config', 'seed-decypharr-config']) {
      expect(() => selectConfigSteps(PROVISIONING_PIPELINE, [id])).toThrow(/config scope/);
    }
  });
});

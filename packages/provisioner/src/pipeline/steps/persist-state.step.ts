import { parseConfig } from '../../config';
import { readState, writeState } from '../../state';
import type { ProvisionStep } from '../pipeline.types';

export const persistStateStep: ProvisionStep = {
  id: 'persist-state',
  title: 'Persist installation state',
  scopes: ['setup', 'reset', 'config'],
  run: async ({ config, layout, identity, cliVersion }) => {
    const parsed = parseConfig({ ...config, provisionedVersion: cliVersion });
    if (!parsed.ok) {
      throw new Error(`Invalid configuration:\n- ${parsed.error.join('\n- ')}`);
    }

    const current = readState(layout.stateFile);
    if (current && JSON.stringify(current) === JSON.stringify(parsed.value)) {
      return { status: 'unchanged' };
    }
    writeState(layout.stateFile, parsed.value, { identity });
    return { status: 'changed' };
  },
};

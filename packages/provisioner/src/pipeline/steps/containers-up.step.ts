import type { ProvisionStep } from '../pipeline.types';

export const containersUpStep: ProvisionStep = {
  id: 'containers-up',
  title: 'Start containers',
  scopes: ['setup', 'reset', 'config', 'update'],
  run: async ({ runtime }, signal) => {
    await runtime.up({ signal });
    return { status: 'changed' };
  },
};

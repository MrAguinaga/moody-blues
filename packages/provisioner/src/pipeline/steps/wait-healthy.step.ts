import type { ProvisionStep } from '../pipeline.types';

export const waitHealthyStep: ProvisionStep = {
  id: 'wait-healthy',
  title: 'Wait for healthy services',
  scopes: ['setup', 'reset', 'config', 'update'],
  run: async ({ runtime, reportProgress }, signal) => {
    await runtime.waitHealthy({ signal, onProgress: reportProgress });
    return { status: 'changed', detail: 'all services healthy' };
  },
};

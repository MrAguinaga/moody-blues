import type { ProvisionStep } from '../pipeline.types';

export const waitHealthyStep: ProvisionStep = {
  id: 'wait-healthy',
  title: 'Wait for healthy services',
  scopes: ['setup', 'reset', 'config', 'update'],
  run: async ({ runtime, reportProgress }, signal) => {
    const result = await runtime.waitHealthy({ signal, onProgress: reportProgress });
    const notes = result?.notes ?? [];
    return {
      status: 'changed',
      detail: notes.length > 0 ? notes.join('; ') : 'all services healthy',
    };
  },
};

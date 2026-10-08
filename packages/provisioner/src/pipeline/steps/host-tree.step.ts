import { ensureHostTree } from '../../home';
import type { ProvisionStep } from '../pipeline.types';

export const hostTreeStep: ProvisionStep = {
  id: 'host-tree',
  title: 'Prepare host directory tree',
  scopes: ['setup', 'reset'],
  run: async ({ layout, identity }) => {
    const { created } = ensureHostTree(layout, identity);
    if (created.length === 0) {
      return { status: 'unchanged' };
    }
    return { status: 'changed', detail: `${created.length} directories created` };
  },
};

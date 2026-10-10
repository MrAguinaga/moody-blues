import { ensureHostTree } from '../../home';
import { LIBRARY_MARKERS_CREATED_FLAG } from '../pipeline.flags';
import type { ProvisionStep } from '../pipeline.types';

export const hostTreeStep: ProvisionStep = {
  id: 'host-tree',
  title: 'Prepare host directory tree',
  scopes: ['setup', 'reset'],
  run: async ({ layout, identity, flags }) => {
    const { created, markers } = ensureHostTree(layout, identity);
    if (markers.length > 0) {
      // Jellyfin needs a scan after a marker appears in a library folder it already knows.
      flags.set(LIBRARY_MARKERS_CREATED_FLAG, true);
    }
    const details = [
      created.length > 0 ? `${created.length} directories created` : '',
      markers.length > 0 ? `${markers.length} library markers created` : '',
    ].filter(Boolean);
    if (details.length === 0) {
      return { status: 'unchanged' };
    }
    return { status: 'changed', detail: details.join(', ') };
  },
};

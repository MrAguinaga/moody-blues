import { writeCaddyfile } from '../../gateway';
import { GATEWAY_CHANGED_FLAG } from '../pipeline.flags';
import type { ProvisionStep } from '../pipeline.types';

export const gatewayConfigStep: ProvisionStep = {
  id: 'gateway-config',
  title: 'Write gateway configuration',
  scopes: ['setup', 'reset', 'config', 'update'],
  run: async ({ config, layout, flags }) => {
    const { changed } = writeCaddyfile(layout, config);
    flags.set(GATEWAY_CHANGED_FLAG, changed);
    return { status: changed ? 'changed' : 'unchanged' };
  },
};

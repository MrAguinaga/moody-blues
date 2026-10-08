import { GATEWAY_CHANGED_FLAG } from '../pipeline.flags';
import type { ProvisionStep } from '../pipeline.types';

export const gatewayReloadStep: ProvisionStep = {
  id: 'gateway-reload',
  title: 'Reload gateway',
  scopes: ['config', 'update'],
  run: async ({ runtime, flags }, signal) => {
    if (!flags.get(GATEWAY_CHANGED_FLAG)) {
      return { status: 'skipped', detail: 'gateway configuration unchanged' };
    }
    await runtime.reloadGateway({ signal });
    return { status: 'changed' };
  },
};

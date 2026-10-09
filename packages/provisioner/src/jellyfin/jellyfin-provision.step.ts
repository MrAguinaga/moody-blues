import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import { createJellyfinClient, type JellyfinClientOptions } from './jellyfin.client';
import { provisionJellyfin, type ProvisionJellyfinOptions } from './jellyfin.provision';

const JELLYFIN_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];

export type JellyfinStepOverrides = Pick<
  JellyfinClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry'
> &
  Pick<ProvisionJellyfinOptions, 'ready'>;

export function createJellyfinProvisionStep(overrides: JellyfinStepOverrides = {}): ProvisionStep {
  const { ready, ...clientOverrides } = overrides;
  return {
    id: 'jellyfin-provision',
    title: 'Provision Jellyfin',
    scopes: JELLYFIN_STEP_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      const client = createJellyfinClient({
        baseUrl: SERVICE_CATALOG.jellyfin.hostUrl,
        signal,
        ...clientOverrides,
      });
      return provisionJellyfin(ctx, { client, signal, ready });
    },
  };
}

export const jellyfinProvisionStep: ProvisionStep = createJellyfinProvisionStep();

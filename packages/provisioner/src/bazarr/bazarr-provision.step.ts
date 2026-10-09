import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import { loadServiceKeys } from '../services/service-keys';
import { type BazarrClientOptions, createBazarrClient } from './bazarr.client';
import { provisionBazarr, type ProvisionBazarrOptions } from './bazarr.provision';

const BAZARR_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];

export type BazarrStepOverrides = Pick<
  BazarrClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'now'
> &
  Pick<ProvisionBazarrOptions, 'ready' | 'link' | 'tasks'>;

export function createBazarrProvisionStep(overrides: BazarrStepOverrides = {}): ProvisionStep {
  const { ready, link, tasks, ...clientOverrides } = overrides;
  return {
    id: 'bazarr-provision',
    title: 'Provision Bazarr',
    scopes: BAZARR_STEP_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      const keys = loadServiceKeys(ctx.layout);
      const client = createBazarrClient({
        baseUrl: SERVICE_CATALOG.bazarr.hostUrl,
        apiKey: keys.bazarrApiKey,
        signal,
        ...clientOverrides,
      });
      return provisionBazarr(ctx, {
        client,
        serviceKeys: { sonarr: keys.sonarrApiKey, radarr: keys.radarrApiKey },
        signal,
        ready,
        link,
        tasks,
      });
    },
  };
}

export const bazarrProvisionStep: ProvisionStep = createBazarrProvisionStep();

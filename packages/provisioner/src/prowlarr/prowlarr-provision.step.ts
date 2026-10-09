import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import { loadServiceKeys } from '../services/service-keys';
import { createProwlarrClient, type ProwlarrClientOptions } from './prowlarr.client';
import {
  type DefinitionsWaitOptions,
  provisionProwlarr,
  type ProvisionProwlarrOptions,
} from './prowlarr.provision';

const PROWLARR_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];

export type ProwlarrStepOverrides = Pick<
  ProwlarrClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'now'
> &
  Pick<ProvisionProwlarrOptions, 'ready' | 'sync'> & { definitions?: DefinitionsWaitOptions };

export function createProwlarrProvisionStep(overrides: ProwlarrStepOverrides = {}): ProvisionStep {
  const { ready, sync, definitions, ...clientOverrides } = overrides;
  return {
    id: 'prowlarr-provision',
    title: 'Provision Prowlarr',
    scopes: PROWLARR_STEP_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      const keys = loadServiceKeys(ctx.layout);
      const client = createProwlarrClient({
        baseUrl: SERVICE_CATALOG.prowlarr.hostUrl,
        apiKey: keys.prowlarrApiKey,
        signal,
        ...clientOverrides,
      });
      return provisionProwlarr(ctx, {
        client,
        apiKeys: { sonarr: keys.sonarrApiKey, radarr: keys.radarrApiKey },
        signal,
        ready,
        definitions,
        sync,
      });
    },
  };
}

export const prowlarrProvisionStep: ProvisionStep = createProwlarrProvisionStep();

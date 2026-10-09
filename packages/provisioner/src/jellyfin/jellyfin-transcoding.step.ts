import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import { createJellyfinClient } from './jellyfin.client';
import type { JellyfinStepOverrides } from './jellyfin-provision.step';
import { provisionTranscoding } from './jellyfin-transcoding.provision';

const TRANSCODING_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];

export function createJellyfinTranscodingStep(
  overrides: JellyfinStepOverrides = {},
): ProvisionStep {
  const { ready, ...clientOverrides } = overrides;
  return {
    id: 'jellyfin-transcoding',
    title: 'Configure Jellyfin transcoding',
    scopes: TRANSCODING_STEP_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      const client = createJellyfinClient({
        baseUrl: SERVICE_CATALOG.jellyfin.hostUrl,
        signal,
        ...clientOverrides,
      });
      return provisionTranscoding(ctx, { client, signal, ready });
    },
  };
}

export const jellyfinTranscodingStep: ProvisionStep = createJellyfinTranscodingStep();

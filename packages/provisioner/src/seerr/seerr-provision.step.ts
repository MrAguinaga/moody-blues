import { type ArrClientOptions, createArrClient } from '../arr/arr.client';
import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import { loadServiceKeys } from '../services/service-keys';
import { createSeerrClient, type SeerrClientOptions } from './seerr.client';
import { provisionSeerr, type ProvisionSeerrOptions } from './seerr.provision';
import type { SeerrArrKind } from './seerr.types';

const SEERR_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];
const ARR_KINDS: readonly SeerrArrKind[] = ['sonarr', 'radarr'];

type TransportOverrides<T> = Pick<T, Extract<keyof T, 'fetch' | 'sleep' | 'random' | 'retry'>>;

export interface SeerrStepOverrides extends Pick<ProvisionSeerrOptions, 'ready'> {
  seerr?: TransportOverrides<SeerrClientOptions>;
  arr?: Partial<Record<SeerrArrKind, TransportOverrides<ArrClientOptions>>>;
}

export function createSeerrProvisionStep(overrides: SeerrStepOverrides = {}): ProvisionStep {
  return {
    id: 'seerr-provision',
    title: 'Provision Seerr',
    scopes: SEERR_STEP_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      const keys = loadServiceKeys(ctx.layout);
      const arrApiKeys = { sonarr: keys.sonarrApiKey, radarr: keys.radarrApiKey };
      const arrs = Object.fromEntries(
        ARR_KINDS.map((kind) => [
          kind,
          createArrClient({
            kind,
            baseUrl: SERVICE_CATALOG[kind].hostUrl,
            apiKey: arrApiKeys[kind],
            signal,
            ...overrides.arr?.[kind],
          }),
        ]),
      ) as ProvisionSeerrOptions['arrs'];
      const client = createSeerrClient({
        baseUrl: SERVICE_CATALOG.seerr.hostUrl,
        apiKey: keys.seerrApiKey,
        signal,
        ...overrides.seerr,
      });
      return provisionSeerr(ctx, { client, arrs, arrApiKeys, signal, ready: overrides.ready });
    },
  };
}

export const seerrProvisionStep: ProvisionStep = createSeerrProvisionStep();

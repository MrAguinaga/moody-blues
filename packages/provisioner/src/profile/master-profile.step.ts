import { createArrClient } from '../arr/arr.client';
import { type ArrStepOverrides } from '../arr/arr.provision';
import { ARR_KINDS, type ArrKind } from '../arr/arr.types';
import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { loadServiceKeys, SERVICE_CATALOG } from '../services';
import { applyMasterProfile } from './master-profile.apply';
import { buildProfilePlan } from './master-profile.plan';

const MASTER_PROFILE_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];
const LABELS: Readonly<Record<ArrKind, string>> = { sonarr: 'Sonarr', radarr: 'Radarr' };

export type MasterProfileOverrides = Omit<ArrStepOverrides, 'ready'>;

export function createMasterProfileStep(overrides: MasterProfileOverrides = {}): ProvisionStep {
  return {
    id: 'master-profile',
    title: 'Apply master quality profile',
    scopes: MASTER_PROFILE_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      const keys = loadServiceKeys(ctx.layout);
      const details: string[] = [];
      let changed = false;

      for (const kind of ARR_KINDS) {
        const client = createArrClient({
          kind,
          baseUrl: SERVICE_CATALOG[kind].hostUrl,
          apiKey: kind === 'sonarr' ? keys.sonarrApiKey : keys.radarrApiKey,
          signal,
          ...overrides,
        });
        for (const tier of ctx.config.tiers) {
          const plan = buildProfilePlan(tier, ctx.config.languages, kind);
          const outcome = await applyMasterProfile(client, plan, (message) =>
            ctx.reportProgress?.(`${LABELS[kind]}: ${message}`),
          );
          changed ||= outcome.status === 'changed';
          if (outcome.detail) {
            details.push(`${LABELS[kind]}: ${outcome.detail}`);
          }
        }
      }

      return {
        status: changed ? 'changed' : 'unchanged',
        ...(details.length > 0 ? { detail: details.join('; ') } : {}),
      };
    },
  };
}

export const masterProfileStep: ProvisionStep = createMasterProfileStep();

import type { BazarrProviderStatus } from '@moody-blues/provisioner';

import type { DoctorCheck, DoctorOutcome } from '../doctor.types';
import { errorText, gateService, logsSuggestion } from './check-gate.utils';

const GOOD_STATE = 'good';

interface ExpectedProvider {
  key: string;
  label: string;
}

const GESTDOWN: ExpectedProvider = { key: 'gestdown', label: 'Gestdown' };
const OPENSUBTITLES: ExpectedProvider = { key: 'opensubtitlescom', label: 'OpenSubtitles.com' };

export interface ProviderEvaluationOptions {
  opensubtitles: boolean;
}

export interface ProviderEvaluation {
  healthy: string[];
  problems: string[];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function evaluateProviders(
  providers: readonly BazarrProviderStatus[],
  { opensubtitles }: ProviderEvaluationOptions,
): ProviderEvaluation {
  const expected = opensubtitles ? [GESTDOWN, OPENSUBTITLES] : [GESTDOWN];
  const evaluation: ProviderEvaluation = { healthy: [], problems: [] };

  for (const { key, label } of expected) {
    const provider = providers.find((candidate) => normalize(candidate.name) === key);
    if (!provider) {
      evaluation.problems.push(`${label} is not listed by Bazarr`);
    } else if (provider.status.toLowerCase() === GOOD_STATE) {
      evaluation.healthy.push(label);
    } else {
      const retry = provider.retry && provider.retry !== '-' ? `; retry ${provider.retry}` : '';
      evaluation.problems.push(`${label} is not in the Good state (${provider.status}${retry})`);
    }
  }
  return evaluation;
}

function hasOpenSubtitlesCredentials(env: Record<string, string>): boolean {
  return Boolean(env.OPENSUBTITLES_USERNAME && env.OPENSUBTITLES_PASSWORD);
}

export const bazarrProvidersCheck: DoctorCheck = {
  id: 'bazarr-providers',
  name: 'Bazarr providers',
  run: async (ctx): Promise<DoctorOutcome> => {
    const gate = await gateService(ctx, 'bazarr');
    if (gate) {
      return gate;
    }

    let providers: BazarrProviderStatus[];
    try {
      providers = await ctx.clients.bazarr.listProviders();
    } catch (error) {
      return {
        status: 'warning',
        message: 'The Bazarr subtitle providers could not be read',
        details: [errorText(error)],
        suggestion: logsSuggestion('bazarr'),
      };
    }

    const { healthy, problems } = evaluateProviders(providers, {
      opensubtitles: hasOpenSubtitlesCredentials(ctx.installation.env),
    });
    if (problems.length === 0) {
      return { status: 'ok', message: `${healthy.join(' and ')} in the Good state` };
    }
    return {
      status: 'warning',
      message:
        problems.length === 1
          ? (problems[0] as string)
          : `${problems.length} subtitle providers need attention`,
      ...(problems.length > 1 ? { details: problems } : {}),
      suggestion:
        'Check the provider credentials in the Bazarr settings (Settings > Providers); Bazarr retries on its own.',
    };
  },
};

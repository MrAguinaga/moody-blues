import type { ArrClient, HealthResource } from '@moody-blues/provisioner';

import type { DoctorCheck, DoctorContext, DoctorOutcome } from '../doctor.types';
import {
  errorText,
  gateService,
  isRejectedKey,
  logsSuggestion,
  storageDisabled,
} from './check-gate.utils';

interface HealthSplit {
  errors: string[];
  warnings: string[];
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const DOWNLOAD_CLIENT_HEALTH_SOURCES: readonly string[] = [
  'DownloadClientCheck',
  'DownloadClientStatusCheck',
];

export const INDEXER_HEALTH_SOURCES: readonly string[] = [
  'IndexerStatusCheck',
  'IndexerLongTermStatusCheck',
];

export function splitHealth(
  entries: readonly HealthResource[],
  ignoredSources: readonly string[] = [],
): HealthSplit {
  const describe = (entry: HealthResource) => `${entry.source}: ${entry.message}`;
  const relevant = entries.filter((entry) => !ignoredSources.includes(entry.source));
  return {
    errors: relevant.filter((entry) => entry.type === 'error').map(describe),
    warnings: relevant.filter((entry) => entry.type === 'warning').map(describe),
  };
}

function ignoredHealthSources(ctx: DoctorContext): string[] {
  return [
    ...INDEXER_HEALTH_SOURCES,
    ...(storageDisabled(ctx) ? DOWNLOAD_CLIENT_HEALTH_SOURCES : []),
  ];
}

function failure(service: string, label: string, error: unknown): DoctorOutcome {
  if (isRejectedKey(error)) {
    return {
      status: 'error',
      message: `${label} rejected the API key`,
      details: [errorText(error)],
      suggestion: `The key in the Moody Blues .env does not match the one ${label} uses. If the service data was recreated, "moody-blues reset --fresh" reseeds it (it deletes the managed data).`,
    };
  }
  return {
    status: 'error',
    message: `${label} did not answer`,
    details: [errorText(error)],
    suggestion: logsSuggestion(service),
  };
}

async function probe(
  ctx: DoctorContext,
  service: string,
  label: string,
  run: () => Promise<DoctorOutcome>,
): Promise<DoctorOutcome> {
  const gate = await gateService(ctx, service);
  if (gate) {
    return gate;
  }
  try {
    return await run();
  } catch (error) {
    return failure(service, label, error);
  }
}

function healthOutcome(label: string, headline: string, health: HealthSplit): DoctorOutcome {
  const details = [
    ...health.errors.map((line) => `error ${line}`),
    ...health.warnings.map((line) => `warning ${line}`),
  ];
  if (health.errors.length > 0) {
    return {
      status: 'error',
      message: `${label} reports ${pluralize(health.errors.length, 'health error')}`,
      details,
      suggestion: `Open System > Status in the ${label} web interface for the full explanation.`,
    };
  }
  if (health.warnings.length > 0) {
    return {
      status: 'warning',
      message: `${label} reports ${pluralize(health.warnings.length, 'health warning')}`,
      details,
      suggestion: `Open System > Status in the ${label} web interface for the full explanation.`,
    };
  }
  return { status: 'ok', message: headline };
}

async function evaluateArr(
  client: ArrClient,
  label: string,
  ignoredSources: readonly string[],
): Promise<DoctorOutcome> {
  const status = await client.getSystemStatus();
  const health = splitHealth(await client.getHealth(), ignoredSources);
  return healthOutcome(
    label,
    `${label} ${status.version} answers and reports no health issues`,
    health,
  );
}

function createArrApiCheck(kind: 'sonarr' | 'radarr', label: string): DoctorCheck {
  return {
    id: `api-${kind}`,
    name: `${label} API`,
    run: (ctx) =>
      probe(ctx, kind, label, () =>
        evaluateArr(ctx.clients[kind], label, ignoredHealthSources(ctx)),
      ),
  };
}

export const sonarrApiCheck = createArrApiCheck('sonarr', 'Sonarr');
export const radarrApiCheck = createArrApiCheck('radarr', 'Radarr');

export const prowlarrApiCheck: DoctorCheck = {
  id: 'api-prowlarr',
  name: 'Prowlarr API',
  run: (ctx) =>
    probe(ctx, 'prowlarr', 'Prowlarr', async () => {
      const status = await ctx.clients.prowlarr.readStatus();
      const health = splitHealth(status.health);
      const blocked = status.blocked.map(
        (indexer) => `indexer ${indexer.name} is blocked until ${indexer.disabledTill}`,
      );

      if (status.indexerCount === 0) {
        return {
          status: 'error',
          message: 'Prowlarr has no indexers',
          details: [...blocked],
          suggestion: 'Run "moody-blues setup" again to register the indexers.',
        };
      }
      const outcome = healthOutcome(
        'Prowlarr',
        `Prowlarr has ${pluralize(status.indexerCount, 'indexer')} and none is blocked`,
        health,
      );
      if (outcome.status === 'ok' && blocked.length > 0) {
        return {
          status: 'warning',
          message: `${pluralize(blocked.length, 'indexer')} of ${status.indexerCount} blocked by failures`,
          details: blocked,
          suggestion:
            'Prowlarr retries blocked indexers by itself; open Indexers > Test All if it persists.',
        };
      }
      return blocked.length > 0
        ? { ...outcome, details: [...(outcome.details ?? []), ...blocked] }
        : outcome;
    }),
};

export const bazarrApiCheck: DoctorCheck = {
  id: 'api-bazarr',
  name: 'Bazarr API',
  run: (ctx) =>
    probe(ctx, 'bazarr', 'Bazarr', async () => {
      const status = await ctx.clients.bazarr.getStatus();
      const unreachable = [
        ...(status.sonarr_version ? [] : ['Sonarr']),
        ...(status.radarr_version ? [] : ['Radarr']),
      ];
      if (unreachable.length > 0) {
        return {
          status: 'warning',
          message: `Bazarr has not reached ${unreachable.join(' and ')}`,
          suggestion:
            'Bazarr links to Sonarr and Radarr when it starts; restart it with "docker compose -p moody-blues restart bazarr" if it persists.',
        };
      }
      return {
        status: 'ok',
        message: `Bazarr ${status.bazarr_version} is linked to Sonarr ${status.sonarr_version} and Radarr ${status.radarr_version}`,
      };
    }),
};

export const jellyfinApiCheck: DoctorCheck = {
  id: 'api-jellyfin',
  name: 'Jellyfin API',
  run: (ctx) =>
    probe(ctx, 'jellyfin', 'Jellyfin', async () => {
      const info = await ctx.clients.jellyfin.getPublicInfo();
      if (info?.StartupWizardCompleted !== true) {
        return {
          status: 'error',
          message: 'The Jellyfin setup wizard is not completed',
          suggestion: 'Run "moody-blues setup" again to finish the Jellyfin provisioning.',
        };
      }
      const apiKey = ctx.installation.env.JELLYFIN_API_KEY;
      if (!apiKey) {
        return {
          status: 'warning',
          message: 'JELLYFIN_API_KEY is missing from the Moody Blues .env',
          suggestion: 'Run "moody-blues setup" again to issue the Jellyfin API key.',
        };
      }
      ctx.clients.jellyfin.useToken(apiKey);
      await ctx.clients.jellyfin.listApiKeys();
      return {
        status: 'ok',
        message: `${info.Version ? `Jellyfin ${info.Version}` : 'Jellyfin'} answers and accepts the API key`,
      };
    }),
};

export const seerrApiCheck: DoctorCheck = {
  id: 'api-seerr',
  name: 'Seerr API',
  run: (ctx) =>
    probe(ctx, 'seerr', 'Seerr', async () => {
      const settings = await ctx.clients.seerr.getPublicSettings();
      if (settings.initialized !== true) {
        return {
          status: 'error',
          message: 'Seerr is not initialized',
          suggestion: 'Run "moody-blues setup" again to finish the Seerr provisioning.',
        };
      }
      await ctx.clients.seerr.whoAmI();
      return { status: 'ok', message: 'Seerr is initialized and accepts the API key' };
    }),
};

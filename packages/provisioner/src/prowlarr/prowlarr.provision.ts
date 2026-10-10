import type { ArrKind } from '../arr/arr.types';
import { PollTimeoutError } from '../http/http.errors';
import type { Sleep } from '../http/http.types';
import { pollUntil } from '../http/ready.http';
import { ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import type { ProvisionContext, StepOutcome } from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import {
  FLARESOLVERR_TAG_LABEL,
  type ProwlarrClient,
  type ProwlarrReadyOptions,
  type ProwlarrSyncOptions,
} from './prowlarr.client';
import { MIN_SEEDERS, PROWLARR_INDEXERS } from './prowlarr.indexers';
import type { IndexerResource, IndexerSpec } from './prowlarr.types';

export const DEFINITIONS_TIMEOUT_MS = 90_000;
export const DEFINITIONS_INTERVAL_MS = 3_000;

const APPLICATION_KINDS: readonly ArrKind[] = ['sonarr', 'radarr'];
const APPLICATION_LABELS: Readonly<Record<ArrKind, string>> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
};

export interface DefinitionsWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: Sleep;
  now?: () => number;
}

export interface ProvisionProwlarrOptions {
  client: ProwlarrClient;
  apiKeys: Readonly<Record<ArrKind, string>>;
  signal: AbortSignal;
  indexers?: readonly IndexerSpec[];
  ready?: ProwlarrReadyOptions;
  definitions?: DefinitionsWaitOptions;
  sync?: ProwlarrSyncOptions;
}

const MAX_REASON_LENGTH = 80;
const PROXY_HEALTH_SOURCE = 'IndexerProxyStatusCheck';
const DEFINITION_UNAVAILABLE_REASON = 'definition not available';

function missingDefinitions(
  schema: readonly IndexerResource[],
  specs: readonly IndexerSpec[],
): string[] {
  const available = new Set(schema.map((item) => item.definitionName));
  return specs.map((spec) => spec.definitionName).filter((name) => !available.has(name));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function definitionsLoaded(schema: readonly IndexerResource[]): boolean {
  return schema.some((item) => item.implementation === 'Cardigann');
}

function summarizeReason(reason: string): string {
  const firstSentence = (reason.trim().split(/\.(?:\s|$)/, 1)[0] ?? '').trim();
  return firstSentence.length > MAX_REASON_LENGTH
    ? `${firstSentence.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`
    : firstSentence;
}

function definitionsUnavailable(missing: readonly string[], waitedMs: number): Error {
  return new Error(
    `Prowlarr did not load the indexer definitions ${missing.join(', ')} after ` +
      `${Math.round(waitedMs / 1000)} s. Definitions are downloaded from ` +
      'https://indexers.prowlarr.com at startup; check that the host has outbound HTTPS access.',
  );
}

async function awaitDefinitions(
  client: ProwlarrClient,
  specs: readonly IndexerSpec[],
  signal: AbortSignal,
  options: DefinitionsWaitOptions = {},
): Promise<IndexerResource[]> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let missing: string[] = specs.map((spec) => spec.definitionName);
  let schema: IndexerResource[];
  try {
    schema = await pollUntil(
      async () => {
        const current = await client.listIndexerSchema();
        missing = missingDefinitions(current, specs);
        return missing.length === 0 || definitionsLoaded(current) ? current : undefined;
      },
      {
        timeoutMs: options.timeoutMs ?? DEFINITIONS_TIMEOUT_MS,
        intervalMs: options.intervalMs ?? DEFINITIONS_INTERVAL_MS,
        signal,
        sleep: options.sleep,
        now,
      },
    );
  } catch (error) {
    if (error instanceof PollTimeoutError) {
      throw definitionsUnavailable(missing, error.waitedMs);
    }
    throw error;
  }
  if (specs.length > 0 && missing.length === specs.length) {
    throw definitionsUnavailable(missing, now() - startedAt);
  }
  return schema;
}

export async function provisionProwlarr(
  ctx: ProvisionContext,
  options: ProvisionProwlarrOptions,
): Promise<StepOutcome> {
  const { client, apiKeys, signal } = options;
  const specs = options.indexers ?? PROWLARR_INDEXERS;
  const changes: string[] = [];
  const notes: string[] = [];
  let needsSync = false;
  const progress = (message: string) => ctx.reportProgress?.(message);

  progress('Waiting for Prowlarr');
  await client.waitReady({ signal, ...options.ready });

  progress('Configuring administrator account');
  const { adminUsername, adminPassword } = ctx.secrets;
  if (
    await client.ensureAdminUser({
      username: adminUsername,
      password: adminPassword,
      rotate: ctx.flags.get(ROTATE_CREDENTIALS_FLAG) === true,
    })
  ) {
    changes.push('administrator account');
  }

  progress('Configuring FlareSolverr proxy');
  const tag = await client.ensureTag(FLARESOLVERR_TAG_LABEL);
  if (await client.ensureFlaresolverrProxy(tag.id)) {
    changes.push('FlareSolverr proxy');
  }
  const proxyTest = await client.testFlaresolverrProxy();
  if (!proxyTest.ok) {
    notes.push(`FlareSolverr proxy test failed: ${summarizeReason(proxyTest.reason)}`);
  }

  for (const kind of APPLICATION_KINDS) {
    progress(`Linking ${APPLICATION_LABELS[kind]}`);
    const changed = await client.ensureApplication(
      kind,
      {
        prowlarrUrl: SERVICE_CATALOG.prowlarr.internalUrl,
        baseUrl: SERVICE_CATALOG[kind].internalUrl,
      },
      apiKeys[kind],
    );
    if (changed) {
      changes.push(`${APPLICATION_LABELS[kind]} application`);
      needsSync = true;
    }
  }

  progress('Waiting for indexer definitions');
  const schema = await awaitDefinitions(client, specs, signal, options.definitions);
  const appProfile = await client.ensureStandardAppProfile(MIN_SEEDERS);
  if (appProfile.changed) {
    changes.push('Standard profile minimum seeders');
    needsSync = true;
  }
  const appProfileId = appProfile.id;
  const existing = await client.listIndexers();

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  let registered = 0;
  for (const spec of specs) {
    progress(`Configuring indexer ${spec.definitionName}`);
    const schemaItem = schema.find((item) => item.definitionName === spec.definitionName);
    if (!schemaItem) {
      skipped.push(`${spec.definitionName} (${DEFINITION_UNAVAILABLE_REASON})`);
      continue;
    }
    const change = await client.ensureIndexer(spec, schemaItem, {
      appProfileId,
      flaresolverrTagId: tag.id,
      existing,
    });
    if (change.result === 'skipped') {
      skipped.push(`${change.definitionName} (${summarizeReason(change.reason)})`);
      continue;
    }
    registered += 1;
    if (change.result === 'created') created.push(change.definitionName);
    if (change.result === 'updated') updated.push(change.definitionName);
  }
  if (registered === 0) {
    throw new Error(`Prowlarr registered none of the indexers: ${skipped.join('; ')}`);
  }
  if (created.length > 0) changes.push(`created indexers ${created.join(', ')}`);
  if (updated.length > 0) changes.push(`updated indexers ${updated.join(', ')}`);
  if (skipped.length > 0) notes.push(`skipped indexers ${skipped.join('; ')}`);
  needsSync ||= created.length > 0 || updated.length > 0;

  if (needsSync) {
    progress('Synchronizing applications');
    await client.forceApplicationSync(options.sync);
  }

  progress('Verifying status');
  let status = await client.readStatus();
  if (proxyTest.ok && status.health.some((issue) => issue.source === PROXY_HEALTH_SOURCE)) {
    try {
      await client.refreshHealth(options.sync);
      status = await client.readStatus();
    } catch (error) {
      notes.push(`health check refresh failed: ${summarizeReason(errorText(error))}`);
    }
  }
  const linked = new Set(status.applications.map((application) => application.name));
  const unlinked = APPLICATION_KINDS.map((kind) => APPLICATION_LABELS[kind]).filter(
    (name) => !linked.has(name),
  );
  if (unlinked.length > 0) {
    throw new Error(`Prowlarr has no linked application for ${unlinked.join(', ')}`);
  }
  if (status.blocked.length > 0) {
    notes.push(`blocked indexers ${status.blocked.map((entry) => entry.name).join(', ')}`);
  }
  if (status.health.length > 0) {
    notes.push(`health: ${status.health.map((issue) => issue.message).join('; ')}`);
  }

  const detail = [changes.join(', '), ...notes].filter(Boolean).join('; ');
  return {
    status: changes.length > 0 ? 'changed' : 'unchanged',
    ...(detail ? { detail } : {}),
  };
}

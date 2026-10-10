import type { ArrKind, HealthResource, SystemStatusResource } from '../arr/arr.types';
import { createHttpClient } from '../http/http.client';
import { HttpStatusError } from '../http/http.errors';
import type { HttpClient, HttpClientOptions } from '../http/http.types';
import { applyFieldValues, fieldsMatch } from '../http/provider-fields';
import { pollUntil, waitUntilReady, type WaitUntilReadyOptions } from '../http/ready.http';
import { ensureServarrAdminUser, type ServarrAdminCredentials } from '../servarr/servarr-host';
import { SERVICE_CATALOG } from '../services/service-catalog';
import type {
  ApplicationResource,
  ApplicationUrls,
  AppProfileResource,
  BlockedIndexer,
  CommandResource,
  IndexerChange,
  IndexerContext,
  IndexerProxyResource,
  IndexerResource,
  IndexerSpec,
  IndexerStatusResource,
  ProwlarrStatus,
  ProxyTestResult,
  TagResource,
} from './prowlarr.types';

const API_ROOT = '/api/v1';

export const FLARESOLVERR_TAG_LABEL = 'flaresolverr';
export const FLARESOLVERR_FIELD = 'info_flaresolverr';
export const FLARESOLVERR_PROXY_NAME = 'FlareSolverr';
export const STANDARD_APP_PROFILE_NAME = 'Standard';
export const INDEXER_PRIORITY = 25;
export const MIN_SEEDERS_FIELD = 'torrentBaseSettings.appMinimumSeeders';
const INHERIT_PROFILE_SEEDERS = null;

const FLARESOLVERR_REQUEST_TIMEOUT_SECONDS = 60;
const INDEXER_LIVE_TEST_TIMEOUT_MS = 120_000;
const APPLICATION_NAMES: Readonly<Record<ArrKind, string>> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
};
const FAILED_COMMAND_STATUSES: readonly string[] = ['failed', 'aborted', 'cancelled', 'orphaned'];

export const DEFAULT_SYNC_TIMEOUT_MS = 180_000;
export const DEFAULT_SYNC_INTERVAL_MS = 2_000;
const HEALTH_CHECK_TIMEOUT_MS = 30_000;

export type ProwlarrReadyOptions = Pick<
  WaitUntilReadyOptions,
  'timeoutMs' | 'sleep' | 'now' | 'random' | 'signal'
>;

export interface ProwlarrSyncOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  sleep?: HttpClientOptions['sleep'];
  now?: () => number;
}

export interface ProwlarrClientOptions extends Pick<
  HttpClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'timeoutMs' | 'signal'
> {
  baseUrl: string;
  apiKey: string;
  now?: () => number;
}

export interface ProwlarrClient {
  readonly http: HttpClient;
  waitReady(options?: ProwlarrReadyOptions): Promise<void>;
  getSystemStatus(): Promise<SystemStatusResource>;
  ensureAdminUser(credentials: ServarrAdminCredentials): Promise<boolean>;
  ensureTag(label: string): Promise<TagResource>;
  ensureFlaresolverrProxy(tagId: number): Promise<boolean>;
  ensureApplication(kind: ArrKind, urls: ApplicationUrls, apiKey: string): Promise<boolean>;
  testFlaresolverrProxy(): Promise<ProxyTestResult>;
  ensureStandardAppProfile(minimumSeeders: number): Promise<{ id: number; changed: boolean }>;
  listIndexerSchema(): Promise<IndexerResource[]>;
  listIndexers(): Promise<IndexerResource[]>;
  ensureIndexer(
    spec: IndexerSpec,
    schemaItem: IndexerResource,
    context: IndexerContext,
  ): Promise<IndexerChange>;
  forceApplicationSync(options?: ProwlarrSyncOptions): Promise<void>;
  refreshHealth(options?: ProwlarrSyncOptions): Promise<void>;
  readStatus(): Promise<ProwlarrStatus>;
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  const sortedRight = [...right].sort((a, b) => a - b);
  return (
    left.length === right.length &&
    [...left].sort((a, b) => a - b).every((id, index) => id === sortedRight[index])
  );
}

function describeRejection(error: HttpStatusError): string {
  if (error.validation.length === 0) {
    return error.bodySnippet || `HTTP ${error.status}`;
  }
  return error.validation
    .map(({ errorMessage, detailedDescription }) =>
      detailedDescription && !errorMessage.includes(detailedDescription)
        ? `${errorMessage} (${detailedDescription})`
        : errorMessage,
    )
    .join('; ');
}

export function createProwlarrClient(options: ProwlarrClientOptions): ProwlarrClient {
  const http = createHttpClient({
    baseUrl: options.baseUrl,
    headers: { 'X-Api-Key': options.apiKey },
    fetch: options.fetch,
    sleep: options.sleep,
    random: options.random,
    retry: options.retry,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const forceSave = { query: { forceSave: true } };

  const getSystemStatus = () => http.get<SystemStatusResource>(`${API_ROOT}/system/status`);

  async function ensureTag(label: string): Promise<TagResource> {
    const normalized = label.toLowerCase();
    const tags = await http.get<TagResource[]>(`${API_ROOT}/tag`);
    return (
      tags.find((tag) => tag.label.toLowerCase() === normalized) ??
      (await http.post<TagResource>(`${API_ROOT}/tag`, { label: normalized }))
    );
  }

  async function ensureFlaresolverrProxy(tagId: number): Promise<boolean> {
    const values = {
      host: `${SERVICE_CATALOG.flaresolverr.internalUrl}/`,
      requestTimeout: FLARESOLVERR_REQUEST_TIMEOUT_SECONDS,
    };
    const proxies = await http.get<IndexerProxyResource[]>(`${API_ROOT}/indexerproxy`);
    const existing = proxies.find((proxy) => proxy.name === FLARESOLVERR_PROXY_NAME);

    if (existing) {
      if (
        fieldsMatch(existing, values) &&
        sameIds(existing.tags, [tagId]) &&
        existing.onHealthIssue === false
      ) {
        return false;
      }
      await http.put(
        `${API_ROOT}/indexerproxy/${existing.id}`,
        { ...applyFieldValues(existing, values), tags: [tagId], onHealthIssue: false },
        forceSave,
      );
      return true;
    }

    const template = (
      await http.get<IndexerProxyResource[]>(`${API_ROOT}/indexerproxy/schema`)
    ).find((candidate) => candidate.implementation === FLARESOLVERR_PROXY_NAME);
    if (!template) {
      throw new Error(`Prowlarr offers no ${FLARESOLVERR_PROXY_NAME} indexer proxy schema`);
    }
    const resource = {
      ...applyFieldValues(template, values),
      name: FLARESOLVERR_PROXY_NAME,
      tags: [tagId],
      onHealthIssue: false,
    };
    try {
      await http.post(`${API_ROOT}/indexerproxy`, resource);
    } catch (error) {
      if (!(error instanceof HttpStatusError) || error.status !== 400) {
        throw error;
      }
      // Prowlarr tests the proxy before saving it; FlareSolverr is optional and may be down.
      await http.post(`${API_ROOT}/indexerproxy`, resource, forceSave);
    }
    return true;
  }

  async function testFlaresolverrProxy(): Promise<ProxyTestResult> {
    const proxies = await http.get<IndexerProxyResource[]>(`${API_ROOT}/indexerproxy`);
    const existing = proxies.find((proxy) => proxy.name === FLARESOLVERR_PROXY_NAME);
    if (!existing) {
      throw new Error(`Prowlarr has no ${FLARESOLVERR_PROXY_NAME} indexer proxy to test`);
    }
    try {
      await http.post(`${API_ROOT}/indexerproxy/test`, existing);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 400) {
        return { ok: false, reason: describeRejection(error) };
      }
      throw error;
    }
    return { ok: true };
  }

  async function ensureApplication(
    kind: ArrKind,
    urls: ApplicationUrls,
    apiKey: string,
  ): Promise<boolean> {
    const name = APPLICATION_NAMES[kind];
    const applications = await http.get<ApplicationResource[]>(`${API_ROOT}/applications`);
    const existing = applications.find((application) => application.name === name);

    if (existing) {
      // Prowlarr masks the stored api key, so only the remaining fields can show drift.
      if (
        fieldsMatch(existing, urls) &&
        existing.syncLevel === 'fullSync' &&
        existing.enable &&
        existing.tags.length === 0
      ) {
        return false;
      }
      await http.put(
        `${API_ROOT}/applications/${existing.id}`,
        {
          ...applyFieldValues(existing, { ...urls, apiKey }),
          syncLevel: 'fullSync',
          enable: true,
          tags: [],
        },
        forceSave,
      );
      return true;
    }

    const template = (
      await http.get<ApplicationResource[]>(`${API_ROOT}/applications/schema`)
    ).find((candidate) => candidate.implementation === name);
    if (!template) {
      throw new Error(`Prowlarr offers no ${name} application schema`);
    }
    await http.post(`${API_ROOT}/applications`, {
      ...applyFieldValues(template, { ...urls, apiKey }),
      name,
      syncLevel: 'fullSync',
      enable: true,
      tags: [],
    });
    return true;
  }

  async function ensureStandardAppProfile(
    minimumSeeders: number,
  ): Promise<{ id: number; changed: boolean }> {
    const profiles = await http.get<AppProfileResource[]>(`${API_ROOT}/appprofile`);
    const standard = profiles.find((profile) => profile.name === STANDARD_APP_PROFILE_NAME);
    if (!standard) {
      throw new Error(`Prowlarr has no "${STANDARD_APP_PROFILE_NAME}" application profile`);
    }
    if (standard.minimumSeeders === minimumSeeders) {
      return { id: standard.id, changed: false };
    }
    await http.put(`${API_ROOT}/appprofile/${standard.id}`, { ...standard, minimumSeeders });
    return { id: standard.id, changed: true };
  }

  async function ensureIndexer(
    spec: IndexerSpec,
    schemaItem: IndexerResource,
    context: IndexerContext,
  ): Promise<IndexerChange> {
    const { definitionName } = spec;
    const needsFlaresolverr = schemaItem.fields.some((entry) => entry.name === FLARESOLVERR_FIELD);
    const tags = needsFlaresolverr ? [context.flaresolverrTagId] : [];
    const seeders = { [MIN_SEEDERS_FIELD]: INHERIT_PROFILE_SEEDERS };
    const existing = context.existing.find((indexer) => indexer.definitionName === definitionName);

    if (existing) {
      if (existing.enable && sameIds(existing.tags, tags) && fieldsMatch(existing, seeders)) {
        return { result: 'unchanged', definitionName };
      }
      await http.put(
        `${API_ROOT}/indexer/${existing.id}`,
        { ...applyFieldValues(existing, seeders), enable: true, tags },
        forceSave,
      );
      return { result: 'updated', definitionName };
    }

    const resource: IndexerResource = {
      ...applyFieldValues(schemaItem, seeders),
      enable: true,
      appProfileId: context.appProfileId,
      priority: INDEXER_PRIORITY,
      tags,
    };
    try {
      await http.post(`${API_ROOT}/indexer`, resource, { timeoutMs: INDEXER_LIVE_TEST_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 400) {
        return { result: 'skipped', definitionName, reason: describeRejection(error) };
      }
      throw error;
    }
    return { result: 'created', definitionName };
  }

  async function runCommand(
    body: Readonly<Record<string, unknown>>,
    label: string,
    syncOptions: ProwlarrSyncOptions,
    defaults: { timeoutMs: number; intervalMs: number },
  ): Promise<void> {
    const signal = syncOptions.signal ?? options.signal;
    const command = await http.post<CommandResource>(`${API_ROOT}/command`, body);
    const finished = await pollUntil(
      async () => {
        const current = await http.get<CommandResource>(`${API_ROOT}/command/${command.id}`);
        return current.status === 'completed' || FAILED_COMMAND_STATUSES.includes(current.status)
          ? current
          : undefined;
      },
      {
        timeoutMs: syncOptions.timeoutMs ?? defaults.timeoutMs,
        intervalMs: syncOptions.intervalMs ?? defaults.intervalMs,
        signal,
        sleep: syncOptions.sleep ?? options.sleep,
        now: syncOptions.now ?? options.now,
      },
    );
    if (finished.status !== 'completed') {
      throw new Error(
        `Prowlarr ${label} ${finished.status}${finished.message ? `: ${finished.message}` : ''}`,
      );
    }
  }

  const forceApplicationSync = (syncOptions: ProwlarrSyncOptions = {}) =>
    runCommand(
      { name: 'ApplicationIndexerSync', forceSync: true },
      'application sync',
      syncOptions,
      {
        timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
        intervalMs: DEFAULT_SYNC_INTERVAL_MS,
      },
    );

  const refreshHealth = (syncOptions: ProwlarrSyncOptions = {}) =>
    runCommand({ name: 'CheckHealth' }, 'health check', syncOptions, {
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      intervalMs: DEFAULT_SYNC_INTERVAL_MS,
    });

  async function readStatus(): Promise<ProwlarrStatus> {
    const now = (options.now ?? Date.now)();
    const [applications, indexers, statuses, health] = await Promise.all([
      http.get<ApplicationResource[]>(`${API_ROOT}/applications`),
      http.get<IndexerResource[]>(`${API_ROOT}/indexer`),
      http.get<IndexerStatusResource[]>(`${API_ROOT}/indexerstatus`),
      http.get<HealthResource[]>(`${API_ROOT}/health`),
    ]);
    return {
      applications,
      indexerCount: indexers.length,
      blocked: statuses.flatMap(({ indexerId, disabledTill }): BlockedIndexer[] =>
        disabledTill != null && Date.parse(disabledTill) > now
          ? [
              {
                indexerId,
                disabledTill,
                name: indexers.find((indexer) => indexer.id === indexerId)?.name ?? `#${indexerId}`,
              },
            ]
          : [],
      ),
      health: health.filter((entry) => entry.type !== 'ok'),
    };
  }

  return {
    http,
    waitReady: (readyOptions = {}) =>
      waitUntilReady(http, {
        service: 'Prowlarr',
        readyPath: '/ping',
        verify: getSystemStatus,
        signal: options.signal,
        ...readyOptions,
      }),
    getSystemStatus,
    ensureAdminUser: (credentials) => ensureServarrAdminUser(http, API_ROOT, credentials),
    ensureTag,
    ensureFlaresolverrProxy,
    testFlaresolverrProxy,
    ensureApplication,
    ensureStandardAppProfile,
    listIndexerSchema: () => http.get(`${API_ROOT}/indexer/schema`),
    listIndexers: () => http.get(`${API_ROOT}/indexer`),
    ensureIndexer,
    forceApplicationSync,
    refreshHealth,
    readStatus,
  };
}

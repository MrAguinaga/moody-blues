import { createHttpClient } from '../http/http.client';
import { HttpStatusError, ProvisionHttpError } from '../http/http.errors';
import type { BodylessRequestOptions, HttpClient, HttpClientOptions } from '../http/http.types';
import { waitUntilReady, type WaitUntilReadyOptions } from '../http/ready.http';
import type {
  DecypharrArr,
  DecypharrConfigView,
  QueueCleanupRule,
  RepairHealthEntry,
  VersionInfo,
} from './decypharr.types';

export type DecypharrReadyOptions = Pick<
  WaitUntilReadyOptions,
  'timeoutMs' | 'sleep' | 'now' | 'random' | 'signal'
>;

export interface DecypharrClientOptions extends Pick<
  HttpClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'timeoutMs' | 'signal'
> {
  baseUrl: string;
  apiToken: string;
}

export interface DecypharrClient {
  readonly http: HttpClient;
  waitReady(options?: DecypharrReadyOptions): Promise<void>;
  getVersion(): Promise<VersionInfo>;
  getQbitVersion(): Promise<string>;
  getConfig(): Promise<DecypharrConfigView>;
  listArrs(): Promise<DecypharrArr[]>;
  propfindWebdav(): Promise<number>;
  listBrokenEntries(): Promise<RepairHealthEntry[]>;
}

export class DecypharrConfigInvalidError extends Error {
  constructor(url: string) {
    super(
      `Decypharr answered 503 on ${url} because its setup wizard is pending, which means the seeded ` +
        'configuration is invalid; review config/decypharr/config.json (download_folder and the ' +
        'debrid api_key must be set)',
    );
    this.name = 'DecypharrConfigInvalidError';
  }
}

type Raw = Record<string, unknown>;

const WEBDAV_PATH = '/webdav/';
const REPAIR_HEALTH_PATH = '/api/repair/health';
const WIZARD_PATTERN = /setup wizard/i;
const LIST_WRAPPER_KEYS: readonly string[] = ['entries', 'data', 'items', 'health', 'arrs'];

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(source: unknown, ...path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' ? String(value) : undefined;
}

function flag(value: unknown): boolean {
  return value === true;
}

function records(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function listOf(value: unknown): Raw[] {
  if (Array.isArray(value)) {
    return records(value);
  }
  for (const key of LIST_WRAPPER_KEYS) {
    const wrapped = at(value, key);
    if (Array.isArray(wrapped)) {
      return records(wrapped);
    }
  }
  return [];
}

function queueCleanupRules(raw: unknown): QueueCleanupRule[] {
  return records(at(raw, 'queue_cleanup', 'rules')).flatMap((rule) => {
    const id = text(rule.id);
    return id === undefined ? [] : [{ id, action: text(rule.action) }];
  });
}

export function parseConfigView(raw: unknown): DecypharrConfigView {
  const debrid = records(at(raw, 'debrids'))[0];
  const port = at(raw, 'port');
  const categories = at(raw, 'categories');
  return {
    port: typeof port === 'string' || typeof port === 'number' ? port : undefined,
    useAuth: flag(at(raw, 'use_auth')),
    enableWebdavAuth: flag(at(raw, 'enable_webdav_auth')),
    downloadFolder: text(at(raw, 'download_folder')),
    defaultDownloadAction: text(at(raw, 'default_download_action')),
    categories: (Array.isArray(categories) ? categories : []).flatMap((name) => text(name) ?? []),
    arrNames: records(at(raw, 'arrs')).flatMap((arr) => text(arr.name) ?? []),
    downloadUncached: flag(at(debrid, 'download_uncached')),
    rateLimit: text(at(debrid, 'rate_limit')),
    mountType: text(at(raw, 'mount', 'type')),
    mountPath: text(at(raw, 'mount', 'mount_path')),
    vfsCacheMode: text(at(raw, 'mount', 'rclone', 'vfs_cache_mode')),
    vfsCacheMaxSize: text(at(raw, 'mount', 'rclone', 'vfs_cache_max_size')),
    vfsCacheMaxAge: text(at(raw, 'mount', 'rclone', 'vfs_cache_max_age')),
    repairEnabled: flag(at(raw, 'repair', 'enabled')),
    repairSchedule: text(at(raw, 'repair', 'schedule')),
    repairAutoRepair: flag(at(raw, 'repair', 'auto_repair')),
    queueCleanupRules: queueCleanupRules(raw),
    hearsayDisabled: flag(at(raw, 'hearsay', 'disabled')),
  };
}

export function parseArrs(raw: unknown): DecypharrArr[] {
  return listOf(raw).flatMap((arr) => {
    const name = text(arr.name);
    return name === undefined
      ? []
      : [
          {
            name,
            host: text(arr.host) ?? '',
            token: text(arr.token) ?? '',
            source: text(arr.source),
          },
        ];
  });
}

export function parseRepairEntries(raw: unknown): RepairHealthEntry[] {
  return listOf(raw).map((entry) => ({
    name: text(entry.name) ?? text(entry.path),
    status: text(entry.status),
  }));
}

export function parseVersion(raw: unknown): VersionInfo {
  const version = text(at(raw, 'version'));
  if (version === undefined) {
    throw new Error('Decypharr GET /version did not return a "version" value');
  }
  return { version, channel: text(at(raw, 'channel')) };
}

export function createDecypharrClient(options: DecypharrClientOptions): DecypharrClient {
  const http = createHttpClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    sleep: options.sleep,
    random: options.random,
    retry: options.retry,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const authorization = { Authorization: `Bearer ${options.apiToken}` };

  function sanitize(error: unknown): unknown {
    if (
      error instanceof HttpStatusError &&
      error.status === 503 &&
      WIZARD_PATTERN.test(error.bodySnippet)
    ) {
      return new DecypharrConfigInvalidError(error.url);
    }
    if (error instanceof ProvisionHttpError && error.message.includes(options.apiToken)) {
      return new Error(error.message.split(options.apiToken).join('***'));
    }
    return error;
  }

  async function guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw sanitize(error);
    }
  }

  // Readiness is awaited before these calls and the wizard 503 never clears on its own, so retrying only delays the diagnosis.
  const authed = <T>(path: string, request: BodylessRequestOptions = {}) =>
    guarded(() =>
      http.get<T>(path, { ...request, headers: authorization, retry: { attempts: 1 } }),
    );

  return {
    http,
    waitReady: (ready = {}) =>
      waitUntilReady(http, {
        service: 'Decypharr',
        readyPath: '/version',
        signal: options.signal,
        ...ready,
      }),
    getVersion: async () => parseVersion(await guarded(() => http.get('/version'))),
    getQbitVersion: () =>
      guarded(() => http.get<string>('/api/v2/app/version', { responseType: 'text' })).then(
        (version) => version.trim(),
      ),
    getConfig: async () => parseConfigView(await authed('/api/config')),
    listArrs: async () => parseArrs(await authed('/api/arrs')),
    propfindWebdav: () =>
      guarded(() =>
        http.request<number>('PROPFIND', WEBDAV_PATH, {
          headers: { Depth: '0' },
          responseType: 'status',
        }),
      ),
    listBrokenEntries: async () =>
      parseRepairEntries(await authed(REPAIR_HEALTH_PATH, { query: { status: 'broken' } })),
  };
}

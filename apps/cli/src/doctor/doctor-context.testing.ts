import {
  createArrClient,
  createBazarrClient,
  createDecypharrClient,
  createDefaultConfig,
  createJellyfinClient,
  createLayout,
  createProwlarrClient,
  createSeerrClient,
  type FetchLike,
  type QueueRecord,
} from '@moody-blues/provisioner';

import type { ServiceStatus, StackStatus } from '../docker';
import { buildStackStatus } from '../docker';
import type { DoctorClients, DoctorContext, LogTail } from './doctor.types';
import { redactSecrets } from './doctor-redact.utils';

export const TEST_NOW = Date.parse('2026-10-09T12:00:00.000Z');
export const MINUTE_MS = 60_000;

export const TEST_KEYS = {
  sonarr: 'sonarr-secret-key',
  radarr: 'radarr-secret-key',
  prowlarr: 'prowlarr-secret-key',
  bazarr: 'bazarr-secret-key',
  seerr: 'seerr-secret-key',
  decypharr: 'decypharr-secret-token',
  jellyfin: 'jellyfin-secret-key',
  realDebrid: 'realdebrid-secret-token',
};

export const TEST_SECRETS = Object.values(TEST_KEYS);

type StubReply = { status?: number; body?: unknown; text?: string } | Error;
type StubRoute = StubReply | ((request: StubRequest) => StubReply);

export interface StubRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

export interface StubFetch {
  fetch: FetchLike;
  requests: StubRequest[];
  on(method: string, path: string, route: StubRoute): void;
  writes(): StubRequest[];
}

export function createStubFetch(): StubFetch {
  const routes = new Map<string, StubRoute>();
  const requests: StubRequest[] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const request: StubRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(new Headers(init?.headers)),
    };
    requests.push(request);

    const route = routes.get(`${request.method} ${request.path}`);
    const reply = typeof route === 'function' ? route(request) : route;
    if (reply instanceof Error) {
      throw reply;
    }
    if (!reply) {
      return new Response(JSON.stringify({ message: 'No stub route' }), { status: 404 });
    }
    const status = reply.status ?? 200;
    const payload = reply.text ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
    return new Response(status === 204 ? null : payload, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    fetch: fetchImpl,
    requests,
    on: (method, path, route) => {
      routes.set(`${method.toUpperCase()} ${path}`, route);
    },
    writes: () => requests.filter((request) => !['GET', 'HEAD'].includes(request.method)),
  };
}

export interface StubArr extends StubFetch {
  queue: QueueRecord[];
}

export function createStubArr(
  version: string,
  queue: readonly QueueRecord[] = [],
  health: unknown[] = [],
): StubArr {
  const stub = createStubFetch() as StubArr;
  stub.queue = queue.map((record) => ({ ...record }));
  stub.on('GET', '/api/v3/system/status', { body: { appName: 'Arr', version } });
  stub.on('GET', '/api/v3/health', { body: health });
  stub.on('GET', '/api/v3/queue', (request) => {
    const page = Number(request.query.page ?? 1);
    const pageSize = Number(request.query.pageSize ?? 10);
    return {
      body: {
        page,
        pageSize,
        totalRecords: stub.queue.length,
        records: stub.queue.slice((page - 1) * pageSize, page * pageSize),
      },
    };
  });
  return stub;
}

export function stubQueueDelete(stub: StubArr, id: number, status = 200): void {
  stub.on('DELETE', `/api/v3/queue/${id}`, () => {
    if (status === 200) {
      stub.queue = stub.queue.filter((record) => record.id !== id);
    }
    return { status, body: status === 200 ? {} : { message: 'rejected' } };
  });
}

const BASE_SERVICES = [
  'bazarr',
  'caddy',
  'flaresolverr',
  'jellyfin',
  'prowlarr',
  'radarr',
  'seerr',
  'sonarr',
];

export function runningService(service: string, patch: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    service,
    state: 'running',
    health: 'healthy',
    exitCode: 0,
    publishedPorts: [],
    ...patch,
  };
}

export interface TestContextOptions {
  storage?: boolean;
  now?: number;
  stuckAfterMs?: number;
  services?: Record<string, Partial<ServiceStatus>>;
  stack?: StackStatus | Error;
  env?: Record<string, string>;
  log?: LogTail | Error | (() => LogTail);
  directories?: Record<string, string[] | Error>;
  clients?: Partial<DoctorClients>;
  stubs?: Partial<Record<keyof DoctorClients, StubFetch>>;
  timeZone?: string;
}

export interface TestContext {
  ctx: DoctorContext;
  stubs: Record<keyof DoctorClients, StubFetch>;
  logReads: string[];
}

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const storage = options.storage ?? false;
  const names = storage ? [...BASE_SERVICES, 'decypharr'].sort() : BASE_SERVICES;
  const defaultStack = buildStackStatus(
    'moody-blues',
    names.map((name) => runningService(name, options.services?.[name])),
    new Date(options.now ?? TEST_NOW).toISOString(),
  );
  const stack = options.stack ?? defaultStack;

  const stubs = {
    sonarr: options.stubs?.sonarr ?? createStubArr('4.0.20'),
    radarr: options.stubs?.radarr ?? createStubArr('6.4.4'),
    prowlarr: options.stubs?.prowlarr ?? createStubFetch(),
    bazarr: options.stubs?.bazarr ?? createStubFetch(),
    jellyfin: options.stubs?.jellyfin ?? createStubFetch(),
    seerr: options.stubs?.seerr ?? createStubFetch(),
    decypharr: options.stubs?.decypharr ?? createStubFetch(),
  };
  const transport = { sleep: async () => undefined, retry: { attempts: 1 } };
  const clients: DoctorClients = {
    sonarr: createArrClient({
      kind: 'sonarr',
      baseUrl: 'http://127.0.0.1:8989',
      apiKey: TEST_KEYS.sonarr,
      fetch: stubs.sonarr.fetch,
      ...transport,
    }),
    radarr: createArrClient({
      kind: 'radarr',
      baseUrl: 'http://127.0.0.1:7878',
      apiKey: TEST_KEYS.radarr,
      fetch: stubs.radarr.fetch,
      ...transport,
    }),
    prowlarr: createProwlarrClient({
      baseUrl: 'http://127.0.0.1:9696',
      apiKey: TEST_KEYS.prowlarr,
      fetch: stubs.prowlarr.fetch,
      now: () => options.now ?? TEST_NOW,
      ...transport,
    }),
    bazarr: createBazarrClient({
      baseUrl: 'http://127.0.0.1:6767',
      apiKey: TEST_KEYS.bazarr,
      fetch: stubs.bazarr.fetch,
      ...transport,
    }),
    jellyfin: createJellyfinClient({
      baseUrl: 'http://127.0.0.1:8096',
      fetch: stubs.jellyfin.fetch,
      ...transport,
    }),
    seerr: createSeerrClient({
      baseUrl: 'http://127.0.0.1:5055',
      apiKey: TEST_KEYS.seerr,
      fetch: stubs.seerr.fetch,
      ...transport,
    }),
    decypharr: createDecypharrClient({
      baseUrl: 'http://127.0.0.1:8282',
      apiToken: TEST_KEYS.decypharr,
      fetch: stubs.decypharr.fetch,
      ...transport,
    }),
    ...options.clients,
  };

  const config = createDefaultConfig({
    host: { puid: 1000, pgid: 1000 },
    storage: { enabled: storage },
  });
  const layout = createLayout('/mb-test');
  const memos = new Map<string, Promise<unknown>>();
  const logReads: string[] = [];

  const ctx: DoctorContext = {
    installation: { layout, config, env: { MB_HOME: layout.root, ...options.env } },
    provision: {
      config,
      secrets: {
        rdApiToken: TEST_KEYS.realDebrid,
        adminUsername: 'Admin',
        adminPassword: 'p@ss word',
      },
      layout,
      identity: config.host,
      runtime: {} as DoctorContext['provision']['runtime'],
      flags: new Map(),
      cliVersion: '9.9.9',
    },
    checkContext: { mode: 'local', transcoding: 'off', home: layout.root },
    clients,
    signal: new AbortController().signal,
    stuckAfterMs: options.stuckAfterMs ?? 10 * MINUTE_MS,
    decypharrLogPath: '/mb-test/config/decypharr/logs/decypharr.log',
    timeZone: options.timeZone ?? 'UTC',
    stack: async () => {
      if (stack instanceof Error) {
        throw stack;
      }
      return stack;
    },
    memo: <T>(key: string, factory: () => Promise<T>): Promise<T> => {
      if (!memos.has(key)) {
        memos.set(key, factory());
      }
      return memos.get(key) as Promise<T>;
    },
    forget: (key) => {
      memos.delete(key);
    },
    now: () => options.now ?? TEST_NOW,
    readLogTail: async (path) => {
      logReads.push(path);
      if (typeof options.log === 'function') {
        return options.log();
      }
      if (options.log instanceof Error || options.log === undefined) {
        throw options.log ?? Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return options.log;
    },
    readDirectory: async (path) => {
      const entry = options.directories?.[path];
      if (entry === undefined) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      if (entry instanceof Error) {
        throw entry;
      }
      return entry;
    },
    redact: (text) => redactSecrets(text, TEST_SECRETS),
  };

  return { ctx, stubs, logReads };
}

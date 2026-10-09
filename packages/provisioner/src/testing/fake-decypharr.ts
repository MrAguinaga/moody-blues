import type { HostIdentity } from '../config';
import type { FetchLike } from '../http/http.types';
import { renderDecypharrConfig } from '../preseed/decypharr-config.preseed';
import type { DecypharrSeedInput } from '../preseed/preseed.types';
import { type FakeRequest, toFakeRequest } from './fake-fetch';

type Raw = Record<string, unknown>;

export interface FakeDecypharrOptions {
  apiToken: string;
  baseUrl?: string;
  seed?: Partial<DecypharrSeedInput>;
  config?: (config: Raw) => void;
  wizardPending?: boolean;
  webdavStatus?: number;
  brokenEntries?: readonly Raw[];
  repairHealth?: unknown;
  repairHealthStatus?: number;
  pingFailures?: number;
}

export interface FakeDecypharrState {
  config: Raw;
  wizardPending: boolean;
  webdavStatus: number;
  brokenEntries: Raw[];
  arrSource: string;
  admin?: { username: string; password: string };
}

export interface FakeDecypharr {
  fetch: FetchLike;
  baseUrl: string;
  apiToken: string;
  requests: FakeRequest[];
  state: FakeDecypharrState;
  count(method: string, path?: string): number;
  writes(): FakeRequest[];
  arrs(): Raw[];
}

const HOST: HostIdentity = { puid: 1000, pgid: 1000 };
const DEFAULT_SEED: DecypharrSeedInput = {
  rdApiToken: 'rd-token',
  apiToken: 'decypharr-token',
  sonarrApiKey: 'sonarr-key',
  radarrApiKey: 'radarr-key',
  downloadUncached: false,
  host: HOST,
  sessionSecret: 'session-secret',
  strmSecret: 'strm-secret',
};
const WIZARD_EXEMPT: readonly string[] = ['/api/config', '/version'];
const MULTISTATUS_XML = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"></D:multistatus>';

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createFakeDecypharr(options: FakeDecypharrOptions): FakeDecypharr {
  const { apiToken } = options;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:8282';
  const seed: DecypharrSeedInput = { ...DEFAULT_SEED, ...options.seed, apiToken };
  const config = JSON.parse(renderDecypharrConfig(seed)) as Raw;
  options.config?.(config);
  const state: FakeDecypharrState = {
    config,
    wizardPending: options.wizardPending ?? false,
    webdavStatus: options.webdavStatus ?? 207,
    brokenEntries: (options.brokenEntries ?? []).map((entry) => ({ ...entry })),
    arrSource: 'config',
  };
  const requests: FakeRequest[] = [];
  let pingFailures = options.pingFailures ?? 0;

  const arrs = (): Raw[] =>
    ((state.config.arrs as Raw[] | undefined) ?? []).map((arr) => ({
      ...arr,
      type: arr.name,
      source: arr.source ?? state.arrSource,
    }));

  function handle(request: FakeRequest): Response {
    const { method, path } = request;
    if (method === 'GET' && path === '/version') {
      if (pingFailures > 0) {
        pingFailures -= 1;
        return json(503);
      }
      return json(200, { version: '2.7', channel: 'stable' });
    }
    if (method === 'GET' && path === '/api/v2/app/version') {
      return new Response('v4.3.9', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    if (method === 'PROPFIND' && path === '/webdav/') {
      return new Response(state.webdavStatus === 207 ? MULTISTATUS_XML : 'unauthorized', {
        status: state.webdavStatus,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    if (state.wizardPending && path.startsWith('/api/') && !WIZARD_EXEMPT.includes(path)) {
      return new Response('[error] Setup wizard must be completed first', { status: 503 });
    }
    if (request.headers.authorization !== `Bearer ${apiToken}`) {
      return json(401, { error: 'Unauthorized' });
    }
    if (method === 'POST' && path === '/api/update-auth') {
      const body = request.body as Raw | undefined;
      const { username, password } = body ?? {};
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        username === '' ||
        password === '' ||
        body?.confirm_password !== password
      ) {
        return json(400, { error: `Invalid credentials for ${String(password)}` });
      }
      state.admin = { username, password };
      return json(200, { status: 'ok' });
    }
    if (method === 'GET' && path === '/api/config') {
      return json(200, structuredClone(state.config));
    }
    if (method === 'GET' && path === '/api/arrs') {
      return json(200, arrs());
    }
    if (method === 'GET' && path === '/api/repair/health') {
      if (options.repairHealthStatus !== undefined) {
        return json(options.repairHealthStatus, { error: 'repair health failed' });
      }
      const entries = request.query.status === 'broken' ? state.brokenEntries : [];
      return json(200, options.repairHealth ?? entries);
    }
    return json(404, { error: `No fake route for ${method} ${path}` });
  }

  const fetchImpl: FetchLike = async (input, init) => {
    const request = toFakeRequest(input, init);
    requests.push(request);
    return handle(request);
  };

  return {
    fetch: fetchImpl,
    baseUrl,
    apiToken,
    requests,
    state,
    count: (method, path) =>
      requests.filter(
        (request) =>
          request.method === method.toUpperCase() && (path === undefined || request.path === path),
      ).length,
    writes: () =>
      requests.filter((request) => request.method !== 'GET' && request.method !== 'PROPFIND'),
    arrs,
  };
}

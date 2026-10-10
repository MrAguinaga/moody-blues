import type { FetchLike } from '../http/http.types';
import type {
  ArrInstance,
  JellyfinSettings,
  MainSettings,
  SeerrArrKind,
  SeerrLibrary,
  SeerrMedia,
  SeerrUser,
} from '../seerr/seerr.types';
import { type FakeRequest, toFakeRequest } from './fake-fetch';

type Raw = Record<string, unknown>;

export interface FakeSeerrJellyfinAccount {
  username: string;
  password: string;
  isAdministrator: boolean;
}

export interface FakeSeerrOptions {
  baseUrl?: string;
  apiKey?: string;
  accounts?: readonly FakeSeerrJellyfinAccount[];
  jellyfinLibraries?: readonly SeerrLibrary[];
  signedIn?: boolean;
  halfInitialized?: boolean;
  initialized?: boolean;
  main?: Raw;
  libraries?: readonly SeerrLibrary[];
  externalHostname?: string;
  instances?: Partial<Record<SeerrArrKind, readonly ArrInstance[]>>;
  hideInstanceKeys?: boolean;
  readyAfterFailures?: number;
  failTest?: boolean;
  failExternalHostname?: boolean;
  failScan?: boolean;
  media?: readonly SeerrMedia[];
}

export interface FakeSeerrState {
  user?: SeerrUser;
  initialized: boolean;
  mediaServerType: number;
  main: MainSettings;
  jellyfin?: JellyfinSettings;
  instances: Record<SeerrArrKind, ArrInstance[]>;
  jellyfinHostname?: string;
  logins: number;
  scans: number;
  tested: Raw[];
  media: SeerrMedia[];
}

export interface FakeSeerr {
  fetch: FetchLike;
  baseUrl: string;
  apiKey: string;
  requests: FakeRequest[];
  state: FakeSeerrState;
  count(method: string, path?: string): number;
  writes(): FakeRequest[];
}

export const FAKE_SEERR_API_KEY = 'fake-seerr-api-key';
export const FAKE_SEERR_JELLYFIN_KEY = 'fake-seerr-jellyfin-key';
export const FAKE_SEERR_SESSION_COOKIE = 'connect.sid=fake-seerr-session';
const UNCONFIGURED = 4;
const JELLYFIN = 2;
const ADMIN_PERMISSION = 2;

const REQUIRED_FIELDS: Record<SeerrArrKind, readonly string[]> = {
  sonarr: [
    'name',
    'hostname',
    'port',
    'apiKey',
    'useSsl',
    'activeProfileId',
    'activeProfileName',
    'activeDirectory',
    'is4k',
    'enableSeasonFolders',
    'isDefault',
  ],
  radarr: [
    'name',
    'hostname',
    'port',
    'apiKey',
    'useSsl',
    'activeProfileId',
    'activeProfileName',
    'activeDirectory',
    'is4k',
    'minimumAvailability',
    'isDefault',
  ],
};

function defaultMain(): MainSettings {
  return {
    apiKey: FAKE_SEERR_API_KEY,
    applicationTitle: 'Seerr',
    applicationUrl: '',
    cacheImages: false,
    defaultPermissions: 32,
    defaultQuotas: { movie: {}, tv: {} },
    hideAvailable: false,
    localLogin: true,
    mediaServerLogin: true,
    newPlexLogin: true,
    discoverRegion: '',
    streamingRegion: '',
    originalLanguage: '',
    mediaServerType: UNCONFIGURED,
    partialRequestsEnabled: true,
    locale: 'en',
  };
}

function reply(status: number, body?: unknown): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deepMerge(target: Raw, source: Raw): Raw {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    const bothObjects =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current);
    target[key] = bothObjects ? deepMerge(current as Raw, value as Raw) : structuredClone(value);
  }
  return target;
}

function typeMatches(value: unknown, field: string): boolean {
  if (['name', 'hostname', 'apiKey', 'activeProfileName', 'activeDirectory'].includes(field)) {
    return typeof value === 'string';
  }
  if (['port', 'activeProfileId'].includes(field)) {
    return typeof value === 'number';
  }
  if (['useSsl', 'is4k', 'isDefault', 'enableSeasonFolders'].includes(field)) {
    return typeof value === 'boolean';
  }
  return true;
}

export function createFakeSeerr(options: FakeSeerrOptions = {}): FakeSeerr {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:5055';
  const apiKey = options.apiKey ?? FAKE_SEERR_API_KEY;
  const accounts = options.accounts ?? [
    { username: 'Admin', password: 'p@ss word', isAdministrator: true },
  ];
  const jellyfinLibraries = (
    options.jellyfinLibraries ?? [
      { id: 'movies-id', name: 'Películas', enabled: false, type: 'movie' },
      { id: 'series-id', name: 'Series', enabled: false, type: 'show' },
    ]
  ).map((library) => ({ ...library, enabled: false }));
  const signedIn = options.signedIn === true || options.initialized === true;

  const state: FakeSeerrState = {
    initialized: options.initialized === true,
    mediaServerType: signedIn || options.halfInitialized ? JELLYFIN : UNCONFIGURED,
    main: { ...defaultMain(), ...options.main },
    instances: {
      sonarr: structuredClone(options.instances?.sonarr ?? []) as ArrInstance[],
      radarr: structuredClone(options.instances?.radarr ?? []) as ArrInstance[],
    },
    logins: 0,
    scans: 0,
    tested: [],
    media: structuredClone([...(options.media ?? [])]),
  };
  if (signedIn) {
    state.user = { id: 1, permissions: ADMIN_PERMISSION };
    state.jellyfin = {
      name: 'Moody Blues',
      ip: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      externalHostname: options.externalHostname ?? '',
      jellyfinForgotPasswordUrl: '',
      apiKey: FAKE_SEERR_JELLYFIN_KEY,
      serverId: 'fake-server',
      libraries: structuredClone(options.libraries ?? []) as SeerrLibrary[],
    };
  }
  const requests: FakeRequest[] = [];
  let readyFailures = options.readyAfterFailures ?? 0;
  const nextId: Record<SeerrArrKind, number> = { sonarr: 0, radarr: 0 };

  const publicView = () => ({
    initialized: state.initialized,
    applicationTitle: state.main.applicationTitle,
    mediaServerType: state.mediaServerType,
    locale: state.main.locale,
  });

  function login(body: Raw): Response {
    state.logins += 1;
    const account = accounts.find((candidate) => candidate.username === body.username);
    if (!account || account.password !== body.password) {
      return reply(401, { message: 'INVALID_CREDENTIALS' });
    }
    if (!account.isAdministrator) {
      return reply(403, { message: 'NOT_ADMIN' });
    }
    if (!state.user) {
      if (body.serverType !== JELLYFIN) {
        return reply(500, { message: 'NO_ADMIN_USER' });
      }
      state.user = { id: 1, permissions: ADMIN_PERMISSION };
    }
    if (state.jellyfin?.ip && body.hostname !== undefined) {
      return reply(500, { message: 'Jellyfin hostname already configured' });
    }
    if (!state.jellyfin) {
      state.jellyfinHostname = String(body.hostname);
      state.jellyfin = {
        name: 'Moody Blues',
        ip: String(body.hostname),
        port: Number(body.port),
        useSsl: body.useSsl === true,
        urlBase: String(body.urlBase ?? ''),
        externalHostname: '',
        jellyfinForgotPasswordUrl: '',
        apiKey: FAKE_SEERR_JELLYFIN_KEY,
        serverId: 'fake-server',
        libraries: [],
      };
      state.mediaServerType = JELLYFIN;
    }
    return reply(200, structuredClone(state.user));
  }

  function jellyfinSettings(request: FakeRequest): Response {
    const { method, path } = request;
    const jellyfin = state.jellyfin as JellyfinSettings;
    const libraries = (jellyfin.libraries ?? []) as SeerrLibrary[];
    const body = (request.body ?? {}) as Raw;
    if (method === 'GET' && path === '/api/v1/settings/jellyfin') {
      return reply(200, structuredClone(jellyfin));
    }
    if (method === 'POST' && path === '/api/v1/settings/jellyfin') {
      if (options.failExternalHostname) {
        return reply(500, { message: 'Unable to reach the media server' });
      }
      Object.assign(jellyfin, structuredClone(body));
      return reply(200, structuredClone(jellyfin));
    }
    if (method === 'POST' && path === '/api/v1/settings/jellyfin/library/sync') {
      if (jellyfinLibraries.length === 0) {
        return reply(404, { message: 'SYNC_ERROR_NO_LIBRARIES' });
      }
      jellyfin.libraries = jellyfinLibraries.map((library) => ({
        ...library,
        enabled: libraries.find((known) => known.id === library.id)?.enabled ?? false,
      }));
      return reply(200, structuredClone(jellyfin.libraries));
    }
    const libraryMatch = /^\/api\/v1\/settings\/jellyfin\/library\/([^/]+)$/.exec(path);
    if (method === 'PUT' && libraryMatch) {
      const library = libraries.find((candidate) => candidate.id === libraryMatch[1]);
      if (!library) {
        return reply(404, { message: 'library not found' });
      }
      if (typeof body.enabled !== 'boolean') {
        return reply(400, { message: 'request/body/enabled must be boolean' });
      }
      library.enabled = body.enabled;
      return reply(200, structuredClone(library));
    }
    if (method === 'POST' && path === '/api/v1/settings/jellyfin/sync') {
      if (options.failScan) {
        return reply(500, { message: 'scan failed' });
      }
      state.scans += 1;
      return reply(200, { running: true });
    }
    return reply(404, { message: `No fake route for ${method} ${path}` });
  }

  function arrSettings(request: FakeRequest, kind: SeerrArrKind): Response {
    const { method, path } = request;
    const list = state.instances[kind];
    const body = (request.body ?? {}) as Raw;
    const root = `/api/v1/settings/${kind}`;
    const exposed = (instance: ArrInstance): ArrInstance => {
      const copy = structuredClone(instance);
      if (options.hideInstanceKeys) {
        delete copy.apiKey;
      }
      return copy;
    };
    if (method === 'GET' && path === root) {
      return reply(200, list.map(exposed));
    }
    if (method === 'POST' && path === `${root}/test`) {
      if (options.failTest) {
        return reply(500, { message: 'Failed to connect' });
      }
      state.tested.push(structuredClone(body));
      return reply(200, { profiles: [], rootFolders: [], tags: [] });
    }
    const invalid = (payload: Raw): string | undefined =>
      'id' in payload
        ? 'id'
        : REQUIRED_FIELDS[kind].find((field) => !typeMatches(payload[field], field));
    if (method === 'POST' && path === root) {
      const missing = invalid(body);
      if (missing) {
        return reply(400, { message: `request/body/${missing} is invalid` });
      }
      const created = { ...structuredClone(body), id: nextId[kind] } as ArrInstance;
      nextId[kind] += 1;
      list.push(created);
      return reply(201, structuredClone(created));
    }
    const idMatch = new RegExp(`^${root}/(\\d+)$`).exec(path);
    if (method === 'PUT' && idMatch) {
      const index = list.findIndex((instance) => instance.id === Number(idMatch[1]));
      if (index === -1) {
        return reply(404, { message: 'instance not found' });
      }
      const missing = invalid(body);
      if (missing) {
        return reply(400, { message: `request/body/${missing} is invalid` });
      }
      const replaced = { ...structuredClone(body), id: Number(idMatch[1]) } as ArrInstance;
      list[index] = replaced;
      return reply(200, structuredClone(replaced));
    }
    return reply(404, { message: `No fake route for ${method} ${path}` });
  }

  function authenticated(request: FakeRequest): Response {
    const { method, path } = request;
    if (path === '/api/v1/auth/me') {
      return reply(200, structuredClone(state.user));
    }
    if (method === 'GET' && path === '/api/v1/settings/main') {
      return reply(200, structuredClone(state.main));
    }
    if (method === 'POST' && path === '/api/v1/settings/main') {
      deepMerge(state.main as Raw, (request.body ?? {}) as Raw);
      return reply(200, structuredClone(state.main));
    }
    if (path.startsWith('/api/v1/settings/jellyfin')) {
      return jellyfinSettings(request);
    }
    for (const kind of ['sonarr', 'radarr'] as const) {
      if (path === `/api/v1/settings/${kind}` || path.startsWith(`/api/v1/settings/${kind}/`)) {
        return arrSettings(request, kind);
      }
    }
    if (method === 'GET' && path === '/api/v1/media') {
      const take = Number(request.query.take ?? 20);
      const skip = Number(request.query.skip ?? 0);
      return reply(200, {
        pageInfo: { pages: Math.ceil(state.media.length / take), results: state.media.length },
        results: structuredClone(state.media.slice(skip, skip + take)),
      });
    }
    const mediaMatch = /^\/api\/v1\/media\/(\d+)$/.exec(path);
    if (method === 'DELETE' && mediaMatch) {
      const id = Number(mediaMatch[1]);
      if (!state.media.some((media) => media.id === id)) {
        return reply(404, { message: 'Media not found' });
      }
      state.media = state.media.filter((media) => media.id !== id);
      return reply(204);
    }
    if (method === 'POST' && path === '/api/v1/settings/initialize') {
      state.initialized = true;
      return reply(200, publicView());
    }
    return reply(404, { message: `No fake route for ${method} ${path}` });
  }

  const fetchImpl: FetchLike = async (input, init) => {
    const request = toFakeRequest(input, init);
    requests.push(request);
    const { method, path } = request;

    if (method === 'GET' && path === '/api/v1/settings/public') {
      if (readyFailures > 0) {
        readyFailures -= 1;
        return new Response('Service Unavailable', {
          status: 503,
          headers: { 'Retry-After': '1' },
        });
      }
      return reply(200, publicView());
    }
    if (method === 'POST' && path === '/api/v1/auth/jellyfin') {
      const response = login((request.body ?? {}) as Raw);
      response.headers.set('Set-Cookie', `${FAKE_SEERR_SESSION_COOKIE}; Path=/; HttpOnly`);
      return response;
    }
    if (request.headers['x-api-key'] !== apiKey) {
      return reply(401, { message: "cookie 'connect.sid' required" });
    }
    if (!state.user) {
      return reply(403, {
        status: 403,
        error: 'You do not have permission to access this endpoint',
      });
    }
    return authenticated(request);
  };

  return {
    fetch: fetchImpl,
    baseUrl,
    apiKey,
    requests,
    state,
    count: (method, path) =>
      requests.filter(
        (request) =>
          request.method === method.toUpperCase() && (path === undefined || request.path === path),
      ).length,
    writes: () => requests.filter((request) => request.method !== 'GET'),
  };
}

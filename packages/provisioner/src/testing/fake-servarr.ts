import type { ArrKind } from '../arr/arr.types';
import type { FetchLike } from '../http/http.types';
import type { ProviderField } from '../http/provider-fields';
import { type FakeRequest, toFakeRequest } from './fake-fetch';

type Resource = Record<string, unknown>;

export interface FakeServarrOptions {
  kind: ArrKind;
  apiKey: string;
  baseUrl?: string;
  existingFolders?: readonly string[];
  decypharrReachable?: boolean;
  pingFailures?: number;
}

export interface FakeServarrState {
  config: Record<string, Resource>;
  rootFolders: Resource[];
  downloadClients: Resource[];
}

export interface FakeServarr {
  fetch: FetchLike;
  baseUrl: string;
  apiKey: string;
  requests: FakeRequest[];
  state: FakeServarrState;
  count(method: string, path?: string): number;
  writes(): FakeRequest[];
  canLogin(username: string, password: string): boolean;
}

const MASK = '********';
const DEFAULT_FOLDERS: Readonly<Record<ArrKind, string>> = {
  sonarr: '/data/media/tv',
  radarr: '/data/media/movies',
};

function hashPassword(password: string): string {
  return `hash:${Buffer.from(password).toString('base64')}`;
}

function field(name: string, value: unknown, privacy = 'normal'): ProviderField {
  return { name, value, privacy };
}

function qbittorrentSchema(kind: ArrKind): Resource {
  const categoryFields =
    kind === 'sonarr'
      ? [
          field('tvCategory', 'tv-sonarr'),
          field('tvImportedCategory', null),
          field('recentTvPriority', 0),
          field('olderTvPriority', 0),
        ]
      : [
          field('movieCategory', 'radarr'),
          field('movieImportedCategory', null),
          field('recentMoviePriority', 0),
          field('olderMoviePriority', 0),
        ];
  return {
    enable: false,
    protocol: 'torrent',
    priority: 1,
    removeCompletedDownloads: true,
    removeFailedDownloads: true,
    name: '',
    implementationName: 'qBittorrent',
    implementation: 'QBittorrent',
    configContract: 'QBittorrentSettings',
    tags: [],
    fields: [
      field('host', 'localhost'),
      field('port', 8080),
      field('useSsl', false),
      field('urlBase', null),
      field('apiKey', null, 'apiKey'),
      field('username', null, 'userName'),
      field('password', null, 'password'),
      ...categoryFields,
      field('initialState', 0),
      field('sequentialOrder', false),
      field('firstAndLast', false),
      field('contentLayout', 0),
    ],
  };
}

function defaultConfig(kind: ArrKind): Record<string, Resource> {
  const host = {
    bindAddress: '*',
    port: kind === 'sonarr' ? 8989 : 7878,
    authenticationMethod: 'forms',
    authenticationRequired: 'enabled',
    allowedHosts: '',
    analyticsEnabled: true,
    username: '',
    password: '',
    passwordConfirmation: '',
    logLevel: 'debug',
    logSizeLimit: 1,
    branch: kind === 'sonarr' ? 'main' : 'master',
    instanceName: kind === 'sonarr' ? 'Sonarr' : 'Radarr',
    backupInterval: 7,
    backupRetention: 28,
    id: 1,
  };
  const downloadclient = {
    downloadClientWorkingFolders: '_UNPACK_|_FAILED_',
    enableCompletedDownloadHandling: true,
    autoRedownloadFailed: true,
    autoRedownloadFailedFromInteractiveSearch: true,
    ...(kind === 'radarr' ? { checkForFinishedDownloadInterval: 1 } : {}),
    id: 1,
  };
  const mediamanagement = {
    recycleBin: '',
    recycleBinCleanupDays: 7,
    downloadPropersAndRepacks: 'preferAndUpgrade',
    deleteEmptyFolders: false,
    rescanAfterRefresh: 'always',
    skipFreeSpaceCheckWhenImporting: false,
    minimumFreeSpaceWhenImporting: 100,
    copyUsingHardlinks: true,
    enableMediaInfo: true,
    id: 1,
  };
  const naming =
    kind === 'sonarr'
      ? {
          renameEpisodes: false,
          replaceIllegalCharacters: true,
          standardEpisodeFormat: '{Series Title} - S{season:00}E{episode:00} - {Episode Title}',
          seriesFolderFormat: '{Series Title}',
          seasonFolderFormat: 'Season {season}',
          id: 1,
        }
      : {
          renameMovies: false,
          replaceIllegalCharacters: true,
          standardMovieFormat: '{Movie Title} ({Release Year}) {Quality Full}',
          movieFolderFormat: '{Movie Title} ({Release Year})',
          id: 1,
        };
  const ui = {
    firstDayOfWeek: 0,
    theme: 'auto',
    uiLanguage: 1,
    ...(kind === 'radarr' ? { movieInfoLanguage: 1 } : {}),
    id: 1,
  };
  const indexer = {
    minimumAge: 0,
    retention: 0,
    maximumSize: 0,
    rssSyncInterval: kind === 'sonarr' ? 15 : 30,
    ...(kind === 'radarr'
      ? { availabilityDelay: 0, allowHardcodedSubs: false, whitelistedHardcodedSubs: '' }
      : {}),
    id: 1,
  };
  return { host, downloadclient, mediamanagement, naming, ui, indexer };
}

const LANGUAGES = [
  { id: -2, name: 'Original' },
  { id: 1, name: 'English' },
  { id: 2, name: 'French' },
  { id: 3, name: 'Spanish' },
  { id: 34, name: 'Spanish (Latino)' },
];

function json(status: number, body?: unknown): Response {
  if (body === undefined || status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validation(propertyName: string, errorMessage: string, detailedDescription?: string) {
  return json(400, [
    {
      propertyName,
      errorMessage,
      ...(detailedDescription ? { detailedDescription } : {}),
      severity: 'error',
    },
  ]);
}

function fieldValue(resource: Resource, name: string): unknown {
  return (resource.fields as ProviderField[]).find((candidate) => candidate.name === name)?.value;
}

function maskPasswords(resource: Resource): Resource {
  const clone = structuredClone(resource);
  for (const entry of clone.fields as ProviderField[]) {
    if (entry.name === 'password' && entry.value) {
      entry.value = MASK;
    }
  }
  return clone;
}

export function createFakeServarr(options: FakeServarrOptions): FakeServarr {
  const { kind, apiKey } = options;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:8989';
  const folders = new Set(options.existingFolders ?? [DEFAULT_FOLDERS[kind]]);
  const decypharrReachable = options.decypharrReachable ?? false;
  let pingFailures = options.pingFailures ?? 0;
  let nextClientId = 1;
  let nextFolderId = 1;
  const state: FakeServarrState = {
    config: defaultConfig(kind),
    rootFolders: [],
    downloadClients: [],
  };
  const requests: FakeRequest[] = [];
  const user = { name: '', hash: '' };

  const hostView = (): Resource => ({
    ...state.config.host,
    username: user.name,
    password: user.hash,
    passwordConfirmation: '',
  });

  function putHost(body: Resource): Response {
    const method = String(body.authenticationMethod);
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    const confirmation = String(body.passwordConfirmation ?? '');
    if (kind === 'radarr' && method === 'basic') {
      return validation(
        'AuthenticationMethod',
        "'Basic' is no longer supported, switch to 'Forms' instead.",
      );
    }
    if (method === 'forms' && !username) {
      return validation('Username', "'Username' must not be empty.");
    }
    if (method === 'forms' && !password) {
      return validation('Password', "'Password' must not be empty.");
    }
    if (password && password !== confirmation && password !== user.hash) {
      return validation('PasswordConfirmation', 'Must match Password');
    }
    if (body.allowedHosts == null) {
      return validation('AllowedHosts', "'Allowed Hosts' must not be empty.");
    }
    const logSizeLimit = Number(body.logSizeLimit);
    if (logSizeLimit < 1 || logSizeLimit > 10) {
      return validation('LogSizeLimit', 'Must be between 1 and 10');
    }
    if (username && password) {
      user.name = username.toLowerCase();
      if (password !== user.hash) {
        user.hash = hashPassword(password);
      }
    }
    state.config.host = { ...body, username: '', password: '', passwordConfirmation: '', id: 1 };
    return json(202, hostView());
  }

  function validateClient(body: Resource, existingId: number | undefined, forceSave: boolean) {
    const name = String(body.name ?? '');
    if (state.downloadClients.some((client) => client.name === name && client.id !== existingId)) {
      return validation('Name', 'Should be unique');
    }
    const clientApiKey = fieldValue(body, 'apiKey');
    if (clientApiKey && (fieldValue(body, 'username') || fieldValue(body, 'password'))) {
      return validation('ApiKey', 'Api key and username/password are mutually exclusive');
    }
    const needsConnection = body.enable === true && !decypharrReachable;
    if (needsConnection && !(forceSave && existingId !== undefined)) {
      return validation(
        'Host',
        'Unable to connect to qBittorrent',
        'Name does not resolve (decypharr:8282)',
      );
    }
    return undefined;
  }

  function storeClient(body: Resource, id: number): Resource {
    const previous = state.downloadClients.find((client) => client.id === id);
    const stored = structuredClone(body);
    for (const entry of stored.fields as ProviderField[]) {
      if (entry.name === 'password' && entry.value === MASK && previous) {
        entry.value = fieldValue(previous, 'password');
      }
    }
    stored.id = id;
    return stored;
  }

  async function handle(request: FakeRequest): Promise<Response> {
    const { method, path, query } = request;
    const body = (request.body ?? {}) as Resource;

    if (method === 'GET' && path === '/ping') {
      if (pingFailures > 0) {
        pingFailures -= 1;
        return json(503, { status: 'Error' });
      }
      return json(200, { status: 'OK' });
    }
    if (request.headers['x-api-key'] !== apiKey) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (method === 'GET' && path === '/api/v3/system/status') {
      return json(200, {
        appName: kind === 'sonarr' ? 'Sonarr' : 'Radarr',
        version: '0.0.0-fake',
        authentication: String(state.config.host.authenticationMethod),
      });
    }
    if (method === 'GET' && path === '/api/v3/health') {
      return json(200, [
        {
          source: 'DownloadClientCheck',
          type: 'warning',
          message: 'No download client is available',
        },
      ]);
    }
    if (method === 'GET' && path === '/api/v3/language') {
      return json(200, LANGUAGES);
    }

    const configMatch = /^\/api\/v3\/config\/(\w+)(?:\/(\d+))?$/.exec(path);
    if (configMatch) {
      const name = configMatch[1] as string;
      if (!(name in state.config)) {
        return json(404);
      }
      if (method === 'GET' && configMatch[2] === undefined) {
        return json(200, name === 'host' ? hostView() : state.config[name]);
      }
      if (method === 'PUT' && configMatch[2] === '1') {
        if (name === 'host') {
          return putHost(body);
        }
        state.config[name] = { ...body, id: 1 };
        return json(202, state.config[name]);
      }
    }

    if (path === '/api/v3/rootfolder') {
      if (method === 'GET') {
        return json(200, state.rootFolders);
      }
      if (method === 'POST') {
        const folderPath = String(body.path ?? '');
        if (state.rootFolders.some((folder) => folder.path === folderPath)) {
          return validation('Path', 'Path is already configured as a root folder');
        }
        if (!folders.has(folderPath)) {
          return validation('Path', `Folder '${folderPath}' is not writable by user 'abc'`);
        }
        const folder = { id: nextFolderId, path: folderPath, accessible: true };
        nextFolderId += 1;
        state.rootFolders.push(folder);
        return json(201, folder);
      }
    }

    if (method === 'GET' && path === '/api/v3/downloadclient/schema') {
      return json(200, [qbittorrentSchema(kind)]);
    }
    if (method === 'GET' && path === '/api/v3/downloadclient') {
      return json(200, state.downloadClients.map(maskPasswords));
    }
    if (method === 'POST' && path === '/api/v3/downloadclient/test') {
      return validateClient(body, undefined, false) ?? json(200, {});
    }
    if (method === 'POST' && path === '/api/v3/downloadclient') {
      const failure = validateClient(body, undefined, query.forceSave === 'true');
      if (failure) {
        return failure;
      }
      const stored = storeClient(body, nextClientId);
      nextClientId += 1;
      state.downloadClients.push(stored);
      return json(201, maskPasswords(stored));
    }
    const clientMatch = /^\/api\/v3\/downloadclient\/(\d+)$/.exec(path);
    if (method === 'PUT' && clientMatch) {
      const id = Number(clientMatch[1]);
      if (!state.downloadClients.some((client) => client.id === id)) {
        return json(404);
      }
      const failure = validateClient(body, id, query.forceSave === 'true');
      if (failure) {
        return failure;
      }
      const stored = storeClient(body, id);
      state.downloadClients = state.downloadClients.map((client) =>
        client.id === id ? stored : client,
      );
      return json(202, maskPasswords(stored));
    }
    return json(404, { message: `No fake route for ${method} ${path}` });
  }

  const fetchImpl: FetchLike = async (input, init) => {
    const request = toFakeRequest(input, init);
    requests.push(request);
    return handle(request);
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
    writes: () =>
      requests.filter(
        (request) =>
          request.method !== 'GET' &&
          request.method !== 'HEAD' &&
          request.path !== '/api/v3/downloadclient/test',
      ),
    canLogin: (username, password) =>
      user.name !== '' &&
      username.toLowerCase() === user.name &&
      hashPassword(password) === user.hash,
  };
}

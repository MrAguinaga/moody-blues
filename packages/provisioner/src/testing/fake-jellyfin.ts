import type { FetchLike } from '../http/http.types';
import type {
  ApiKeyResource,
  EncodingOptions,
  LibraryOptions,
  ServerConfiguration,
  VirtualFolder,
} from '../jellyfin/jellyfin.types';
import { type FakeRequest, toFakeRequest } from './fake-fetch';

type Raw = Record<string, unknown>;

export type ApiKeyCreationReply = 'empty' | 'json';

export interface FakeJellyfinUser {
  id: string;
  name: string;
  password: string;
  isAdministrator: boolean;
  policy: Raw;
}

export interface FakeJellyfinExtraUser {
  name: string;
  password?: string;
  isAdministrator?: boolean;
  policy?: Raw;
}

export interface FakeJellyfinOptions {
  baseUrl?: string;
  wizardCompleted?: boolean;
  adminName?: string;
  adminPassword?: string;
  halfFinishedWizard?: boolean;
  apiKeys?: readonly string[];
  extraUsers?: readonly FakeJellyfinExtraUser[];
  apiKeyReply?: ApiKeyCreationReply;
  existingPaths?: readonly string[];
  libraries?: readonly VirtualFolder[];
  config?: Raw;
  encoding?: Raw;
  localAddress?: string;
  readyAfterFailures?: number;
  bootstrapResponses?: number;
  failLogout?: boolean;
}

export interface FakeJellyfinState {
  wizardCompleted: boolean;
  firstUserFetched: boolean;
  users: FakeJellyfinUser[];
  apiKeys: ApiKeyResource[];
  sessions: Map<string, string>;
  config: ServerConfiguration;
  encoding: EncodingOptions;
  libraries: VirtualFolder[];
  failedLogins: number;
  passwordChanges: string[];
  refreshes: number;
}

export interface FakeJellyfin {
  fetch: FetchLike;
  baseUrl: string;
  requests: FakeRequest[];
  state: FakeJellyfinState;
  count(method: string, path?: string): number;
  writes(): FakeRequest[];
  canLogin(username: string, password: string): boolean;
}

const DEFAULT_USER_NAME = 'MyJellyfinUser';
const NAME_PATTERN = /^(?!\s)[\p{L}\p{Mn}\p{Nd}\p{Pc} \-'._@+]+(?<!\s)$/u;
const AUTH_FIELDS = ['Client', 'Device', 'DeviceId', 'Version'] as const;
const STARTUP_PATHS: readonly string[] = ['/Startup/User', '/Startup/Complete'];
const DEFAULT_EXISTING_PATHS: readonly string[] = ['/data/media/movies', '/data/media/tv'];
const AUTHENTICATION_PROVIDER =
  'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider';
const PASSWORD_RESET_PROVIDER =
  'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider';
const USER_POLICY_PATH = /^\/Users\/([^/]+)\/Policy$/;
const TYPE_OPTIONS_DEFAULTS = {
  MetadataFetcherOrder: [],
  ImageFetcherOrder: [],
  ImageOptions: [],
  SimilarItemProviders: [],
  SimilarItemProviderOrder: [],
};

function reply(status: number, body?: unknown): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseAuthorization(header: string | undefined): Record<string, string> | undefined {
  if (!header?.startsWith('MediaBrowser ')) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const match of header.slice('MediaBrowser '.length).matchAll(/(\w+)="([^"]*)"/g)) {
    fields[match[1] as string] = match[2] as string;
  }
  return AUTH_FIELDS.every((field) => fields[field]) ? fields : undefined;
}

function defaultConfig(): ServerConfiguration {
  return {
    EnableMetrics: false,
    PreferredMetadataLanguage: 'en',
    MetadataCountryCode: 'US',
    CacheSize: 800,
    ServerName: '',
    UICulture: 'en-US',
    CorsHosts: ['*'],
    ActivityLogRetentionDays: 30,
    TrickplayOptions: { Interval: 10000, WidthResolutions: [320] },
    EnableLegacyAuthorization: false,
    IsStartupWizardCompleted: false,
  };
}

function defaultEncoding(): EncodingOptions {
  return {
    EncodingThreadCount: -1,
    EnableThrottling: false,
    ThrottleDelaySeconds: 180,
    EnableSegmentDeletion: false,
    SegmentKeepSeconds: 720,
    HardwareAccelerationType: 'none',
    VaapiDevice: '/dev/dri/renderD128',
  };
}

function defaultPolicy(isAdministrator: boolean): Raw {
  return {
    IsAdministrator: isAdministrator,
    IsHidden: true,
    IsDisabled: false,
    BlockedTags: [],
    EnableUserPreferenceAccess: true,
    AccessSchedules: [],
    BlockUnratedItems: [],
    EnableRemoteControlOfOtherUsers: isAdministrator,
    EnableSharedDeviceControl: true,
    EnableRemoteAccess: true,
    EnableLiveTvManagement: isAdministrator,
    EnableLiveTvAccess: true,
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: true,
    EnableVideoPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
    ForceRemoteSourceTranscoding: false,
    EnableContentDeletion: isAdministrator,
    EnableContentDownloading: true,
    EnableSyncTranscoding: true,
    EnableMediaConversion: true,
    EnableAllDevices: true,
    EnableAllChannels: true,
    EnableAllFolders: true,
    InvalidLoginAttemptCount: 0,
    LoginAttemptsBeforeLockout: -1,
    MaxActiveSessions: 0,
    EnablePublicSharing: true,
    RemoteClientBitrateLimit: 0,
    AuthenticationProviderId: AUTHENTICATION_PROVIDER,
    PasswordResetProviderId: PASSWORD_RESET_PROVIDER,
    SyncPlayAccess: 'CreateAndJoinGroups',
  };
}

function normalizeLibraryOptions(options: Raw): LibraryOptions {
  const typeOptions = ((options.TypeOptions as Raw[] | undefined) ?? []).map((entry) => ({
    ...structuredClone(TYPE_OPTIONS_DEFAULTS),
    ...entry,
  }));
  return { ...structuredClone(options), TypeOptions: typeOptions } as unknown as LibraryOptions;
}

export function createFakeJellyfin(options: FakeJellyfinOptions = {}): FakeJellyfin {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:8096';
  const existingPaths = options.existingPaths ?? DEFAULT_EXISTING_PATHS;
  const wizardCompleted = options.wizardCompleted ?? false;
  const state: FakeJellyfinState = {
    wizardCompleted,
    firstUserFetched: false,
    users: [],
    apiKeys: [],
    sessions: new Map(),
    config: { ...defaultConfig(), ...options.config, IsStartupWizardCompleted: wizardCompleted },
    encoding: { ...defaultEncoding(), ...options.encoding },
    libraries: (options.libraries ?? []).map((library) => structuredClone(library)),
    failedLogins: 0,
    passwordChanges: [],
    refreshes: 0,
  };
  const requests: FakeRequest[] = [];
  const counters = {
    user: 0,
    token: 0,
    library: 0,
    readyFailures: options.readyAfterFailures ?? 0,
    bootstrap: options.bootstrapResponses ?? 0,
  };

  function addUser(
    name: string,
    password: string,
    isAdministrator = true,
    policy: Raw = {},
  ): FakeJellyfinUser {
    counters.user += 1;
    const user: FakeJellyfinUser = {
      id: `user-id-${counters.user}`,
      name,
      password,
      isAdministrator,
      policy: { ...defaultPolicy(isAdministrator), ...policy },
    };
    state.users.push(user);
    return user;
  }

  function issueApiKey(app: string, token?: string): ApiKeyResource {
    counters.token += 1;
    const key: ApiKeyResource = {
      AccessToken: token ?? `fake-api-key-${counters.token}`,
      AppName: app,
      DateCreated: '2026-01-01T00:00:00Z',
    };
    state.apiKeys.push(key);
    return key;
  }

  if (wizardCompleted || options.halfFinishedWizard) {
    addUser(options.adminName ?? 'Admin', options.adminPassword ?? 'p@ss word');
    state.firstUserFetched = options.halfFinishedWizard === true;
  }
  if (wizardCompleted) {
    for (const extra of options.extraUsers ?? []) {
      addUser(extra.name, extra.password ?? '', extra.isAdministrator ?? false, extra.policy);
    }
  }
  for (const token of options.apiKeys ?? []) {
    issueApiKey('moody-blues', token);
  }

  const findUser = (name: string) =>
    state.users.find((user) => user.name.toLowerCase() === name.toLowerCase());
  const canLogin = (username: string, password: string) =>
    findUser(username)?.password === password;
  const isAuthenticated = (token: string | undefined) =>
    token !== undefined &&
    (state.sessions.has(token) || state.apiKeys.some((key) => key.AccessToken === token));

  function login(body: Raw, deviceId: string): Response {
    const user = findUser(String(body.Username ?? ''));
    if (!user || user.password !== body.Pw) {
      state.failedLogins += 1;
      return reply(401, 'Error processing request.');
    }
    for (const [token, device] of state.sessions) {
      if (device === deviceId) {
        state.sessions.delete(token);
      }
    }
    counters.token += 1;
    const token = `fake-session-${counters.token}`;
    state.sessions.set(token, deviceId);
    return reply(200, {
      AccessToken: token,
      User: { Id: user.id, Name: user.name },
      ServerId: 'fake-server',
    });
  }

  function startup(request: FakeRequest): Response {
    const { method, path } = request;
    if (state.wizardCompleted) {
      return reply(401);
    }
    if (method === 'GET' && path === '/Startup/User') {
      state.firstUserFetched = true;
      const first = state.users[0] ?? addUser(DEFAULT_USER_NAME, '');
      return reply(200, { Name: first.name });
    }
    if (method === 'POST' && path === '/Startup/User') {
      const first = state.users[0];
      const body = (request.body ?? {}) as Raw;
      if (!state.firstUserFetched || !first) {
        return reply(404);
      }
      if (first.password !== '') {
        return reply(403);
      }
      if (typeof body.Password !== 'string' || body.Password === '') {
        return reply(400, 'Password must not be empty');
      }
      if (typeof body.Name !== 'string' || !NAME_PATTERN.test(body.Name)) {
        return reply(400, 'Invalid user name');
      }
      first.name = body.Name;
      first.password = body.Password;
      return reply(204);
    }
    if (method === 'POST' && path === '/Startup/Complete') {
      state.wizardCompleted = true;
      state.config.IsStartupWizardCompleted = true;
      return reply(204);
    }
    return reply(404);
  }

  function libraries(request: FakeRequest): Response {
    const { method, path, query } = request;
    const body = (request.body ?? {}) as Raw;
    if (method === 'GET' && path === '/Library/VirtualFolders') {
      return reply(200, state.libraries);
    }
    if (method === 'POST' && path === '/Library/VirtualFolders') {
      const location = query.paths ?? '';
      if (!existingPaths.includes(location)) {
        return reply(400, 'Error processing request.');
      }
      const base = (query.name ?? '').trim();
      let name = base;
      for (let suffix = 2; state.libraries.some((library) => library.Name === name); suffix += 1) {
        name = `${base}${suffix}`;
      }
      counters.library += 1;
      state.libraries.push({
        Name: name,
        Locations: [location],
        CollectionType: query.collectionType,
        LibraryOptions: normalizeLibraryOptions((body.LibraryOptions as Raw | undefined) ?? {}),
        ItemId: `library-id-${counters.library}`,
      });
      return reply(204);
    }
    if (method === 'POST' && path === '/Library/VirtualFolders/LibraryOptions') {
      const library = state.libraries.find((candidate) => candidate.ItemId === body.Id);
      if (!library) {
        return reply(404);
      }
      library.LibraryOptions = normalizeLibraryOptions(body.LibraryOptions as Raw);
      return reply(204);
    }
    return reply(404);
  }

  function updatePolicy(userId: string, policy: Raw): Response {
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      return reply(404);
    }
    if (!policy.AuthenticationProviderId || !policy.PasswordResetProviderId) {
      return reply(400, 'Error processing request.');
    }
    const otherAdministrators = state.users.some(
      (candidate) => candidate.id !== userId && candidate.isAdministrator,
    );
    if (policy.IsAdministrator !== true && user.isAdministrator && !otherAdministrators) {
      return reply(400, 'There must be at least one user in the administrator role.');
    }
    user.policy = structuredClone(policy);
    user.isAdministrator = policy.IsAdministrator === true;
    return reply(204);
  }

  function authenticated(request: FakeRequest, token: string | undefined): Response {
    const { method, path, query } = request;
    const key = `${method} ${path}`;
    if (key === 'GET /Auth/Keys') {
      return reply(200, { Items: structuredClone(state.apiKeys), TotalRecordCount: 1 });
    }
    if (key === 'POST /Auth/Keys') {
      const created = issueApiKey(query.app ?? '');
      return options.apiKeyReply === 'json' ? reply(200, created) : reply(204);
    }
    if (key === 'POST /Sessions/Logout') {
      if (options.failLogout) {
        return reply(500, 'logout failed');
      }
      state.sessions.delete(token as string);
      return reply(204);
    }
    if (key === 'GET /Users') {
      return reply(
        200,
        state.users.map((user) => ({
          Id: user.id,
          Name: user.name,
          Policy: structuredClone(user.policy),
        })),
      );
    }
    const policyUserId = method === 'POST' ? USER_POLICY_PATH.exec(path)?.[1] : undefined;
    if (policyUserId !== undefined) {
      return updatePolicy(decodeURIComponent(policyUserId), (request.body ?? {}) as Raw);
    }
    if (key === 'POST /Users/Password') {
      const user = state.users.find((candidate) => candidate.id === query.userId);
      const body = (request.body ?? {}) as Raw;
      if (!user || typeof body.NewPw !== 'string') {
        return reply(404);
      }
      user.password = body.NewPw;
      state.passwordChanges.push(user.id);
      return reply(204);
    }
    if (key === 'GET /System/Configuration') {
      return reply(200, state.config);
    }
    if (key === 'POST /System/Configuration') {
      state.config = structuredClone(request.body) as ServerConfiguration;
      return reply(204);
    }
    if (key === 'GET /System/Configuration/encoding') {
      return reply(200, state.encoding);
    }
    if (key === 'POST /System/Configuration/encoding') {
      state.encoding = structuredClone(request.body) as EncodingOptions;
      return reply(204);
    }
    if (key === 'POST /Library/Refresh') {
      state.refreshes += 1;
      return reply(204);
    }
    if (path.startsWith('/Library/VirtualFolders')) {
      return libraries(request);
    }
    return reply(404, { message: `No fake route for ${key}` });
  }

  const fetchImpl: FetchLike = async (input, init) => {
    const request = toFakeRequest(input, init);
    requests.push(request);
    const { path } = request;

    if (path === '/System/Info/Public' && counters.readyFailures > 0) {
      counters.readyFailures -= 1;
      return new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '1' } });
    }

    if (path === '/System/Info/Public' && counters.bootstrap > 0) {
      counters.bootstrap -= 1;
      return reply(200, {
        localAddress: options.localAddress ?? 'https://watch.localhost',
        serverName: 'bootstrap',
        startupWizardCompleted: false,
      });
    }

    const legacy =
      'x-emby-authorization' in request.headers ||
      'x-emby-token' in request.headers ||
      'api_key' in request.query;
    const fields = parseAuthorization(request.headers.authorization);
    if (legacy || !fields) {
      return reply(400, 'Invalid authorization header');
    }

    if (path === '/System/Info/Public') {
      return reply(200, {
        LocalAddress: options.localAddress ?? 'https://watch.localhost',
        ServerName: String(state.config.ServerName ?? ''),
        Version: '12.2.0',
        Id: 'fake-server',
        StartupWizardCompleted: state.wizardCompleted,
      });
    }
    if (path === '/Users/AuthenticateByName' && request.method === 'POST') {
      return login((request.body ?? {}) as Raw, fields.DeviceId as string);
    }
    if (STARTUP_PATHS.includes(path)) {
      return startup(request);
    }
    if (!isAuthenticated(fields.Token)) {
      return reply(401);
    }
    return authenticated(request, fields.Token);
  };

  return {
    fetch: fetchImpl,
    baseUrl,
    requests,
    state,
    count: (method, path) =>
      requests.filter(
        (request) =>
          request.method === method.toUpperCase() && (path === undefined || request.path === path),
      ).length,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    canLogin,
  };
}

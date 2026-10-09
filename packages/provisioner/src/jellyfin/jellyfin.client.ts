import { createHttpClient } from '../http/http.client';
import { HttpStatusError } from '../http/http.errors';
import type { BodylessRequestOptions, HttpClient, HttpClientOptions } from '../http/http.types';
import { waitUntilReady, type WaitUntilReadyOptions } from '../http/ready.http';
import {
  JELLYFIN_CLIENT_NAME,
  JELLYFIN_CLIENT_VERSION,
  JELLYFIN_DEVICE_ID,
  JELLYFIN_DEVICE_NAME,
} from './jellyfin.constants';
import type {
  AdminCredentials,
  ApiKeyList,
  ApiKeyResource,
  AuthenticationResult,
  LibraryOptions,
  LibrarySpec,
  NamedConfiguration,
  NamedConfigurationKey,
  PublicSystemInfo,
  ServerConfiguration,
  StartupUser,
  UserDto,
  UserPolicy,
  VirtualFolder,
} from './jellyfin.types';

export type JellyfinReadyOptions = Pick<
  WaitUntilReadyOptions,
  'timeoutMs' | 'sleep' | 'now' | 'random' | 'signal'
>;

export interface JellyfinClientOptions extends Pick<
  HttpClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'timeoutMs' | 'signal'
> {
  baseUrl: string;
}

export interface JellyfinClient {
  waitReady(options?: JellyfinReadyOptions): Promise<void>;
  getPublicInfo(): Promise<PublicSystemInfo>;
  getFirstUser(): Promise<StartupUser>;
  setFirstUser(name: string, password: string): Promise<void>;
  completeStartup(): Promise<void>;
  authenticate(credentials: AdminCredentials): Promise<string>;
  useToken(token: string): void;
  listApiKeys(): Promise<ApiKeyResource[]>;
  createApiKey(app: string): Promise<void>;
  logout(): Promise<void>;
  listUsers(): Promise<UserDto[]>;
  findUserByName(name: string): Promise<UserDto | undefined>;
  updateUserPolicy(userId: string, policy: UserPolicy): Promise<void>;
  setPassword(userId: string, newPassword: string): Promise<void>;
  getServerConfiguration(): Promise<ServerConfiguration>;
  saveServerConfiguration(config: ServerConfiguration): Promise<void>;
  getNamedConfiguration(key: NamedConfigurationKey): Promise<NamedConfiguration>;
  saveNamedConfiguration(key: NamedConfigurationKey, config: NamedConfiguration): Promise<void>;
  listLibraries(): Promise<VirtualFolder[]>;
  createLibrary(spec: LibrarySpec, options: LibraryOptions): Promise<void>;
  updateLibraryOptions(id: string, options: LibraryOptions): Promise<void>;
}

const PUBLIC_INFO_PATH = '/System/Info/Public';

function authorizationHeader(token?: string): string {
  const fields = [
    `Client="${JELLYFIN_CLIENT_NAME}"`,
    `Device="${JELLYFIN_DEVICE_NAME}"`,
    `DeviceId="${JELLYFIN_DEVICE_ID}"`,
    `Version="${JELLYFIN_CLIENT_VERSION}"`,
    ...(token ? [`Token="${token}"`] : []),
  ];
  return `MediaBrowser ${fields.join(', ')}`;
}

export function createJellyfinClient(options: JellyfinClientOptions): JellyfinClient {
  const http: HttpClient = createHttpClient({
    baseUrl: options.baseUrl,
    headers: { Authorization: authorizationHeader() },
    fetch: options.fetch,
    sleep: options.sleep,
    random: options.random,
    retry: options.retry,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  let token: string | undefined;

  const authorized = (request: BodylessRequestOptions = {}): BodylessRequestOptions =>
    token ? { ...request, headers: { Authorization: authorizationHeader(token) } } : request;
  const send = async (path: string, body?: unknown, request?: BodylessRequestOptions) => {
    await http.post(path, body, authorized({ ...request, responseType: 'status' }));
  };

  const listUsers = () => http.get<UserDto[]>('/Users', authorized());
  const getPublicInfo = () => http.get<PublicSystemInfo>(PUBLIC_INFO_PATH);

  // Jellyfin 12 first answers this path from a bootstrap host with camelCase keys and then
  // swaps it for the real server, so a 200 alone does not mean the API is up.
  async function verifyFullServer(): Promise<void> {
    const info = await getPublicInfo();
    if (typeof info?.StartupWizardCompleted !== 'boolean') {
      throw new HttpStatusError(
        'GET',
        new URL(PUBLIC_INFO_PATH, options.baseUrl).toString(),
        503,
        'the server is still starting',
      );
    }
  }

  async function createLibrary(spec: LibrarySpec, libraryOptions: LibraryOptions): Promise<void> {
    try {
      await send(
        '/Library/VirtualFolders',
        { LibraryOptions: libraryOptions },
        {
          query: {
            name: spec.name,
            collectionType: spec.collectionType,
            paths: spec.path,
            refreshLibrary: false,
          },
        },
      );
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 400) {
        throw new Error(
          `Jellyfin rejected the library "${spec.name}"; check that ${spec.path} exists inside the container`,
        );
      }
      throw error;
    }
  }

  return {
    waitReady: (readyOptions = {}) =>
      waitUntilReady(http, {
        service: 'Jellyfin',
        readyPath: PUBLIC_INFO_PATH,
        verify: verifyFullServer,
        signal: options.signal,
        ...readyOptions,
      }),
    getPublicInfo,
    getFirstUser: () => http.get('/Startup/User'),
    setFirstUser: (name, password) => send('/Startup/User', { Name: name, Password: password }),
    completeStartup: () => send('/Startup/Complete'),
    authenticate: async ({ username, password }) => {
      token = undefined;
      const result = await http.post<AuthenticationResult>('/Users/AuthenticateByName', {
        Username: username,
        Pw: password,
      });
      token = result.AccessToken;
      return result.AccessToken;
    },
    useToken: (value) => {
      token = value;
    },
    listApiKeys: async () => (await http.get<ApiKeyList>('/Auth/Keys', authorized())).Items,
    createApiKey: (app) => send('/Auth/Keys', undefined, { query: { app } }),
    logout: async () => {
      try {
        await send('/Sessions/Logout');
      } finally {
        token = undefined;
      }
    },
    listUsers,
    findUserByName: async (name) =>
      (await listUsers()).find((user) => user.Name.toLowerCase() === name.toLowerCase()),
    updateUserPolicy: (userId, policy) =>
      send(`/Users/${encodeURIComponent(userId)}/Policy`, policy),
    setPassword: (userId, newPassword) =>
      send('/Users/Password', { NewPw: newPassword }, { query: { userId } }),
    getServerConfiguration: () => http.get('/System/Configuration', authorized()),
    saveServerConfiguration: (config) => send('/System/Configuration', config),
    getNamedConfiguration: (key) => http.get(`/System/Configuration/${key}`, authorized()),
    saveNamedConfiguration: (key, config) => send(`/System/Configuration/${key}`, config),
    listLibraries: () => http.get('/Library/VirtualFolders', authorized()),
    createLibrary,
    updateLibraryOptions: (id, libraryOptions) =>
      send('/Library/VirtualFolders/LibraryOptions', { Id: id, LibraryOptions: libraryOptions }),
  };
}

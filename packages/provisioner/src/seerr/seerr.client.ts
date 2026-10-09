import { createHttpClient } from '../http/http.client';
import type { BodylessRequestOptions, HttpClient, HttpClientOptions } from '../http/http.types';
import { waitUntilReady, type WaitUntilReadyOptions } from '../http/ready.http';
import { JELLYFIN_SERVER_TYPE } from './seerr.constants';
import type {
  ArrConnection,
  ArrInstance,
  ArrTestResult,
  JellyfinConnectionUpdate,
  JellyfinLoginCredentials,
  JellyfinSettings,
  MainSettings,
  PublicSettings,
  SeerrArrKind,
  SeerrLibrary,
  SeerrUser,
} from './seerr.types';

const API_ROOT = '/api/v1';
const PUBLIC_SETTINGS_PATH = `${API_ROOT}/settings/public`;

export type SeerrReadyOptions = Pick<
  WaitUntilReadyOptions,
  'timeoutMs' | 'sleep' | 'now' | 'random' | 'signal'
>;

export interface SeerrClientOptions extends Pick<
  HttpClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'timeoutMs' | 'signal'
> {
  baseUrl: string;
  apiKey: string;
}

export interface SeerrClient {
  waitReady(options?: SeerrReadyOptions): Promise<void>;
  getPublicSettings(): Promise<PublicSettings>;
  whoAmI(): Promise<SeerrUser>;
  loginWithJellyfin(credentials: JellyfinLoginCredentials): Promise<SeerrUser>;
  getMainSettings(): Promise<MainSettings>;
  saveMainSettings(settings: Partial<MainSettings>): Promise<void>;
  getJellyfinSettings(): Promise<JellyfinSettings>;
  saveJellyfinSettings(settings: JellyfinConnectionUpdate): Promise<void>;
  syncLibraries(): Promise<SeerrLibrary[]>;
  enableLibrary(id: string): Promise<void>;
  startLibraryScan(): Promise<void>;
  testArr(kind: SeerrArrKind, connection: ArrConnection): Promise<ArrTestResult>;
  listArrInstances(kind: SeerrArrKind): Promise<ArrInstance[]>;
  createArrInstance(kind: SeerrArrKind, instance: ArrInstance): Promise<ArrInstance>;
  updateArrInstance(kind: SeerrArrKind, id: number, instance: ArrInstance): Promise<ArrInstance>;
  initialize(): Promise<void>;
}

export function createSeerrClient(options: SeerrClientOptions): SeerrClient {
  const http: HttpClient = createHttpClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    sleep: options.sleep,
    random: options.random,
    retry: options.retry,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  // The sign-in answers with a session cookie that is deliberately dropped: from then on the API key
  // authenticates as the first user, which is the administrator the sign-in just created.
  const authorized = (request: BodylessRequestOptions = {}): BodylessRequestOptions => ({
    ...request,
    headers: { 'X-Api-Key': options.apiKey },
  });
  const send = async (method: 'post' | 'put', path: string, body?: unknown) => {
    await http[method](path, body, authorized({ responseType: 'status' }));
  };

  return {
    waitReady: (readyOptions = {}) =>
      waitUntilReady(http, {
        service: 'Seerr',
        readyPath: PUBLIC_SETTINGS_PATH,
        signal: options.signal,
        ...readyOptions,
      }),
    getPublicSettings: () => http.get(PUBLIC_SETTINGS_PATH),
    whoAmI: () => http.get(`${API_ROOT}/auth/me`, authorized()),
    loginWithJellyfin: ({ username, password, hostname, port }) =>
      http.post(`${API_ROOT}/auth/jellyfin`, {
        username,
        password,
        hostname,
        port,
        useSsl: false,
        urlBase: '',
        serverType: JELLYFIN_SERVER_TYPE,
      }),
    getMainSettings: () => http.get(`${API_ROOT}/settings/main`, authorized()),
    saveMainSettings: (settings) => send('post', `${API_ROOT}/settings/main`, settings),
    getJellyfinSettings: () => http.get(`${API_ROOT}/settings/jellyfin`, authorized()),
    saveJellyfinSettings: (settings) => send('post', `${API_ROOT}/settings/jellyfin`, settings),
    syncLibraries: () =>
      http.post(`${API_ROOT}/settings/jellyfin/library/sync`, undefined, authorized()),
    enableLibrary: (id) =>
      send('put', `${API_ROOT}/settings/jellyfin/library/${encodeURIComponent(id)}`, {
        enabled: true,
      }),
    startLibraryScan: () => send('post', `${API_ROOT}/settings/jellyfin/sync`, { start: true }),
    testArr: (kind, connection) =>
      http.post(`${API_ROOT}/settings/${kind}/test`, connection, authorized()),
    listArrInstances: (kind) => http.get(`${API_ROOT}/settings/${kind}`, authorized()),
    createArrInstance: (kind, instance) =>
      http.post(`${API_ROOT}/settings/${kind}`, instance, authorized()),
    updateArrInstance: (kind, id, instance) =>
      http.put(`${API_ROOT}/settings/${kind}/${id}`, instance, authorized()),
    initialize: () => send('post', `${API_ROOT}/settings/initialize`),
  };
}

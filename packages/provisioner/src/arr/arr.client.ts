import { createHttpClient } from '../http/http.client';
import type { HttpClient, HttpClientOptions } from '../http/http.types';
import { valuesEqual } from '../http/provider-fields';
import { ensureServarrAdminUser, type ServarrAdminCredentials } from '../servarr/servarr-host';
import type {
  ArrConfigName,
  ArrConfigResource,
  ArrKind,
  CustomFormatResource,
  DownloadClientResource,
  HealthResource,
  LanguageResource,
  QualityProfileResource,
  RootFolderResource,
  SpecificationSchemaResource,
  SystemStatusResource,
} from './arr.types';

const API_ROOT = '/api/v3';

export interface ArrClientOptions extends Pick<
  HttpClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'timeoutMs' | 'signal'
> {
  kind: ArrKind;
  baseUrl: string;
  apiKey: string;
}

export interface DownloadClientSaveOptions {
  forceSave?: boolean;
}

export interface ArrClient {
  readonly kind: ArrKind;
  readonly http: HttpClient;
  getSystemStatus(): Promise<SystemStatusResource>;
  getHealth(): Promise<HealthResource[]>;
  ensureAdminUser(credentials: ServarrAdminCredentials): Promise<boolean>;
  getConfig<T extends ArrConfigResource = ArrConfigResource>(name: ArrConfigName): Promise<T>;
  putConfig(name: ArrConfigName, resource: ArrConfigResource): Promise<void>;
  listRootFolders(): Promise<RootFolderResource[]>;
  createRootFolder(path: string): Promise<RootFolderResource>;
  listDownloadClients(): Promise<DownloadClientResource[]>;
  getDownloadClientSchema(): Promise<DownloadClientResource[]>;
  createDownloadClient(
    resource: DownloadClientResource,
    options?: DownloadClientSaveOptions,
  ): Promise<DownloadClientResource>;
  updateDownloadClient(
    resource: DownloadClientResource,
    options?: DownloadClientSaveOptions,
  ): Promise<DownloadClientResource>;
  testDownloadClient(resource: DownloadClientResource): Promise<void>;
  listLanguages(): Promise<LanguageResource[]>;
  listCustomFormats(): Promise<CustomFormatResource[]>;
  getCustomFormatSchema(): Promise<SpecificationSchemaResource[]>;
  createCustomFormat(resource: CustomFormatResource): Promise<CustomFormatResource>;
  updateCustomFormat(resource: CustomFormatResource): Promise<CustomFormatResource>;
  listQualityProfiles(): Promise<QualityProfileResource[]>;
  getQualityProfileSchema(): Promise<QualityProfileResource>;
  createQualityProfile(resource: QualityProfileResource): Promise<QualityProfileResource>;
  updateQualityProfile(resource: QualityProfileResource): Promise<QualityProfileResource>;
  deleteQualityProfile(id: number): Promise<void>;
}

export function createArrClient(options: ArrClientOptions): ArrClient {
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
  const saveQuery = (save?: DownloadClientSaveOptions) =>
    save?.forceSave ? { query: { forceSave: true } } : {};

  return {
    kind: options.kind,
    http,
    getSystemStatus: () => http.get(`${API_ROOT}/system/status`),
    getHealth: () => http.get(`${API_ROOT}/health`),
    ensureAdminUser: (credentials) => ensureServarrAdminUser(http, API_ROOT, credentials),
    getConfig: (name) => http.get(`${API_ROOT}/config/${name}`),
    putConfig: async (name, resource) => {
      await http.put(`${API_ROOT}/config/${name}/${resource.id}`, resource);
    },
    listRootFolders: () => http.get(`${API_ROOT}/rootfolder`),
    createRootFolder: (path) => http.post(`${API_ROOT}/rootfolder`, { path }),
    listDownloadClients: () => http.get(`${API_ROOT}/downloadclient`),
    getDownloadClientSchema: () => http.get(`${API_ROOT}/downloadclient/schema`),
    createDownloadClient: (resource, save) =>
      http.post(`${API_ROOT}/downloadclient`, resource, saveQuery(save)),
    updateDownloadClient: (resource, save) =>
      http.put(`${API_ROOT}/downloadclient/${resource.id}`, resource, saveQuery(save)),
    testDownloadClient: async (resource) => {
      await http.post(`${API_ROOT}/downloadclient/test`, resource);
    },
    listLanguages: () => http.get(`${API_ROOT}/language`),
    listCustomFormats: () => http.get(`${API_ROOT}/customformat`),
    getCustomFormatSchema: () => http.get(`${API_ROOT}/customformat/schema`),
    createCustomFormat: (resource) => http.post(`${API_ROOT}/customformat`, resource),
    updateCustomFormat: (resource) => http.put(`${API_ROOT}/customformat/${resource.id}`, resource),
    listQualityProfiles: () => http.get(`${API_ROOT}/qualityprofile`),
    getQualityProfileSchema: () => http.get(`${API_ROOT}/qualityprofile/schema`),
    createQualityProfile: (resource) => http.post(`${API_ROOT}/qualityprofile`, resource),
    updateQualityProfile: (resource) =>
      http.put(`${API_ROOT}/qualityprofile/${resource.id}`, resource),
    // A profile in use answers 500 deterministically, so retrying only delays the report.
    deleteQualityProfile: (id) =>
      http.delete(`${API_ROOT}/qualityprofile/${id}`, { retry: { attempts: 1 } }),
  };
}

export async function patchSingleton(
  client: ArrClient,
  name: ArrConfigName,
  desired: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const current = await client.getConfig(name);
  const drifted = Object.entries(desired).some(([key, value]) => !valuesEqual(current[key], value));
  if (!drifted) {
    return false;
  }
  await client.putConfig(name, { ...current, ...desired });
  return true;
}

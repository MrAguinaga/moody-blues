import { createHttpClient } from '../http/http.client';
import type { HttpClient, HttpClientOptions } from '../http/http.types';
import { valuesEqual } from '../http/provider-fields';
import { ensureServarrAdminUser, type ServarrAdminCredentials } from '../servarr/servarr-host';
import type {
  ArrCommandResource,
  ArrConfigName,
  ArrConfigResource,
  ArrKind,
  CustomFormatResource,
  DownloadClientResource,
  EpisodeFileResource,
  EpisodeResource,
  HealthResource,
  HistoryPage,
  HistoryRecord,
  LanguageResource,
  ManualImportFile,
  MissingEpisodeResource,
  MissingPage,
  NotificationResource,
  QualityProfileResource,
  QueueListOptions,
  QueuePage,
  QueueRecord,
  QueueRemovalOptions,
  ReleaseGrab,
  ReleaseProfileResource,
  ReleaseResource,
  RootFolderResource,
  SpecificationSchemaResource,
  SystemStatusResource,
  TitleResource,
} from './arr.types';

const API_ROOT = '/api/v3';
const QUEUE_PAGE_SIZE = 200;
const HISTORY_PAGE_SIZE = 200;
const MISSING_PAGE_SIZE = 200;
const RELEASE_SEARCH_TIMEOUT_MS = 300_000;
const RELEASE_GRAB_TIMEOUT_MS = 60_000;

const TITLE_RESOURCES = {
  radarr: { collection: 'movie', historyQuery: 'movieId', exclusionQuery: 'addImportExclusion' },
  sonarr: {
    collection: 'series',
    historyQuery: 'seriesId',
    exclusionQuery: 'addImportListExclusion',
  },
} as const;

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
  listNotifications(): Promise<NotificationResource[]>;
  getNotificationSchema(): Promise<NotificationResource[]>;
  createNotification(resource: NotificationResource): Promise<NotificationResource>;
  updateNotification(resource: NotificationResource): Promise<NotificationResource>;
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
  listReleaseProfiles(): Promise<ReleaseProfileResource[]>;
  createReleaseProfile(resource: ReleaseProfileResource): Promise<ReleaseProfileResource>;
  updateReleaseProfile(resource: ReleaseProfileResource): Promise<ReleaseProfileResource>;
  listQueue(options?: QueueListOptions): Promise<QueueRecord[]>;
  removeQueueItem(id: number, options?: QueueRemovalOptions): Promise<void>;
  listTitles(): Promise<TitleResource[]>;
  listHistory(titleId: number): Promise<HistoryRecord[]>;
  listHistoryByDownloadId(downloadId: string): Promise<HistoryRecord[]>;
  deleteTitle(id: number): Promise<void>;
  listMissing(): Promise<MissingEpisodeResource[]>;
  listEpisodes(seriesId: number, seasonNumber?: number): Promise<EpisodeResource[]>;
  listEpisodeFiles(seriesId: number): Promise<EpisodeFileResource[]>;
  searchReleases(seriesId: number, seasonNumber: number): Promise<ReleaseResource[]>;
  grabRelease(grab: ReleaseGrab): Promise<void>;
  manualImport(files: readonly ManualImportFile[]): Promise<ArrCommandResource>;
  getCommand(id: number): Promise<ArrCommandResource>;
  deleteEpisodeFiles(episodeFileIds: readonly number[]): Promise<void>;
  blocklistHistory(historyId: number): Promise<void>;
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
  const titles = TITLE_RESOURCES[options.kind];
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
    listNotifications: () => http.get(`${API_ROOT}/notification`),
    getNotificationSchema: () => http.get(`${API_ROOT}/notification/schema`),
    createNotification: (resource) => http.post(`${API_ROOT}/notification`, resource),
    updateNotification: (resource) => http.put(`${API_ROOT}/notification/${resource.id}`, resource),
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
    listReleaseProfiles: () => http.get(`${API_ROOT}/releaseprofile`),
    createReleaseProfile: (resource) => http.post(`${API_ROOT}/releaseprofile`, resource),
    updateReleaseProfile: (resource) =>
      http.put(`${API_ROOT}/releaseprofile/${resource.id}`, resource),
    listQueue: async (listing = {}) => {
      const records: QueueRecord[] = [];
      for (let page = 1; ; page += 1) {
        const result = await http.get<QueuePage>(`${API_ROOT}/queue`, {
          query: {
            page,
            pageSize: QUEUE_PAGE_SIZE,
            ...(listing.includeUnknownSeries ? { includeUnknownSeriesItems: true } : {}),
          },
        });
        records.push(...result.records);
        if (result.records.length === 0 || records.length >= result.totalRecords) {
          return records;
        }
      }
    },
    removeQueueItem: (id, removal = {}) =>
      http.delete(`${API_ROOT}/queue/${id}`, {
        query: Object.fromEntries(
          Object.entries(removal).filter(([, value]) => value !== undefined),
        ) as Record<string, boolean>,
        retry: { attempts: 1 },
      }),
    listTitles: () => http.get(`${API_ROOT}/${titles.collection}`),
    listHistory: (titleId) =>
      http.get(`${API_ROOT}/history/${titles.collection}`, {
        query: { [titles.historyQuery]: titleId },
      }),
    listHistoryByDownloadId: async (downloadId) => {
      const records: HistoryRecord[] = [];
      for (let page = 1; ; page += 1) {
        const result = await http.get<HistoryPage>(`${API_ROOT}/history`, {
          query: { downloadId, page, pageSize: HISTORY_PAGE_SIZE },
        });
        records.push(...result.records);
        if (result.records.length === 0 || records.length >= result.totalRecords) {
          return records;
        }
      }
    },
    // The deletion removes the folder, so a retried request could only hide the first failure.
    deleteTitle: (id) =>
      http.delete(`${API_ROOT}/${titles.collection}/${id}`, {
        query: { deleteFiles: true, [titles.exclusionQuery]: false },
        retry: { attempts: 1 },
      }),
    listMissing: async () => {
      const records: MissingEpisodeResource[] = [];
      for (let page = 1; ; page += 1) {
        const result = await http.get<MissingPage>(`${API_ROOT}/wanted/missing`, {
          query: { page, pageSize: MISSING_PAGE_SIZE, monitored: true, includeSeries: true },
        });
        records.push(...result.records);
        if (result.records.length === 0 || records.length >= result.totalRecords) {
          return records;
        }
      }
    },
    listEpisodes: (seriesId, seasonNumber) =>
      http.get(`${API_ROOT}/episode`, {
        query: { seriesId, ...(seasonNumber === undefined ? {} : { seasonNumber }) },
      }),
    listEpisodeFiles: (seriesId) => http.get(`${API_ROOT}/episodefile`, { query: { seriesId } }),
    // A season search asks every indexer, so Sonarr can take minutes and a repeat would only double the load.
    searchReleases: (seriesId, seasonNumber) =>
      http.get(`${API_ROOT}/release`, {
        query: { seriesId, seasonNumber },
        timeoutMs: RELEASE_SEARCH_TIMEOUT_MS,
        retry: { attempts: 1 },
      }),
    grabRelease: async (grab) => {
      await http.post(`${API_ROOT}/release`, grab, {
        timeoutMs: RELEASE_GRAB_TIMEOUT_MS,
        retry: { attempts: 1 },
      });
    },
    manualImport: (files) =>
      http.post(
        `${API_ROOT}/command`,
        { name: 'ManualImport', importMode: 'auto', files },
        { retry: { attempts: 1 } },
      ),
    getCommand: (id) => http.get(`${API_ROOT}/command/${id}`),
    deleteEpisodeFiles: async (episodeFileIds) => {
      await http.request('DELETE', `${API_ROOT}/episodefile/bulk`, {
        body: { episodeFileIds },
        retry: { attempts: 1 },
        responseType: 'status',
      });
    },
    blocklistHistory: async (historyId) => {
      await http.post(`${API_ROOT}/history/failed/${historyId}`, undefined, {
        retry: { attempts: 1 },
      });
    },
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

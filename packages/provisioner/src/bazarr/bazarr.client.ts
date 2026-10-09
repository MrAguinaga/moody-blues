import { createHttpClient } from '../http/http.client';
import { HttpStatusError, PollTimeoutError } from '../http/http.errors';
import type { HttpClient, HttpClientOptions } from '../http/http.types';
import { pollUntil, waitUntilReady, type WaitUntilReadyOptions } from '../http/ready.http';
import { encodeSettingsForm } from './bazarr.form';
import type {
  BazarrLanguage,
  BazarrMovie,
  BazarrProviderStatus,
  BazarrSeries,
  BazarrSettings,
  BazarrStatus,
  BazarrTask,
  LanguageProfile,
  ProfileAssignment,
  SettingsEntry,
} from './bazarr.types';

export const DEFAULT_TASK_TIMEOUT_MS = 120_000;
export const DEFAULT_TASK_INTERVAL_MS = 1_000;

const SECRET_KEY_PATTERN = /(?:password|apikey)$/;

export type BazarrReadyOptions = Pick<
  WaitUntilReadyOptions,
  'timeoutMs' | 'sleep' | 'now' | 'random' | 'signal'
>;

export interface BazarrTaskOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  sleep?: HttpClientOptions['sleep'];
  now?: () => number;
}

export interface BazarrClientOptions extends Pick<
  HttpClientOptions,
  'fetch' | 'sleep' | 'random' | 'retry' | 'timeoutMs' | 'signal'
> {
  baseUrl: string;
  apiKey: string;
  now?: () => number;
}

export interface BazarrClient {
  readonly http: HttpClient;
  waitReady(options?: BazarrReadyOptions): Promise<void>;
  getStatus(): Promise<BazarrStatus>;
  getSettings(): Promise<BazarrSettings>;
  saveSettings(entries: readonly SettingsEntry[]): Promise<void>;
  listLanguages(): Promise<BazarrLanguage[]>;
  listProfiles(): Promise<LanguageProfile[]>;
  runTask(taskId: string): Promise<void>;
  waitTask(taskId: string, options?: BazarrTaskOptions): Promise<void>;
  listSeries(): Promise<BazarrSeries[]>;
  listMovies(): Promise<BazarrMovie[]>;
  listProviders(): Promise<BazarrProviderStatus[]>;
  assignSeriesProfile(assignments: readonly ProfileAssignment[]): Promise<void>;
  assignMovieProfile(assignments: readonly ProfileAssignment[]): Promise<void>;
}

interface DataEnvelope<T> {
  data: T;
}

function secretValues(entries: readonly SettingsEntry[]): string[] {
  return entries.flatMap(({ key, value }) =>
    SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value !== '' ? [value] : [],
  );
}

function unquote(snippet: string): string {
  try {
    const parsed: unknown = JSON.parse(snippet);
    return typeof parsed === 'string' ? parsed : snippet;
  } catch {
    return snippet;
  }
}

function describeRejection(error: HttpStatusError, secrets: readonly string[]): string {
  let message = unquote(error.bodySnippet);
  for (const secret of secrets) {
    message = message.split(secret).join('***');
  }
  return message || `HTTP ${error.status}`;
}

function assignmentForm(
  idField: string,
  assignments: readonly ProfileAssignment[],
): URLSearchParams {
  const form = new URLSearchParams();
  for (const { id, profileId } of assignments) {
    form.append(idField, String(id));
    form.append('profileid', String(profileId));
  }
  return form;
}

export function createBazarrClient(options: BazarrClientOptions): BazarrClient {
  const http = createHttpClient({
    baseUrl: options.baseUrl,
    headers: { 'X-API-KEY': options.apiKey },
    fetch: options.fetch,
    sleep: options.sleep,
    random: options.random,
    retry: options.retry,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });

  const getStatus = async () =>
    (await http.get<DataEnvelope<BazarrStatus>>('/api/system/status')).data;

  async function saveSettings(entries: readonly SettingsEntry[]): Promise<void> {
    try {
      await http.post('/api/system/settings', encodeSettingsForm(entries));
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 406) {
        throw new Error(
          `Bazarr rejected the settings: ${describeRejection(error, secretValues(entries))}`,
        );
      }
      throw error;
    }
  }

  async function waitTask(taskId: string, taskOptions: BazarrTaskOptions = {}): Promise<void> {
    try {
      await pollUntil(
        async () => {
          const { data } = await http.get<DataEnvelope<BazarrTask[]>>('/api/system/tasks', {
            query: { taskid: taskId },
          });
          const task = data.find((candidate) => candidate.job_id === taskId);
          if (!task) {
            throw new Error(`Bazarr has no task "${taskId}"`);
          }
          return task.job_running ? undefined : true;
        },
        {
          timeoutMs: taskOptions.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
          intervalMs: taskOptions.intervalMs ?? DEFAULT_TASK_INTERVAL_MS,
          signal: taskOptions.signal ?? options.signal,
          sleep: taskOptions.sleep ?? options.sleep,
          now: taskOptions.now ?? options.now,
        },
      );
    } catch (error) {
      if (error instanceof PollTimeoutError) {
        throw new Error(
          `Bazarr task "${taskId}" was still running after ${Math.round(error.waitedMs / 1000)} s`,
        );
      }
      throw error;
    }
  }

  const listItems = async <T>(path: string): Promise<T[]> =>
    (await http.get<DataEnvelope<T[]>>(path, { query: { start: 0, length: -1 } })).data;

  return {
    http,
    waitReady: (readyOptions = {}) =>
      waitUntilReady(http, {
        service: 'Bazarr',
        readyPath: '/api/system/ping',
        verify: getStatus,
        signal: options.signal,
        ...readyOptions,
      }),
    getStatus,
    getSettings: () => http.get<BazarrSettings>('/api/system/settings'),
    saveSettings,
    listLanguages: () => http.get<BazarrLanguage[]>('/api/system/languages'),
    listProfiles: () => http.get<LanguageProfile[]>('/api/system/languages/profiles'),
    runTask: async (taskId) => {
      await http.post('/api/system/tasks', new URLSearchParams({ taskid: taskId }));
    },
    waitTask,
    listSeries: () => listItems<BazarrSeries>('/api/series'),
    listMovies: () => listItems<BazarrMovie>('/api/movies'),
    listProviders: async () =>
      (await http.get<DataEnvelope<BazarrProviderStatus[]>>('/api/providers')).data,
    assignSeriesProfile: async (assignments) => {
      await http.post('/api/series', assignmentForm('seriesid', assignments));
    },
    assignMovieProfile: async (assignments) => {
      await http.post('/api/movies', assignmentForm('radarrid', assignments));
    },
  };
}

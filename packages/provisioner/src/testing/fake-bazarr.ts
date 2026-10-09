import { createHash } from 'node:crypto';

import { parse } from 'yaml';

import type { BazarrLanguage, BazarrSettings, LanguageProfile } from '../bazarr/bazarr.types';
import type { FetchLike } from '../http/http.types';
import { renderBazarrConfig } from '../preseed/bazarr-config.preseed';
import type { BazarrSeedInput } from '../preseed/preseed.types';
import { type FakeRequest, toFakeRequest } from './fake-fetch';

export interface FakeLibraryItem {
  id: number;
  title: string;
  profileId: number | null;
}

export interface FakeBazarrOptions {
  apiKey: string;
  baseUrl?: string;
  seed?: Partial<BazarrSeedInput>;
  enabledLanguages?: readonly string[];
  profiles?: readonly LanguageProfile[];
  series?: readonly FakeLibraryItem[];
  movies?: readonly FakeLibraryItem[];
  pendingSeries?: readonly FakeLibraryItem[];
  pendingMovies?: readonly FakeLibraryItem[];
  pingFailures?: number;
  linkDelayCalls?: number;
  unreachable?: readonly ('sonarr' | 'radarr')[];
  taskPolls?: number;
  stuckTasks?: readonly string[];
}

export interface FakeBazarrState {
  settings: BazarrSettings;
  languages: BazarrLanguage[];
  profiles: LanguageProfile[];
  series: FakeLibraryItem[];
  movies: FakeLibraryItem[];
  tasksRun: string[];
  signalrRestarts: number;
}

export interface FakeBazarr {
  fetch: FetchLike;
  baseUrl: string;
  apiKey: string;
  requests: FakeRequest[];
  state: FakeBazarrState;
  count(method: string, path?: string): number;
  writes(): FakeRequest[];
  canLogin(username: string, password: string): boolean;
}

const DEFAULT_SEED: BazarrSeedInput = {
  apiKey: 'bazarr-key',
  sonarrApiKey: 'sonarr-key',
  radarrApiKey: 'radarr-key',
  adminUsername: 'Admin',
  adminPassword: 'p@ss word',
};
const LANGUAGES: readonly BazarrLanguage[] = [
  { name: 'English', code2: 'en', code3: 'eng', enabled: false },
  { name: 'Spanish', code2: 'es', code3: 'spa', enabled: false },
  { name: 'Spanish (Latino)', code2: 'ea', code3: 'spl', enabled: false },
  { name: 'Portuguese (Brazil)', code2: 'pb', code3: 'pob', enabled: false },
];
const TASK_IDS: readonly string[] = [
  'update_movies',
  'update_series',
  'wanted_search_missing_subtitles_series',
  'wanted_search_missing_subtitles_movies',
];
const ARRAY_KEYS: readonly string[] = ['enabled_providers', 'path_mappings', 'path_mappings_movie'];
const STRING_KEYS: readonly string[] = ['password'];
const FLAG_VALUES: readonly string[] = ['True', 'False', 'Excluded'];
const CONNECTION_KEYS: readonly string[] = ['ip', 'port', 'base_url', 'ssl', 'apikey'];

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function json(status: number, body?: unknown): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rejected(message: string): Response {
  return json(406, message);
}

function castValue(key: string, raw: string): unknown {
  if (['', 'None', 'null', 'undefined'].includes(raw)) return '';
  if (STRING_KEYS.includes(key)) return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

function normalizeStoredProfile(profile: LanguageProfile): LanguageProfile {
  return {
    ...structuredClone(profile),
    originalFormat: profile.originalFormat ? 1 : 0,
    tag: profile.tag ?? null,
  };
}

function invalidProfile(profile: LanguageProfile): string | undefined {
  for (const item of profile.items ?? []) {
    for (const field of ['audio_exclude', 'audio_only_include', 'hi', 'forced'] as const) {
      if (typeof item[field] !== 'string' || !FLAG_VALUES.includes(item[field])) {
        return `invalid ${field} in language profile ${profile.profileId}`;
      }
    }
  }
  return undefined;
}

export function createFakeBazarr(options: FakeBazarrOptions): FakeBazarr {
  const { apiKey } = options;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:6767';
  const seed: BazarrSeedInput = { ...DEFAULT_SEED, apiKey, ...options.seed };
  const settings = parse(renderBazarrConfig(seed)) as BazarrSettings;
  settings.opensubtitlescom ??= { username: '', password: '' };
  const state: FakeBazarrState = {
    settings,
    languages: LANGUAGES.map((language) => ({
      ...language,
      enabled: options.enabledLanguages?.includes(language.code2) ?? false,
    })),
    profiles: (options.profiles ?? []).map(normalizeStoredProfile),
    series: (options.series ?? []).map((item) => ({ ...item })),
    movies: (options.movies ?? []).map((item) => ({ ...item })),
    tasksRun: [],
    signalrRestarts: 0,
  };
  const requests: FakeRequest[] = [];
  let pingFailures = options.pingFailures ?? 0;
  let linkDelay = options.linkDelayCalls ?? 0;
  const runningPolls = new Map<string, number>();

  function syncTask(taskId: string): void {
    if (taskId === 'update_series') {
      for (const item of options.pendingSeries ?? []) {
        if (!state.series.some((known) => known.id === item.id)) {
          state.series.push({ ...item });
        }
      }
    }
    if (taskId === 'update_movies') {
      for (const item of options.pendingMovies ?? []) {
        if (!state.movies.some((known) => known.id === item.id)) {
          state.movies.push({ ...item });
        }
      }
    }
  }

  function saveSettings(form: URLSearchParams): Response {
    const entries = [...new Set(form.keys())];
    const pending: [string, string, unknown][] = [];
    for (const name of entries) {
      const values = form.getAll(name);
      const [prefix, section, ...rest] = name.split('-');
      if (prefix !== 'settings' || section === undefined || rest.length === 0) continue;
      const key = rest.join('-');
      if (ARRAY_KEYS.includes(key)) {
        pending.push([section, key, values.filter((value) => value !== '')]);
        continue;
      }
      const value = castValue(key, values[0] ?? '');
      if (key === 'apikey' && typeof value !== 'string') {
        return rejected(`${section}.${key} must is_type_of <class 'str'> but it is ${values[0]}`);
      }
      pending.push([section, key, value]);
    }

    const profilesField = form.get('languages-profiles');
    if (profilesField !== null) {
      const incoming = JSON.parse(profilesField) as LanguageProfile[];
      const invalid = incoming.map(invalidProfile).find((message) => message !== undefined);
      if (invalid) {
        return rejected(invalid);
      }
      state.profiles = incoming.map(normalizeStoredProfile);
    }
    const enabled = form.getAll('languages-enabled').filter((code) => code !== '');
    if (enabled.length > 0) {
      state.languages = state.languages.map((language) => ({
        ...language,
        enabled: enabled.includes(language.code2),
      }));
    }

    for (const [section, key, value] of pending) {
      const target = (state.settings[section] ??= {});
      if (section === 'auth' && key === 'password') {
        if (value !== target.password) target.password = md5(String(value));
        continue;
      }
      target[key] = value;
      if (
        (['sonarr', 'radarr'].includes(section) && CONNECTION_KEYS.includes(key)) ||
        key === 'use_sonarr' ||
        key === 'use_radarr'
      ) {
        state.signalrRestarts += 1;
      }
    }
    return json(204);
  }

  function assign(form: URLSearchParams, idField: string, items: FakeLibraryItem[]): Response {
    const ids = form.getAll(idField);
    const profileIds = form.getAll('profileid');
    for (const [index, rawId] of ids.entries()) {
      const raw = profileIds[index] ?? '';
      const profileId = ['', 'null', 'undefined'].includes(raw) ? null : Number(raw);
      if (
        profileId !== null &&
        !state.profiles.some((profile) => profile.profileId === profileId)
      ) {
        return json(500, { message: 'Internal Server Error' });
      }
      const item = items.find((candidate) => candidate.id === Number(rawId));
      if (item) item.profileId = profileId;
    }
    return json(204);
  }

  const libraryView = (items: FakeLibraryItem[], idField: string) => ({
    data: items.map(({ id, title, profileId }) => ({ [idField]: id, title, profileId })),
    total: items.length,
  });

  function taskView(taskId: string) {
    const remaining = runningPolls.get(taskId) ?? 0;
    if (remaining > 0 && !options.stuckTasks?.includes(taskId)) {
      runningPolls.set(taskId, remaining - 1);
    }
    return {
      job_id: taskId,
      name: taskId,
      job_running: remaining > 0 || (options.stuckTasks?.includes(taskId) ?? false),
    };
  }

  function statusView() {
    const delayed = linkDelay > 0;
    if (delayed) linkDelay -= 1;
    const reachable = (service: 'sonarr' | 'radarr') =>
      !delayed && !options.unreachable?.includes(service);
    return {
      data: {
        bazarr_version: '1.6.2',
        sonarr_version: reachable('sonarr') ? '4.0.20.3014' : '',
        radarr_version: reachable('radarr') ? '6.4.4.10685' : '',
      },
    };
  }

  function handle(request: FakeRequest): Response {
    const { method, path } = request;
    if (method === 'GET' && path === '/api/system/ping') {
      if (pingFailures > 0) {
        pingFailures -= 1;
        return json(503);
      }
      return json(200, { status: 'OK' });
    }
    if (request.headers['x-api-key'] !== apiKey) {
      return json(401, { message: 'Unauthorized' });
    }
    const form = new URLSearchParams(typeof request.body === 'string' ? request.body : '');
    const isForm = request.headers['content-type'] === 'application/x-www-form-urlencoded';
    if (method === 'POST' && !isForm) {
      return json(400, { message: 'Expected a url-encoded form' });
    }

    if (method === 'GET' && path === '/api/system/status') {
      return json(200, statusView());
    }
    if (path === '/api/system/settings') {
      return method === 'GET' ? json(200, structuredClone(state.settings)) : saveSettings(form);
    }
    if (method === 'GET' && path === '/api/system/languages') {
      return json(200, structuredClone(state.languages));
    }
    if (method === 'GET' && path === '/api/system/languages/profiles') {
      return json(200, structuredClone(state.profiles));
    }
    if (path === '/api/system/tasks') {
      if (method === 'GET') {
        const taskId = request.query.taskid;
        const ids = taskId && TASK_IDS.includes(taskId) ? [taskId] : TASK_IDS;
        return json(200, { data: ids.map(taskView) });
      }
      const taskId = form.get('taskid') ?? '';
      if (!TASK_IDS.includes(taskId)) {
        return json(500, { message: 'Internal Server Error' });
      }
      state.tasksRun.push(taskId);
      runningPolls.set(taskId, options.taskPolls ?? 0);
      syncTask(taskId);
      return json(204);
    }
    if (path === '/api/series') {
      return method === 'GET'
        ? json(200, libraryView(state.series, 'sonarrSeriesId'))
        : assign(form, 'seriesid', state.series);
    }
    if (path === '/api/movies') {
      return method === 'GET'
        ? json(200, libraryView(state.movies, 'radarrId'))
        : assign(form, 'radarrid', state.movies);
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
      requests.filter((request) => request.method !== 'GET' && request.method !== 'HEAD'),
    canLogin: (username, password) =>
      state.settings.auth?.username === username && state.settings.auth?.password === md5(password),
  };
}

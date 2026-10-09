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
  factoryProfiles?: boolean;
  profilesInUse?: readonly string[];
}

export interface FakeServarrState {
  config: Record<string, Resource>;
  rootFolders: Resource[];
  downloadClients: Resource[];
  customFormats: Resource[];
  qualityProfiles: Resource[];
  releaseProfiles: Resource[];
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

function languagesFor(kind: ArrKind) {
  return [
    ...(kind === 'radarr' ? [{ id: -1, name: 'Any' }] : []),
    { id: -2, name: 'Original' },
    { id: 1, name: 'English' },
    { id: 2, name: 'French' },
    { id: 3, name: 'Spanish' },
    { id: kind === 'radarr' ? 37 : 34, name: 'Spanish (Latino)' },
  ];
}

type QualityEntry = readonly [id: number, name: string];
type SchemaEntry = QualityEntry | { group: string; id: number; members: readonly QualityEntry[] };

const SCHEMA_ENTRIES: Readonly<Record<ArrKind, readonly SchemaEntry[]>> = {
  sonarr: [
    [0, 'Unknown'],
    [1, 'SDTV'],
    {
      group: 'WEB 480p',
      id: 1000,
      members: [
        [12, 'WEBRip-480p'],
        [8, 'WEBDL-480p'],
      ],
    },
    [2, 'DVD'],
    [13, 'Bluray-480p'],
    [22, 'Bluray-576p'],
    [4, 'HDTV-720p'],
    [9, 'HDTV-1080p'],
    [10, 'Raw-HD'],
    {
      group: 'WEB 720p',
      id: 1001,
      members: [
        [14, 'WEBRip-720p'],
        [5, 'WEBDL-720p'],
      ],
    },
    [6, 'Bluray-720p'],
    {
      group: 'WEB 1080p',
      id: 1002,
      members: [
        [15, 'WEBRip-1080p'],
        [3, 'WEBDL-1080p'],
      ],
    },
    [7, 'Bluray-1080p'],
    [20, 'Bluray-1080p Remux'],
    [16, 'HDTV-2160p'],
    {
      group: 'WEB 2160p',
      id: 1003,
      members: [
        [17, 'WEBRip-2160p'],
        [18, 'WEBDL-2160p'],
      ],
    },
    [19, 'Bluray-2160p'],
    [21, 'Bluray-2160p Remux'],
  ],
  radarr: [
    [0, 'Unknown'],
    [24, 'WORKPRINT'],
    [25, 'CAM'],
    [26, 'TELESYNC'],
    [27, 'TELECINE'],
    [29, 'REGIONAL'],
    [28, 'DVDSCR'],
    [1, 'SDTV'],
    [2, 'DVD'],
    [23, 'DVD-R'],
    {
      group: 'WEB 480p',
      id: 1000,
      members: [
        [8, 'WEBDL-480p'],
        [12, 'WEBRip-480p'],
      ],
    },
    [20, 'Bluray-480p'],
    [21, 'Bluray-576p'],
    [4, 'HDTV-720p'],
    {
      group: 'WEB 720p',
      id: 1001,
      members: [
        [5, 'WEBDL-720p'],
        [14, 'WEBRip-720p'],
      ],
    },
    [6, 'Bluray-720p'],
    [9, 'HDTV-1080p'],
    {
      group: 'WEB 1080p',
      id: 1002,
      members: [
        [3, 'WEBDL-1080p'],
        [15, 'WEBRip-1080p'],
      ],
    },
    [7, 'Bluray-1080p'],
    [30, 'Remux-1080p'],
    [16, 'HDTV-2160p'],
    {
      group: 'WEB 2160p',
      id: 1003,
      members: [
        [18, 'WEBDL-2160p'],
        [17, 'WEBRip-2160p'],
      ],
    },
    [19, 'Bluray-2160p'],
    [31, 'Remux-2160p'],
    [22, 'BR-DISK'],
    [10, 'Raw-HD'],
  ],
};

const SPECIFICATION_IMPLEMENTATIONS = [
  'ReleaseTitleSpecification',
  'ReleaseGroupSpecification',
  'LanguageSpecification',
  'SourceSpecification',
  'ResolutionSpecification',
  'SizeSpecification',
  'IndexerFlagSpecification',
];

const SOURCE_OPTIONS: Readonly<Record<ArrKind, readonly QualityEntry[]>> = {
  radarr: [
    [0, 'UNKNOWN'],
    [5, 'DVD'],
    [6, 'TV'],
    [7, 'WEBDL'],
    [8, 'WEBRIP'],
    [9, 'BLURAY'],
  ],
  sonarr: [
    [0, 'Unknown'],
    [1, 'Television'],
    [3, 'Web'],
    [4, 'WebRip'],
    [5, 'DVD'],
    [6, 'Bluray'],
  ],
};

function qualityItem([id, name]: QualityEntry, allowed: boolean): Resource {
  return { quality: { id, name }, items: [], allowed };
}

function schemaItems(kind: ArrKind, allowed: boolean): Resource[] {
  return SCHEMA_ENTRIES[kind].map((entry) =>
    'group' in entry
      ? {
          name: entry.group,
          items: entry.members.map((member) => qualityItem(member, allowed)),
          allowed,
          id: entry.id,
        }
      : qualityItem(entry, allowed),
  );
}

function selectField(name: string, options: readonly QualityEntry[]) {
  return {
    name,
    type: 'select',
    selectOptions: options.map(([value, optionName]) => ({ value, name: optionName })),
  };
}

function specificationSchema(kind: ArrKind, languages: ReturnType<typeof languagesFor>) {
  return SPECIFICATION_IMPLEMENTATIONS.map((implementation) => {
    const fields =
      implementation === 'LanguageSpecification'
        ? [
            selectField(
              'value',
              languages.map((language) => [language.id, language.name] as const),
            ),
            { name: 'exceptLanguage', type: 'checkbox', value: false },
          ]
        : implementation === 'SourceSpecification'
          ? [selectField('value', SOURCE_OPTIONS[kind])]
          : [{ name: 'value', type: 'textbox' }];
    return { implementation, implementationName: implementation, fields };
  });
}

function flattenQualityIds(items: Resource[]): number[] {
  return items.flatMap((item) =>
    item.quality
      ? [(item.quality as { id: number }).id]
      : flattenQualityIds(item.items as Resource[]),
  );
}

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
  const languages = languagesFor(kind);
  const inUse = new Set(options.profilesInUse ?? []);
  let nextFormatId = 1;
  let nextProfileId = 1;
  let nextReleaseProfileId = 1;
  const state: FakeServarrState = {
    config: defaultConfig(kind),
    rootFolders: [],
    downloadClients: [],
    customFormats: [],
    qualityProfiles: [],
    releaseProfiles: [],
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

  const formatItems = (): Resource[] =>
    state.customFormats.map((format) => ({ format: format.id, name: format.name, score: 0 }));

  function validateFormat(body: Resource, existingId: number | undefined) {
    const name = String(body.name ?? '');
    if (!name) {
      return validation('Name', "'Name' must not be empty.");
    }
    if (state.customFormats.some((format) => format.name === name && format.id !== existingId)) {
      return validation('Name', 'Must be unique.');
    }
    const specifications = (body.specifications ?? []) as Resource[];
    if (specifications.length === 0) {
      return validation('Specifications', 'Must contain at least one Condition');
    }
    for (const specification of specifications) {
      if (!specification.name) {
        return validation(
          'Specifications',
          'Condition name(s) cannot be empty or consist of only spaces',
        );
      }
      if (!SPECIFICATION_IMPLEMENTATIONS.includes(String(specification.implementation))) {
        return validation(
          'Implementation',
          `${String(specification.implementation)} is not a valid specification implementation`,
        );
      }
      if (!Array.isArray(specification.fields)) {
        return validation(
          'Specifications',
          'Could not convert JSON to System.Collections.Generic.List<Field>',
        );
      }
    }
    return undefined;
  }

  function storeFormat(body: Resource, id: number): Resource {
    return { ...structuredClone(body), id };
  }

  function validateProfile(body: Resource) {
    if (!body.name) {
      return validation('Name', "'Name' must not be empty.");
    }
    if (Number(body.minUpgradeFormatScore) < 1) {
      return validation(
        'MinUpgradeFormatScore',
        "'Min Upgrade Format Score' must be greater than or equal to '1'.",
      );
    }
    const items = (body.items ?? []) as Resource[];
    const groups = items.filter((item) => !item.quality);
    const groupIds = groups.map((group) => Number(group.id ?? 0));
    if (groupIds.some((id) => id <= 0) || new Set(groupIds).size !== groupIds.length) {
      return validation('Items', 'Groups must have a unique id greater than 0');
    }
    for (const group of groups) {
      if (!group.name || (group.items as Resource[]).length < 2) {
        return validation('Items', 'Groups must have a name and at least two qualities');
      }
    }
    if (items.some((item) => item.quality && item.name)) {
      return validation('Items', 'Individual qualities should not be named');
    }
    const used = flattenQualityIds(items);
    if (new Set(used).size !== used.length) {
      return validation('Items', 'Qualities can only be used once');
    }
    const expected = flattenQualityIds(schemaItems(kind, false));
    if (expected.some((id) => !used.includes(id))) {
      return validation('Items', 'Must contain all qualities');
    }
    if (!items.some((item) => item.allowed)) {
      return validation('Items', 'Must contain at least one allowed quality');
    }
    const cutoffTargets = items
      .filter((item) => item.allowed)
      .map((item) => Number(item.quality ? (item.quality as { id: number }).id : item.id));
    if (!cutoffTargets.includes(Number(body.cutoff))) {
      return validation('Cutoff', 'Cutoff must be an allowed quality or group');
    }
    const scored = (body.formatItems ?? []) as Resource[];
    const missing = state.customFormats.filter(
      (format) => !scored.some((entry) => entry.format === format.id),
    );
    if (missing.length > 0) {
      return validation(
        'FormatItems',
        `All Custom Formats and no extra ones need to be present inside your Profile! Missing: ${missing
          .map((format) => String(format.name))
          .join(', ')}`,
      );
    }
    const reachable = scored.reduce((sum, entry) => sum + Math.max(Number(entry.score), 0), 0);
    if (Number(body.minFormatScore) > reachable) {
      return validation('MinFormatScore', 'Minimum Custom Format Score can never be satisfied');
    }
    return undefined;
  }

  function seedFactoryProfiles(): void {
    for (const name of ['Any', 'SD', 'HD-720p', 'HD-1080p', 'Ultra-HD', 'HD - 720p/1080p']) {
      state.qualityProfiles.push({
        id: nextProfileId,
        name,
        upgradeAllowed: false,
        cutoff: 1,
        items: schemaItems(kind, true),
        minFormatScore: 0,
        cutoffFormatScore: 0,
        minUpgradeFormatScore: 1,
        formatItems: [],
        ...(kind === 'radarr' ? { language: { id: -2, name: 'Original' } } : {}),
      });
      nextProfileId += 1;
    }
  }

  if (options.factoryProfiles ?? true) {
    seedFactoryProfiles();
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
      return json(200, languages);
    }

    if (method === 'GET' && path === '/api/v3/customformat/schema') {
      return json(200, specificationSchema(kind, languages));
    }
    if (path === '/api/v3/customformat') {
      if (method === 'GET') {
        return json(200, state.customFormats);
      }
      if (method === 'POST') {
        const failure = validateFormat(body, undefined);
        if (failure) {
          return failure;
        }
        const stored = storeFormat(body, nextFormatId);
        nextFormatId += 1;
        state.customFormats.push(stored);
        for (const profile of state.qualityProfiles) {
          (profile.formatItems as Resource[]).push({
            format: stored.id,
            name: stored.name,
            score: 0,
          });
        }
        return json(201, stored);
      }
    }
    const formatMatch = /^\/api\/v3\/customformat\/(\d+)$/.exec(path);
    if (method === 'PUT' && formatMatch) {
      const id = Number(formatMatch[1]);
      if (!state.customFormats.some((format) => format.id === id)) {
        return json(404);
      }
      const failure = validateFormat(body, id);
      if (failure) {
        return failure;
      }
      const stored = storeFormat(body, id);
      state.customFormats = state.customFormats.map((format) =>
        format.id === id ? stored : format,
      );
      return json(202, stored);
    }

    if (method === 'GET' && path === '/api/v3/qualityprofile/schema') {
      return json(200, {
        name: '',
        upgradeAllowed: false,
        cutoff: 0,
        items: schemaItems(kind, false),
        minFormatScore: 0,
        cutoffFormatScore: 0,
        minUpgradeFormatScore: 1,
        formatItems: formatItems(),
        ...(kind === 'radarr' ? { language: { id: -2, name: 'Original' } } : {}),
      });
    }
    if (path === '/api/v3/qualityprofile') {
      if (method === 'GET') {
        return json(200, state.qualityProfiles);
      }
      if (method === 'POST') {
        const failure = validateProfile(body);
        if (failure) {
          return failure;
        }
        const stored = { ...structuredClone(body), id: nextProfileId };
        nextProfileId += 1;
        state.qualityProfiles.push(stored);
        return json(201, stored);
      }
    }
    const profileMatch = /^\/api\/v3\/qualityprofile\/(\d+)$/.exec(path);
    if (profileMatch) {
      const id = Number(profileMatch[1]);
      const current = state.qualityProfiles.find((profile) => profile.id === id);
      if (!current) {
        return json(404);
      }
      if (method === 'PUT') {
        const failure = validateProfile(body);
        if (failure) {
          return failure;
        }
        const stored = { ...structuredClone(body), id };
        state.qualityProfiles = state.qualityProfiles.map((profile) =>
          profile.id === id ? stored : profile,
        );
        return json(202, stored);
      }
      if (method === 'DELETE') {
        if (inUse.has(String(current.name))) {
          return json(500, { message: `QualityProfile [${id}] is in use.` });
        }
        state.qualityProfiles = state.qualityProfiles.filter((profile) => profile.id !== id);
        return json(200, {});
      }
    }

    if (path === '/api/v3/releaseprofile') {
      if (method === 'GET') {
        return json(200, state.releaseProfiles);
      }
      if (method === 'POST') {
        const stored = { ...structuredClone(body), id: nextReleaseProfileId };
        nextReleaseProfileId += 1;
        state.releaseProfiles.push(stored);
        return json(201, stored);
      }
    }
    const releaseProfileMatch = /^\/api\/v3\/releaseprofile\/(\d+)$/.exec(path);
    if (releaseProfileMatch && method === 'PUT') {
      const id = Number(releaseProfileMatch[1]);
      if (!state.releaseProfiles.some((profile) => profile.id === id)) {
        return json(404);
      }
      const stored = { ...structuredClone(body), id };
      state.releaseProfiles = state.releaseProfiles.map((profile) =>
        profile.id === id ? stored : profile,
      );
      return json(202, stored);
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
      const existingId = typeof body.id === 'number' ? body.id : undefined;
      return validateClient(body, existingId, false) ?? json(200, {});
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

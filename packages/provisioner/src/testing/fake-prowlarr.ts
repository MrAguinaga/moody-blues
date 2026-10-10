import type { ArrKind } from '../arr/arr.types';
import type { FetchLike } from '../http/http.types';
import type { ProviderField } from '../http/provider-fields';
import { PROWLARR_INDEXERS } from '../prowlarr/prowlarr.indexers';
import { type FakeRequest, toFakeRequest } from './fake-fetch';

type Resource = Record<string, unknown>;

export interface FakeProwlarrOptions {
  apiKey: string;
  baseUrl?: string;
  definitions?: readonly string[];
  schemaDelayCalls?: number;
  failingIndexers?: Readonly<Record<string, string>>;
  flaresolverrReachable?: boolean;
  unreachableApplications?: readonly ArrKind[];
  pingFailures?: number;
  commandPolls?: number;
  commandOutcome?: 'completed' | 'failed';
  health?: readonly Resource[];
  proxyFailing?: boolean;
  blockedIndexers?: readonly string[];
}

export interface FakeProwlarrState {
  tags: Resource[];
  proxies: Resource[];
  applications: Resource[];
  indexers: Resource[];
  commands: Resource[];
  host: Resource;
}

export interface FakeProwlarr {
  fetch: FetchLike;
  baseUrl: string;
  apiKey: string;
  requests: FakeRequest[];
  state: FakeProwlarrState;
  count(method: string, path?: string): number;
  writes(): FakeRequest[];
  canLogin(username: string, password: string): boolean;
  setIndexerFailure(definitionName: string, message: string | undefined): void;
}

const MASK = '********';
const PROXY_HEALTH: Resource = {
  source: 'IndexerProxyStatusCheck',
  type: 'error',
  message: 'All indexer proxies are unavailable due to failures',
};
const DEFAULT_DEFINITIONS: readonly string[] = PROWLARR_INDEXERS.map((spec) => spec.definitionName);
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  '1337x': '1337x',
  thepiratebay: 'The Pirate Bay',
  yts: 'YTS',
  eztv: 'EZTV',
  nyaasi: 'Nyaa.si',
};
const DEFINITION_SETTINGS: Readonly<Record<string, ProviderField[]>> = {
  '1337x': [
    field('uploader', null),
    field('sort', 2, 'select'),
    field('info_flaresolverr', null, 'info'),
  ],
  thepiratebay: [field('apiurl', 'apibay.org')],
  yts: [field('apiurl', 'movies-api.accel.li')],
  eztv: [field('info_flaresolverr', null, 'info')],
  nyaasi: [field('prefer_magnet_links', true, 'checkbox')],
};
const APPLICATION_SCHEMAS: Readonly<Record<string, { port: number; fields: ProviderField[] }>> = {
  Sonarr: {
    port: 8989,
    fields: [
      field('syncCategories', [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090], 'select'),
      field('animeSyncCategories', [5070], 'select'),
      field('syncAnimeStandardFormatSearch', true, 'checkbox'),
    ],
  },
  Radarr: {
    port: 7878,
    fields: [
      field(
        'syncCategories',
        [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090],
        'select',
      ),
    ],
  },
  Lidarr: { port: 8686, fields: [field('syncCategories', [3000, 3010], 'select')] },
};

function field(name: string, value: unknown, type = 'textbox', privacy = 'normal'): ProviderField {
  return { name, value, type, privacy };
}

function hashPassword(password: string): string {
  return `hash:${Buffer.from(password).toString('base64')}`;
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

function validation(propertyName: string, errorMessage: string, detailedDescription?: string) {
  return json(400, [
    {
      isWarning: false,
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

// The real Prowlarr leaves `value` out of stored indexer fields that are null.
function omitNullFieldValues(resource: Resource): Resource {
  const clone = structuredClone(resource);
  for (const entry of clone.fields as ProviderField[]) {
    if (entry.value === null) delete entry.value;
  }
  return clone;
}

function cardiganSchemaItem(definitionName: string): Resource {
  const name = DISPLAY_NAMES[definitionName] ?? definitionName;
  return {
    name,
    definitionName,
    implementation: 'Cardigann',
    implementationName: 'Cardigann',
    configContract: 'CardigannSettings',
    protocol: 'torrent',
    privacy: 'public',
    enable: true,
    appProfileId: 0,
    priority: 25,
    downloadClientId: 0,
    indexerUrls: [`https://${definitionName}.example/`],
    tags: [],
    fields: [
      field('definitionFile', definitionName),
      field('baseUrl', null, 'select'),
      field('baseSettings.queryLimit', null, 'number'),
      field('baseSettings.grabLimit', null, 'number'),
      field('baseSettings.limitsUnit', 0, 'select'),
      field('torrentBaseSettings.appMinimumSeeders', null, 'number'),
      field('torrentBaseSettings.seedRatio', null, 'number'),
      field('torrentBaseSettings.seedTime', null, 'number'),
      field('torrentBaseSettings.packSeedTime', null, 'number'),
      field('torrentBaseSettings.preferMagnetUrl', false, 'checkbox'),
      ...structuredClone(DEFINITION_SETTINGS[definitionName] ?? []),
    ],
  };
}

function genericSchemaItem(): Resource {
  return {
    name: '',
    implementation: 'Newznab',
    implementationName: 'Generic Newznab',
    configContract: 'NewznabSettings',
    protocol: 'usenet',
    privacy: 'private',
    enable: true,
    appProfileId: 0,
    priority: 25,
    tags: [],
    fields: [field('baseUrl', null), field('apiKey', null, 'textbox', 'apiKey')],
  };
}

export function createFakeProwlarr(options: FakeProwlarrOptions): FakeProwlarr {
  const { apiKey } = options;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:9696';
  const definitions = options.definitions ?? DEFAULT_DEFINITIONS;
  let schemaDelay = options.schemaDelayCalls ?? 0;
  const failingIndexers: Record<string, string> = { ...options.failingIndexers };
  let pingFailures = options.pingFailures ?? 0;
  const flaresolverrReachable = options.flaresolverrReachable ?? true;
  const commandPolls = options.commandPolls ?? 0;
  const commandOutcome = options.commandOutcome ?? 'completed';
  let proxyFailing = options.proxyFailing ?? false;
  let healthSnapshotFailing = proxyFailing;
  let nextId = { tag: 1, proxy: 1, application: 1, indexer: 1, command: 1 };
  const appProfiles = [
    {
      id: 1,
      name: 'Standard',
      enableRss: true,
      enableAutomaticSearch: true,
      enableInteractiveSearch: true,
      minimumSeeders: 1,
    },
  ];
  const state: FakeProwlarrState = {
    tags: [],
    proxies: [],
    applications: [],
    indexers: [],
    commands: [],
    host: {
      id: 1,
      bindAddress: '*',
      port: 9696,
      authenticationMethod: 'forms',
      authenticationRequired: 'enabled',
      allowedHosts: '',
      analyticsEnabled: true,
      logLevel: 'debug',
      logSizeLimit: 1,
      branch: 'master',
      instanceName: 'Prowlarr',
    },
  };
  const storedKeys = new Map<number, unknown>();
  const commandReads = new Map<number, number>();
  const requests: FakeRequest[] = [];
  const user = { name: '', hash: '' };

  const hostView = (): Resource => ({
    ...state.host,
    username: user.name,
    password: user.hash,
    passwordConfirmation: '',
  });

  function putHost(body: Resource): Response {
    const method = String(body.authenticationMethod);
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    const confirmation = String(body.passwordConfirmation ?? '');
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
    if (username && password) {
      user.name = username.toLowerCase();
      if (password !== user.hash) {
        user.hash = hashPassword(password);
      }
    }
    state.host = { ...body, username: '', password: '', passwordConfirmation: '', id: 1 };
    return json(202, 1);
  }

  function maskApplication(resource: Resource): Resource {
    const clone = structuredClone(resource);
    for (const entry of clone.fields as ProviderField[]) {
      if (entry.name === 'apiKey' && entry.value) {
        entry.value = MASK;
      }
    }
    return clone;
  }

  function validateProxy(
    body: Resource,
    existingId: number | undefined,
    forceSave: boolean,
    liveTest = false,
  ) {
    const name = String(body.name ?? '');
    if (state.proxies.some((proxy) => proxy.name === name && proxy.id !== existingId)) {
      return validation('Name', 'Should be unique');
    }
    if (!fieldValue(body, 'host')) {
      return validation('Host', "'Host' must not be empty.");
    }
    if (!flaresolverrReachable && (liveTest || !forceSave)) {
      return validation(
        'Host',
        'Unable to connect to proxy: Name does not resolve (flaresolverr:8191)',
      );
    }
    return undefined;
  }

  function validateApplication(body: Resource, existingId: number | undefined, forceSave: boolean) {
    const name = String(body.name ?? '');
    if (state.applications.some((app) => app.name === name && app.id !== existingId)) {
      return validation('Name', 'Should be unique');
    }
    const schema = APPLICATION_SCHEMAS[String(body.implementation)];
    if (!schema) {
      return json(404, { message: `Unknown application ${String(body.implementation)}` });
    }
    const appUrl = String(fieldValue(body, 'baseUrl') ?? '');
    const prowlarrUrl = String(fieldValue(body, 'prowlarrUrl') ?? '');
    if (!/^https?:\/\//.test(appUrl) || !/^https?:\/\//.test(prowlarrUrl)) {
      return validation('BaseUrl', "'Base Url' must be a valid URL.");
    }
    if (!fieldValue(body, 'apiKey')) {
      return validation('ApiKey', "'Api Key' must not be empty.");
    }
    if (
      body.implementation === 'Radarr' &&
      (fieldValue(body, 'syncCategories') as unknown[]).length === 0
    ) {
      return validation('SyncCategories', "'Sync Categories' must not be empty.");
    }
    if (forceSave && existingId !== undefined) {
      return undefined;
    }
    const kind = String(body.implementation).toLowerCase() as ArrKind;
    if (options.unreachableApplications?.includes(kind)) {
      return validation(
        'BaseUrl',
        `Unable to complete application test, cannot connect to ${String(body.implementation)}. Name does not resolve`,
      );
    }
    if (new URL(appUrl).port !== String(schema.port)) {
      return validation('ApiKey', 'API Key is invalid');
    }
    return undefined;
  }

  function validateIndexer(body: Resource, existingId: number | undefined, forceSave: boolean) {
    const name = String(body.name ?? '');
    if (state.indexers.some((indexer) => indexer.name === name && indexer.id !== existingId)) {
      return validation('Name', 'Should be unique');
    }
    const priority = Number(body.priority);
    if (priority < 1 || priority > 50) {
      return validation('Priority', "'Priority' must be between 1 and 50.");
    }
    if (!appProfiles.some((profile) => profile.id === body.appProfileId)) {
      return validation('AppProfileId', 'App profile does not exist');
    }
    if (forceSave && existingId !== undefined) {
      return undefined;
    }
    const failure = failingIndexers[String(body.definitionName)];
    if (failure !== undefined) {
      return validation('', failure);
    }
    return undefined;
  }

  function checkIndexerFields(body: Resource): Response | undefined {
    const definitionName = String(body.definitionName);
    const known = cardiganSchemaItem(definitionName).fields as ProviderField[];
    const unknown = (body.fields as ProviderField[]).find(
      (entry) => !known.some((candidate) => candidate.name === entry.name),
    );
    return unknown
      ? json(500, {
          message: `Specified argument was out of the range of valid values: ${unknown.name}`,
        })
      : undefined;
  }

  function indexerSchema(): Resource[] {
    const cardigan =
      schemaDelay > 0 ? [] : definitions.map((definition) => cardiganSchemaItem(definition));
    return [genericSchemaItem(), ...cardigan];
  }

  function commandView(command: Resource): Resource {
    const reads = commandReads.get(command.id as number) ?? 0;
    if (reads <= commandPolls) {
      return { ...command, status: reads === 0 ? 'queued' : 'started' };
    }
    return {
      ...command,
      status: commandOutcome,
      ...(commandOutcome === 'failed' ? { message: 'Application sync failed' } : {}),
    };
  }

  async function handle(request: FakeRequest): Promise<Response> {
    const { method, path, query } = request;
    const body = (request.body ?? {}) as Resource;
    const forceSave = query.forceSave === 'true';

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

    if (method === 'GET' && path === '/api/v1/system/status') {
      return json(200, {
        appName: 'Prowlarr',
        version: '0.0.0-fake',
        authentication: String(state.host.authenticationMethod),
      });
    }
    if (method === 'GET' && path === '/api/v1/health') {
      return json(200, [
        ...(options.health ?? []),
        ...(healthSnapshotFailing ? [PROXY_HEALTH] : []),
      ]);
    }
    if (method === 'GET' && path === '/api/v1/appprofile') {
      return json(200, appProfiles);
    }
    const profileMatch = /^\/api\/v1\/appprofile\/(\d+)$/.exec(path);
    if (method === 'PUT' && profileMatch) {
      const index = appProfiles.findIndex((profile) => profile.id === Number(profileMatch[1]));
      if (index < 0) {
        return json(404);
      }
      appProfiles[index] = {
        ...appProfiles[index],
        ...structuredClone(body),
      } as (typeof appProfiles)[number];
      return json(202, appProfiles[index]);
    }
    if (method === 'GET' && path === '/api/v1/indexerstatus') {
      const blocked = options.blockedIndexers ?? [];
      return json(
        200,
        state.indexers
          .filter((indexer) => blocked.includes(String(indexer.definitionName)))
          .map((indexer) => ({
            id: indexer.id,
            indexerId: indexer.id,
            disabledTill: '2999-01-01T00:00:00Z',
            mostRecentFailure: '2026-01-01T00:00:00Z',
            initialFailure: '2026-01-01T00:00:00Z',
          })),
      );
    }

    if (method === 'GET' && path === '/api/v1/config/host') {
      return json(200, hostView());
    }
    if (method === 'PUT' && path === '/api/v1/config/host/1') {
      return putHost(body);
    }

    if (path === '/api/v1/tag') {
      if (method === 'GET') {
        return json(200, state.tags);
      }
      if (method === 'POST') {
        const label = String(body.label ?? '').toLowerCase();
        const existing = state.tags.find((tag) => tag.label === label);
        if (existing) {
          return json(201, existing);
        }
        const tag = { id: nextId.tag, label };
        nextId = { ...nextId, tag: nextId.tag + 1 };
        state.tags.push(tag);
        return json(201, tag);
      }
    }

    if (method === 'GET' && path === '/api/v1/indexerproxy/schema') {
      return json(200, [
        {
          name: '',
          implementation: 'FlareSolverr',
          implementationName: 'FlareSolverr',
          configContract: 'FlareSolverrSettings',
          onHealthIssue: false,
          tags: [],
          fields: [field('host', 'http://localhost:8191/'), field('requestTimeout', 60)],
        },
        {
          name: '',
          implementation: 'Http',
          configContract: 'HttpSettings',
          onHealthIssue: false,
          tags: [],
          fields: [field('host', null), field('port', 0)],
        },
      ]);
    }
    if (method === 'POST' && path === '/api/v1/indexerproxy/test') {
      const failure = validateProxy(body, body.id as number | undefined, true, true);
      if (failure) {
        return failure;
      }
      proxyFailing = false;
      return json(200, {});
    }
    if (path === '/api/v1/indexerproxy') {
      if (method === 'GET') {
        return json(200, state.proxies);
      }
      if (method === 'POST') {
        const failure = validateProxy(body, undefined, forceSave);
        if (failure) {
          return failure;
        }
        const stored: Resource = { ...structuredClone(body), id: nextId.proxy };
        nextId = { ...nextId, proxy: nextId.proxy + 1 };
        state.proxies.push(stored);
        return json(201, stored);
      }
    }
    const proxyMatch = /^\/api\/v1\/indexerproxy\/(\d+)$/.exec(path);
    if (method === 'PUT' && proxyMatch) {
      const id = Number(proxyMatch[1]);
      if (!state.proxies.some((proxy) => proxy.id === id)) {
        return json(404);
      }
      const failure = validateProxy(body, id, forceSave);
      if (failure) {
        return failure;
      }
      const stored: Resource = { ...structuredClone(body), id };
      state.proxies = state.proxies.map((proxy) => (proxy.id === id ? stored : proxy));
      return json(202, stored);
    }

    if (method === 'GET' && path === '/api/v1/applications/schema') {
      return json(
        200,
        Object.entries(APPLICATION_SCHEMAS).map(([implementation, schema]) => ({
          name: '',
          implementation,
          implementationName: implementation,
          configContract: `${implementation}Settings`,
          syncLevel: 'fullSync',
          enable: true,
          tags: [],
          fields: [
            field('prowlarrUrl', 'http://localhost:9696'),
            field('baseUrl', `http://localhost:${schema.port}`),
            field('apiKey', null, 'textbox', 'apiKey'),
            ...structuredClone(schema.fields),
          ],
        })),
      );
    }
    if (path === '/api/v1/applications') {
      if (method === 'GET') {
        return json(200, state.applications.map(maskApplication));
      }
      if (method === 'POST') {
        const failure = validateApplication(body, undefined, forceSave);
        if (failure) {
          return failure;
        }
        const id = nextId.application;
        nextId = { ...nextId, application: id + 1 };
        const stored: Resource = { ...structuredClone(body), id };
        storedKeys.set(id, fieldValue(body, 'apiKey'));
        state.applications.push(stored);
        return json(201, maskApplication(stored));
      }
    }
    const applicationMatch = /^\/api\/v1\/applications\/(\d+)$/.exec(path);
    if (method === 'PUT' && applicationMatch) {
      const id = Number(applicationMatch[1]);
      if (!state.applications.some((app) => app.id === id)) {
        return json(404);
      }
      const failure = validateApplication(body, id, forceSave);
      if (failure) {
        return failure;
      }
      const stored: Resource = { ...structuredClone(body), id };
      for (const entry of stored.fields as ProviderField[]) {
        if (entry.name === 'apiKey') {
          if (entry.value === MASK) {
            entry.value = storedKeys.get(id);
          } else {
            storedKeys.set(id, entry.value);
          }
        }
      }
      state.applications = state.applications.map((app) => (app.id === id ? stored : app));
      return json(202, maskApplication(stored));
    }

    if (method === 'GET' && path === '/api/v1/indexer/schema') {
      const schema = indexerSchema();
      if (schemaDelay > 0) {
        schemaDelay -= 1;
      }
      return json(200, schema);
    }
    if (path === '/api/v1/indexer') {
      if (method === 'GET') {
        return json(200, state.indexers.map(omitNullFieldValues));
      }
      if (method === 'POST') {
        const unknownField = checkIndexerFields(body);
        if (unknownField) {
          return unknownField;
        }
        const failure = validateIndexer(body, undefined, forceSave);
        if (failure) {
          return failure;
        }
        const stored: Resource = { ...structuredClone(body), id: nextId.indexer };
        nextId = { ...nextId, indexer: nextId.indexer + 1 };
        state.indexers.push(stored);
        return json(201, stored);
      }
    }
    const indexerMatch = /^\/api\/v1\/indexer\/(\d+)$/.exec(path);
    if (method === 'PUT' && indexerMatch) {
      const id = Number(indexerMatch[1]);
      if (!state.indexers.some((indexer) => indexer.id === id)) {
        return json(404);
      }
      const unknownField = checkIndexerFields(body);
      if (unknownField) {
        return unknownField;
      }
      const failure = validateIndexer(body, id, forceSave);
      if (failure) {
        return failure;
      }
      const stored: Resource = { ...structuredClone(body), id };
      state.indexers = state.indexers.map((indexer) => (indexer.id === id ? stored : indexer));
      return json(202, stored);
    }

    if (method === 'POST' && path === '/api/v1/command') {
      const command = {
        id: nextId.command,
        name: String(body.name),
        body,
        status: 'queued',
      };
      nextId = { ...nextId, command: nextId.command + 1 };
      state.commands.push(command);
      if (command.name === 'CheckHealth') {
        healthSnapshotFailing = proxyFailing;
      }
      return json(201, commandView(command));
    }
    const commandMatch = /^\/api\/v1\/command\/(\d+)$/.exec(path);
    if (method === 'GET' && commandMatch) {
      const id = Number(commandMatch[1]);
      const command = state.commands.find((candidate) => candidate.id === id);
      if (!command) {
        return json(404);
      }
      commandReads.set(id, (commandReads.get(id) ?? 0) + 1);
      return json(200, commandView(command));
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
          request.method !== 'GET' && request.method !== 'HEAD' && !request.path.endsWith('/test'),
      ),
    canLogin: (username, password) =>
      user.name !== '' &&
      username.toLowerCase() === user.name &&
      hashPassword(password) === user.hash,
    setIndexerFailure: (definitionName, message) => {
      if (message === undefined) {
        delete failingIndexers[definitionName];
      } else {
        failingIndexers[definitionName] = message;
      }
    },
  };
}

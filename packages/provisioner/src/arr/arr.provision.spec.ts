import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import { HttpStatusError } from '../http/http.errors';
import { ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import { runPipeline } from '../pipeline/pipeline.runner';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { createFakeServarr, type FakeServarr } from '../testing/fake-servarr';
import { createArrClient } from './arr.client';
import { createArrProvisionStep, provisionArr } from './arr.provision';
import { buildReleaseExclusions, EXCLUDED_RELEASE_TERMS } from './arr.settings';
import { ARR_STEPS } from './arr.steps';
import { ARR_KINDS, type ArrKind } from './arr.types';

const identity = { puid: 1000, pgid: 1000 };
const secrets = { rdApiToken: 'rd-token', adminUsername: 'Admin', adminPassword: 'p@ss word' };
const API_KEYS: Record<ArrKind, string> = { sonarr: 'sonarr-key', radarr: 'radarr-key' };
const JELLYFIN_KEY = 'jellyfin-secret-key';
const noSleep = async () => undefined;

function createContext(overrides: Partial<ProvisionContext> = {}): ProvisionContext {
  return {
    config: createDefaultConfig({ host: identity }),
    secrets,
    layout: createLayout('/unused'),
    identity,
    runtime: {} as ContainerRuntime,
    flags: new Map(),
    cliVersion: '9.9.9',
    ...overrides,
  };
}

function run(
  kind: ArrKind,
  server: FakeServarr,
  ctx: ProvisionContext = createContext(),
  jellyfinApiKey: string | null = JELLYFIN_KEY,
) {
  const client = createArrClient({
    kind,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    fetch: server.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return provisionArr(ctx, {
    kind,
    client,
    apiKey: server.apiKey,
    jellyfinApiKey: jellyfinApiKey ?? undefined,
    signal: new AbortController().signal,
    ready: { sleep: noSleep },
  });
}

function singleton(server: FakeServarr, name: string): Record<string, unknown> {
  return server.state.config[name] as Record<string, unknown>;
}

describe.each(ARR_KINDS)('provisionArr (%s)', (kind) => {
  let server: FakeServarr;

  beforeEach(() => {
    server = createFakeServarr({ kind, apiKey: API_KEYS[kind], jellyfinApiKey: JELLYFIN_KEY });
  });

  it('provisions a fresh instance and reports what changed', async () => {
    const outcome = await run(kind, server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toContain('administrator account');
    expect(outcome.detail).toContain('root folder');
    expect(outcome.detail).toContain('created download client without connection test');
    expect(server.canLogin('admin', 'p@ss word')).toBe(true);
    expect(server.canLogin('admin', 'wrong')).toBe(false);
    expect(singleton(server, 'host')).toMatchObject({
      authenticationMethod: 'forms',
      authenticationRequired: 'enabled',
      analyticsEnabled: false,
      logLevel: 'info',
    });
    expect(server.state.rootFolders.map((folder) => folder.path)).toEqual([
      kind === 'sonarr' ? '/data/media/tv' : '/data/media/movies',
    ]);
    expect(singleton(server, 'mediamanagement')).toMatchObject({
      skipFreeSpaceCheckWhenImporting: true,
      recycleBin: '',
    });
    expect(singleton(server, 'ui').uiLanguage).toBe(3);
    expect(singleton(server, 'indexer').rssSyncInterval).toBe(30);
  });

  it('stores the Decypharr client enabled with the service api key as password', async () => {
    await run(kind, server);

    const [client] = server.state.downloadClients;
    const fieldValues = Object.fromEntries(
      (client?.fields as { name: string; value: unknown }[]).map((entry) => [
        entry.name,
        entry.value,
      ]),
    );
    expect(client).toMatchObject({ name: 'Decypharr', enable: true, removeFailedDownloads: false });
    expect(fieldValues).toMatchObject({
      host: 'decypharr',
      port: 8282,
      apiKey: '',
      username: `http://${kind}:${kind === 'sonarr' ? 8989 : 7878}`,
      password: API_KEYS[kind],
    });
  });

  it('emits no write on the second run', async () => {
    await run(kind, server);
    const writesAfterFirst = server.writes().length;

    const outcome = await run(kind, server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(writesAfterFirst);
    expect(server.requests.slice(-1)[0]?.method).toBe('GET');
  });

  it('writes nothing on the second run even when the username case differs', async () => {
    await run(kind, server);
    const before = server.writes().length;

    await run(kind, server, createContext({ secrets: { ...secrets, adminUsername: 'ADMIN' } }));

    expect(server.writes()).toHaveLength(before);
  });

  it('repairs only the section that drifted', async () => {
    await run(kind, server);
    const before = server.writes().length;
    server.state.config.mediamanagement = {
      ...singleton(server, 'mediamanagement'),
      recycleBin: '/trash',
      skipFreeSpaceCheckWhenImporting: false,
    };

    const outcome = await run(kind, server);

    expect(outcome).toEqual({ status: 'changed', detail: 'media management' });
    expect(
      server
        .writes()
        .slice(before)
        .map((request) => `${request.method} ${request.path}`),
    ).toEqual(['PUT /api/v3/config/mediamanagement/1']);
    expect(singleton(server, 'mediamanagement')).toMatchObject({
      recycleBin: '',
      skipFreeSpaceCheckWhenImporting: true,
    });
  });

  it('repairs a drifted download client with its real password and forceSave', async () => {
    await run(kind, server);
    const [client] = server.state.downloadClients;
    const drifted = structuredClone(client) as { fields: { name: string; value: unknown }[] };
    drifted.fields.find((entry) => entry.name === 'port')!.value = 9999;
    server.state.downloadClients = [drifted];
    const before = server.writes().length;

    const outcome = await run(kind, server);

    expect(outcome).toEqual({ status: 'changed', detail: 'updated download client' });
    const [write] = server.writes().slice(before);
    expect(write).toMatchObject({
      method: 'PUT',
      path: '/api/v3/downloadclient/1',
      query: { forceSave: 'true' },
    });
    const sent = write?.body as { fields: { name: string; value: unknown }[] };
    expect(sent.fields.find((entry) => entry.name === 'port')?.value).toBe(8282);
    expect(sent.fields.find((entry) => entry.name === 'password')?.value).toBe(API_KEYS[kind]);
  });

  it('keeps the existing administrator when credentials are in sync and rewrites them on rotation', async () => {
    await run(kind, server);
    const before = server.writes().length;
    const flags = new Map([[ROTATE_CREDENTIALS_FLAG, true]]);

    const outcome = await run(kind, server, createContext({ flags }));

    expect(outcome).toEqual({ status: 'changed', detail: 'administrator account' });
    expect(
      server
        .writes()
        .slice(before)
        .map((request) => request.path),
    ).toEqual(['/api/v3/config/host/1']);
  });

  it('updates the administrator when the configured username changes', async () => {
    await run(kind, server);

    const outcome = await run(
      kind,
      server,
      createContext({ secrets: { ...secrets, adminUsername: 'owner', adminPassword: 'new-pass' } }),
    );

    expect(outcome.detail).toBe('administrator account');
    expect(server.canLogin('owner', 'new-pass')).toBe(true);
    expect(server.canLogin('admin', 'p@ss word')).toBe(false);
  });

  it('sends the complete host object when it creates the administrator', async () => {
    await run(kind, server);

    const put = server.requests.find((request) => request.path === '/api/v3/config/host/1');
    expect(put?.body).toMatchObject({
      id: 1,
      allowedHosts: '',
      branch: expect.any(String),
      logSizeLimit: 1,
      backupInterval: 7,
      backupRetention: 28,
      username: 'Admin',
      password: 'p@ss word',
      passwordConfirmation: 'p@ss word',
    });
  });

  it('waits for the service to answer before configuring it', async () => {
    server = createFakeServarr({ kind, apiKey: API_KEYS[kind], pingFailures: 3 });

    const outcome = await run(kind, server);

    expect(outcome.status).toBe('changed');
    expect(server.count('GET', '/ping')).toBe(4);
  });

  it('fails when the seeded api key is rejected', async () => {
    const wrong = createFakeServarr({ kind, apiKey: 'another-key' });
    const client = createArrClient({
      kind,
      baseUrl: wrong.baseUrl,
      apiKey: 'seeded-key',
      fetch: wrong.fetch,
      sleep: noSleep,
    });

    await expect(
      provisionArr(createContext(), {
        kind,
        client,
        apiKey: 'seeded-key',
        signal: new AbortController().signal,
        ready: { sleep: noSleep },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(wrong.writes()).toHaveLength(0);
  });

  it('reports the validation message when a root folder cannot be created', async () => {
    server = createFakeServarr({ kind, apiKey: API_KEYS[kind], existingFolders: [] });

    const error = await run(kind, server).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).message).toContain('Path: Folder');
  });

  it('creates the release exclusions profile and reports it', async () => {
    const outcome = await run(kind, server);

    expect(outcome.detail).toContain('release exclusions');
    expect(server.state.releaseProfiles).toEqual([{ ...buildReleaseExclusions(), id: 1 }]);
  });

  it('repairs drifted release exclusions with a single PUT on the same profile', async () => {
    await run(kind, server);
    server.state.releaseProfiles = [
      { ...buildReleaseExclusions(), id: 1, enabled: false, ignored: ['other'], tags: [4] },
    ];
    const before = server.writes().length;

    const outcome = await run(kind, server);

    expect(outcome).toEqual({ status: 'changed', detail: 'release exclusions' });
    const writes = server.writes().slice(before);
    expect(writes.map((request) => `${request.method} ${request.path}`)).toEqual([
      'PUT /api/v3/releaseprofile/1',
    ]);
    expect(server.state.releaseProfiles).toEqual([{ ...buildReleaseExclusions(), id: 1 }]);
  });

  it('ignores the order of the terms and leaves other release profiles untouched', async () => {
    const foreign = {
      id: 7,
      name: 'Mine',
      enabled: true,
      required: ['x265'],
      ignored: ['cam'],
      indexerId: 3,
      tags: [1],
    };
    server.state.releaseProfiles = [
      foreign,
      { ...buildReleaseExclusions(), id: 8, ignored: [...EXCLUDED_RELEASE_TERMS].reverse() },
    ];
    await run(kind, server);
    const before = server.writes().length;

    await run(kind, server);

    expect(server.writes()).toHaveLength(before);
    expect(server.state.releaseProfiles[0]).toEqual(foreign);
    expect(server.state.releaseProfiles).toHaveLength(2);
  });

  describe('Jellyfin connection', () => {
    const connection = (target: FakeServarr) =>
      target.state.notifications[0] as Record<string, unknown>;
    const fieldsOf = (target: FakeServarr) =>
      Object.fromEntries(
        (connection(target).fields as { name: string; value: unknown }[]).map((entry) => [
          entry.name,
          entry.value,
        ]),
      );
    const enabledTriggers = (target: FakeServarr) =>
      Object.entries(connection(target))
        .filter(([key, value]) => key.startsWith('on') && value === true)
        .map(([key]) => key)
        .sort();
    const EXPECTED_TRIGGERS = {
      sonarr: ['onDownload', 'onEpisodeFileDelete', 'onRename', 'onSeriesDelete', 'onUpgrade'],
      radarr: ['onDownload', 'onMovieDelete', 'onMovieFileDelete', 'onRename', 'onUpgrade'],
    };

    it('creates a library-updating Emby / Jellyfin connection by name', async () => {
      const outcome = await run(kind, server);

      expect(outcome.detail).toContain('Jellyfin connection');
      expect(server.state.notifications).toHaveLength(1);
      expect(connection(server)).toMatchObject({
        name: 'Jellyfin',
        implementation: 'MediaBrowser',
        configContract: 'MediaBrowserSettings',
        tags: [],
      });
      expect(enabledTriggers(server)).toEqual(EXPECTED_TRIGGERS[kind]);
      expect(fieldsOf(server)).toEqual({
        host: 'jellyfin',
        port: 8096,
        useSsl: false,
        urlBase: '',
        apiKey: JELLYFIN_KEY,
        notify: false,
        updateLibrary: true,
        mapFrom: '',
        mapTo: '',
      });
    });

    it('writes nothing on the second run although the api masks the key', async () => {
      await run(kind, server);
      const before = server.writes().length;

      const outcome = await run(kind, server);

      expect(outcome).toEqual({ status: 'unchanged' });
      expect(server.writes()).toHaveLength(before);
    });

    it.each([
      [
        'a changed host',
        (target: FakeServarr) => {
          const entry = (connection(target).fields as { name: string; value: unknown }[]).find(
            (candidate) => candidate.name === 'host',
          );
          if (entry) entry.value = 'elsewhere';
        },
      ],
      [
        'a withdrawn trigger',
        (target: FakeServarr) => {
          connection(target).onRename = false;
        },
      ],
      [
        'library updates switched off',
        (target: FakeServarr) => {
          const entry = (connection(target).fields as { name: string; value: unknown }[]).find(
            (candidate) => candidate.name === 'updateLibrary',
          );
          if (entry) entry.value = false;
        },
      ],
    ])('corrects %s with one PUT that carries the real key', async (_label, drift) => {
      await run(kind, server);
      drift(server);
      const before = server.writes().length;

      const outcome = await run(kind, server);

      expect(outcome.detail).toBe('Jellyfin connection');
      const writes = server.writes().slice(before);
      expect(writes.map((request) => `${request.method} ${request.path}`)).toEqual([
        'PUT /api/v3/notification/1',
      ]);
      expect(fieldsOf(server).apiKey).toBe(JELLYFIN_KEY);
      expect(fieldsOf(server)).toMatchObject({ host: 'jellyfin', updateLibrary: true });
      expect(enabledTriggers(server)).toEqual(EXPECTED_TRIGGERS[kind]);
      expect((await run(kind, server)).status).toBe('unchanged');
    });

    it('leaves connections of other names untouched', async () => {
      const foreign = {
        id: 7,
        name: 'Other media server',
        implementation: 'MediaBrowser',
        configContract: 'MediaBrowserSettings',
        onGrab: true,
        tags: [],
        fields: [{ name: 'host', value: 'other' }],
      };
      server.state.notifications.push(structuredClone(foreign));

      await run(kind, server);
      await run(kind, server);

      expect(server.state.notifications[0]).toEqual(foreign);
      expect(server.state.notifications).toHaveLength(2);
    });

    it('fails clearly when the Jellyfin key was never issued', async () => {
      await expect(run(kind, server, createContext(), null)).rejects.toThrow(
        'The Jellyfin API key is missing from the environment file',
      );
      expect(server.state.notifications).toEqual([]);
    });

    it('never leaks the key through the detail, the progress or an error', async () => {
      const messages: string[] = [];
      const outcome = await run(
        kind,
        server,
        createContext({ reportProgress: (message) => messages.push(message) }),
      );
      const rejecting = createFakeServarr({
        kind,
        apiKey: API_KEYS[kind],
        jellyfinApiKey: 'a-different-key',
      });

      const failure = await run(kind, rejecting).then(
        () => undefined,
        (error: unknown) => error as Error,
      );

      expect(JSON.stringify([outcome, messages])).not.toContain(JELLYFIN_KEY);
      expect(failure?.message).toContain('Jellyfin rejected the API key ***');
      expect(failure?.message).not.toContain(JELLYFIN_KEY);
    });

    it('reports its own progress line', async () => {
      const messages: string[] = [];

      await run(
        kind,
        server,
        createContext({ reportProgress: (message) => messages.push(message) }),
      );

      expect(messages).toContain('Configuring Jellyfin connection');
    });
  });

  it('reports progress for every section', async () => {
    const messages: string[] = [];

    await run(kind, server, createContext({ reportProgress: (message) => messages.push(message) }));

    expect(messages[0]).toMatch(/^Waiting for (Sonarr|Radarr)$/);
    expect(messages).toContain('Configuring download client');
    expect(messages.at(-1)).toMatch(/health: No download client is available$/);
  });
});

describe('download client with and without storage', () => {
  it('creates the client enabled in one request when Decypharr is reachable', async () => {
    const server = createFakeServarr({
      kind: 'sonarr',
      apiKey: API_KEYS.sonarr,
      decypharrReachable: true,
    });
    const ctx = createContext({
      config: createDefaultConfig({ host: identity, storage: { enabled: true } }),
    });

    const outcome = await run('sonarr', server, ctx);

    expect(outcome.detail).toContain('created download client');
    expect(outcome.detail).not.toContain('without connection test');
    const clientWrites = server
      .writes()
      .filter((request) => request.path.includes('downloadclient'));
    expect(clientWrites.map((request) => [request.method, request.query])).toEqual([['POST', {}]]);
    expect((clientWrites[0]?.body as { enable: boolean }).enable).toBe(true);
  });

  it('fails with the connection error when storage is enabled and Decypharr is unreachable', async () => {
    const server = createFakeServarr({ kind: 'radarr', apiKey: API_KEYS.radarr });
    const ctx = createContext({
      config: createDefaultConfig({ host: identity, storage: { enabled: true } }),
    });

    const error = await run('radarr', server, ctx).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).message).toContain('Unable to connect to qBittorrent');
    expect(server.state.downloadClients).toHaveLength(0);
  });

  it('uses forceSave only when storage is disabled and never on the creating POST', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr });

    await run('sonarr', server);

    const clientWrites = server
      .writes()
      .filter((request) => request.path.includes('downloadclient'));
    expect(clientWrites.map((request) => [request.method, request.path, request.query])).toEqual([
      ['POST', '/api/v3/downloadclient', {}],
      ['PUT', '/api/v3/downloadclient/1', { forceSave: 'true' }],
    ]);
    expect((clientWrites[0]?.body as { enable: boolean }).enable).toBe(false);
    expect((clientWrites[1]?.body as { enable: boolean }).enable).toBe(true);
  });

  it('keeps the interface language in English when the locale is unknown to the app', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr });
    const ctx = createContext({
      config: createDefaultConfig({ host: identity, languages: { ui: 'ja-JP' } }),
    });

    await run('sonarr', server, ctx);

    expect(singleton(server, 'ui').uiLanguage).toBe(1);
  });
});

describe('Arr provisioning steps', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-arr-'));
    layout = createLayout(join(sandbox, 'home'));
    mkdirSync(layout.root, { recursive: true });
    writeFileSync(
      layout.envFile,
      [
        'SONARR_API_KEY=sonarr-key',
        'RADARR_API_KEY=radarr-key',
        'PROWLARR_API_KEY=prowlarr-key',
        'BAZARR_API_KEY=bazarr-key',
        'DECYPHARR_API_TOKEN=decypharr-token',
        'SEERR_API_KEY=seerr-key',
        'JELLYFIN_API_KEY=jellyfin-key',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('declares sonarr-provision before radarr-provision for every scope that starts services', () => {
    expect(ARR_STEPS.map((step) => [step.id, step.scopes.join(',')])).toEqual([
      ['sonarr-provision', 'setup,reset,config,update'],
      ['radarr-provision', 'setup,reset,config,update'],
    ]);
  });

  it.each([
    ['sonarr', 'http://127.0.0.1:8989'],
    ['radarr', 'http://127.0.0.1:7878'],
  ] as const)('provisions %s through its host url with its own key', async (kind, origin) => {
    const server = createFakeServarr({
      kind,
      apiKey: API_KEYS[kind],
      jellyfinApiKey: 'jellyfin-key',
    });
    const step = createArrProvisionStep(kind, { fetch: server.fetch, sleep: noSleep });
    const ctx = createContext({ layout });

    const first = await runPipeline([step], ctx, { scope: 'setup' });
    const writes = server.writes().length;
    const second = await runPipeline([step], ctx, { scope: 'setup' });

    expect(first.steps[0]).toMatchObject({ id: `${kind}-provision`, status: 'changed' });
    expect(second.steps[0]).toMatchObject({ id: `${kind}-provision`, status: 'unchanged' });
    expect(server.writes()).toHaveLength(writes);
    expect(server.requests.every((request) => request.url.startsWith(origin))).toBe(true);
  });

  it('fails the step when the environment file has no Jellyfin key', async () => {
    writeFileSync(
      layout.envFile,
      readFileSync(layout.envFile, 'utf8').replace(/JELLYFIN_API_KEY=.*\n/, ''),
    );
    const server = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr });
    const step = createArrProvisionStep('sonarr', { fetch: server.fetch, sleep: noSleep });

    const report = await runPipeline([step], createContext({ layout }), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('The Jellyfin API key is missing');
    expect(server.state.notifications).toEqual([]);
  });

  it('fails the pipeline when the environment file lacks the service keys', async () => {
    writeFileSync(layout.envFile, 'SONARR_API_KEY=sonarr-key\n');
    const step = createArrProvisionStep('sonarr', { sleep: noSleep });

    const report = await runPipeline([step], createContext({ layout }), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Missing service keys');
  });

  it('fails with a readiness error when the service never answers', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr, pingFailures: 99 });
    let elapsed = 0;
    const step = createArrProvisionStep('sonarr', {
      fetch: server.fetch,
      ready: {
        timeoutMs: 3000,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
        },
      },
    });

    const report = await runPipeline([step], createContext({ layout }), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Sonarr was not ready');
  });
});

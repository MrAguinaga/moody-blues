import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createArrClient } from '../arr/arr.client';
import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import {
  createFakeSeerr,
  FAKE_SEERR_API_KEY,
  FAKE_SEERR_JELLYFIN_KEY,
  FAKE_SEERR_SESSION_COOKIE,
  type FakeSeerr,
  type FakeSeerrOptions,
} from '../testing/fake-seerr';
import { createFakeServarr, type FakeServarr } from '../testing/fake-servarr';
import { createSeerrClient } from './seerr.client';
import { provisionSeerr } from './seerr.provision';
import type { ArrInstance, SeerrArrKind } from './seerr.types';
import { createSeerrProvisionStep } from './seerr-provision.step';

const identity = { puid: 1000, pgid: 1000 };
const ADMIN = { username: 'Admin', password: 'p@ss word' };
const SONARR_KEY = 'sonarr-key-0123456789';
const RADARR_KEY = 'radarr-key-0123456789';
const PROFILE_ID = 7;
const noSleep = async () => undefined;

async function failureOf(attempt: Promise<unknown>): Promise<Error> {
  try {
    await attempt;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the promise to reject');
}

describe('provisionSeerr', () => {
  let sandbox: string;
  let layout: MbHomeLayout;
  let arrServers: Record<SeerrArrKind, FakeServarr>;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-seerr-provision-'));
    layout = createLayout(sandbox);
    arrServers = {
      sonarr: createFakeServarr({ kind: 'sonarr', apiKey: SONARR_KEY }),
      radarr: createFakeServarr({ kind: 'radarr', apiKey: RADARR_KEY }),
    };
    for (const [kind, folder] of [
      ['sonarr', '/data/media/tv'],
      ['radarr', '/data/media/movies'],
    ] as const) {
      arrServers[kind].state.qualityProfiles.push({ id: PROFILE_ID, name: 'Moody Blues' });
      arrServers[kind].state.rootFolders.push({ id: 1, path: folder });
    }
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function createContext(overrides: Partial<ProvisionContext> = {}): ProvisionContext {
    return {
      config: createDefaultConfig({ host: identity, domain: 'example.org' }),
      secrets: {
        rdApiToken: 'rd-token',
        adminUsername: ADMIN.username,
        adminPassword: ADMIN.password,
      },
      layout,
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
      ...overrides,
    };
  }

  function setup(options: FakeSeerrOptions = {}) {
    return createFakeSeerr({
      accounts: [{ ...ADMIN, isAdministrator: true }],
      ...options,
    });
  }

  function run(server: FakeSeerr, ctx: ProvisionContext = createContext()) {
    const client = createSeerrClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      fetch: server.fetch,
      sleep: noSleep,
      random: () => 0.5,
    });
    const arrs = Object.fromEntries(
      (['sonarr', 'radarr'] as const).map((kind) => [
        kind,
        createArrClient({
          kind,
          baseUrl: arrServers[kind].baseUrl,
          apiKey: arrServers[kind].apiKey,
          fetch: arrServers[kind].fetch,
          sleep: noSleep,
          random: () => 0.5,
        }),
      ]),
    ) as Record<SeerrArrKind, ReturnType<typeof createArrClient>>;
    return provisionSeerr(ctx, {
      client,
      arrs,
      arrApiKeys: { sonarr: SONARR_KEY, radarr: RADARR_KEY },
      signal: new AbortController().signal,
      ready: { sleep: noSleep },
    });
  }

  const routes = (server: FakeSeerr) =>
    server.requests.map((request) => `${request.method} ${request.path}`);
  const writes = (server: FakeSeerr) =>
    server.writes().map((request) => `${request.method} ${request.path}`);

  it('provisions a fresh instance end to end', async () => {
    const server = setup();

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toBe(
      'signed in with the Jellyfin administrator, main settings applicationTitle, applicationUrl, ' +
        'locale, discoverRegion, streamingRegion, defaultPermissions, Jellyfin external hostname, ' +
        'enabled libraries Películas, Series, created Sonarr server, created Radarr server, ' +
        'marked Seerr as initialized',
    );
    expect(server.state.user?.id).toBe(1);
    expect(server.state.initialized).toBe(true);
    expect(server.state.main).toMatchObject({
      applicationTitle: 'Moody Blues',
      applicationUrl: 'https://discover.example.org',
      locale: 'es-MX',
      discoverRegion: 'MX',
      streamingRegion: 'MX',
      defaultPermissions: 160,
      mediaServerLogin: true,
      newPlexLogin: true,
      cacheImages: false,
      originalLanguage: '',
      apiKey: FAKE_SEERR_API_KEY,
    });
    expect(server.state.jellyfin).toMatchObject({
      ip: 'jellyfin',
      port: 8096,
      externalHostname: 'https://watch.example.org',
      apiKey: FAKE_SEERR_JELLYFIN_KEY,
    });
    expect(server.state.jellyfin?.libraries?.map((library) => library.enabled)).toEqual([
      true,
      true,
    ]);
    expect(server.state.scans).toBe(1);
    expect(server.state.instances.sonarr).toEqual([
      expect.objectContaining({
        id: 0,
        name: 'Sonarr',
        hostname: 'sonarr',
        port: 8989,
        apiKey: SONARR_KEY,
        useSsl: false,
        activeProfileId: PROFILE_ID,
        activeProfileName: 'Moody Blues',
        activeDirectory: '/data/media/tv',
        is4k: false,
        isDefault: true,
        enableSeasonFolders: true,
      }),
    ]);
    expect(server.state.instances.radarr).toEqual([
      expect.objectContaining({
        id: 0,
        name: 'Radarr',
        hostname: 'radarr',
        port: 7878,
        apiKey: RADARR_KEY,
        activeDirectory: '/data/media/movies',
        minimumAvailability: 'released',
        is4k: false,
        isDefault: true,
      }),
    ]);
    expect(server.state.tested).toHaveLength(2);
  });

  it('sends the documented sign-in body and leaves initialize for last', async () => {
    const server = setup();

    await run(server);

    const login = server.requests.find((request) => request.path === '/api/v1/auth/jellyfin');
    expect(login?.body).toEqual({
      username: ADMIN.username,
      password: ADMIN.password,
      hostname: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      serverType: 2,
    });
    expect(login?.headers['x-api-key']).toBeUndefined();
    expect(routes(server).at(-1)).toBe('POST /api/v1/settings/initialize');
    expect(routes(server).indexOf('POST /api/v1/auth/jellyfin')).toBeLessThan(
      routes(server).indexOf('POST /api/v1/settings/main'),
    );
  });

  it('is idempotent: the second run reads everything and writes nothing', async () => {
    const server = setup();
    await run(server);
    const before = server.requests.length;

    const outcome = await run(server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.requests.slice(before).every((request) => request.method === 'GET')).toBe(true);
    expect(server.requests.slice(before).map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/main',
      'GET /api/v1/settings/jellyfin',
      'GET /api/v1/settings/sonarr',
      'GET /api/v1/settings/radarr',
    ]);
    for (const kind of ['sonarr', 'radarr'] as const) {
      expect(arrServers[kind].writes()).toEqual([]);
    }
  });

  it('skips the sign-in when the administrator already exists', async () => {
    const server = setup({ signedIn: true, libraries: [], initialized: false });

    const outcome = await run(server);

    expect(outcome.detail).not.toContain('signed in');
    expect(server.state.logins).toBe(0);
    expect(writes(server)).not.toContain('POST /api/v1/auth/jellyfin');
  });

  it('only posts the main settings that differ and never the API key', async () => {
    const server = setup({
      initialized: true,
      libraries: [{ id: 'movies-id', name: 'Películas', enabled: true }],
      main: {
        applicationTitle: 'Moody Blues',
        applicationUrl: 'https://discover.example.org',
        locale: 'es-MX',
        discoverRegion: 'MX',
        streamingRegion: 'MX',
        defaultPermissions: 32,
        cacheImages: true,
      },
      externalHostname: 'https://watch.example.org',
      instances: {},
    });

    await run(server);

    const post = server.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/v1/settings/main',
    );
    expect(post?.body).toEqual({ defaultPermissions: 160, cacheImages: false });
    expect(JSON.stringify(post?.body)).not.toContain('apiKey');
    expect(server.state.main.apiKey).toBe(FAKE_SEERR_API_KEY);
  });

  it('writes the Jellyfin connection with ip and without touching the libraries', async () => {
    const server = setup();

    await run(server);

    const post = server.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/v1/settings/jellyfin',
    );
    expect(post?.body).toEqual({
      ip: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      apiKey: FAKE_SEERR_JELLYFIN_KEY,
      externalHostname: 'https://watch.example.org',
    });
    expect(post?.body).not.toHaveProperty('hostname');
    expect(post?.body).not.toHaveProperty('libraries');
  });

  it('only syncs libraries when one is missing or disabled', async () => {
    const server = setup({
      initialized: true,
      externalHostname: 'https://watch.example.org',
      libraries: [
        { id: 'movies-id', name: 'Películas', enabled: true },
        { id: 'series-id', name: 'Series', enabled: false },
      ],
      main: {
        applicationTitle: 'Moody Blues',
        applicationUrl: 'https://discover.example.org',
        locale: 'es-MX',
        discoverRegion: 'MX',
        streamingRegion: 'MX',
        defaultPermissions: 160,
      },
    });

    const outcome = await run(server);

    expect(outcome.detail).toContain('enabled libraries Series');
    expect(writes(server)).toContain('POST /api/v1/settings/jellyfin/library/sync');
    expect(writes(server).filter((route) => route.startsWith('PUT'))).toEqual([
      'PUT /api/v1/settings/jellyfin/library/series-id',
    ]);
    expect(server.state.jellyfin?.libraries?.every((library) => library.enabled)).toBe(true);
    expect(server.state.scans).toBe(1);
  });

  it('corrects an instance that points at another profile with a PUT', async () => {
    const server = setup();
    await run(server);
    arrServers.radarr.state.qualityProfiles = [{ id: 11, name: 'Moody Blues' }];
    const before = server.requests.length;

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toBe('updated Radarr server (activeProfileId)');
    const sent = server.requests.slice(before).filter((request) => request.method !== 'GET');
    expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
      'PUT /api/v1/settings/radarr/0',
    ]);
    expect(sent[0]?.body).not.toHaveProperty('id');
    expect(server.state.instances.radarr[0]).toMatchObject({ id: 0, activeProfileId: 11 });
    expect(server.state.instances.radarr).toHaveLength(1);
  });

  it('treats an empty and an absent base URL as the same', async () => {
    const server = setup();
    await run(server);
    for (const kind of ['sonarr', 'radarr'] as const) {
      delete (server.state.instances[kind][0] as Partial<ArrInstance>).baseUrl;
    }

    const outcome = await run(server);

    expect(outcome.status).toBe('unchanged');
  });

  it('compares the stored arr key when Seerr returns it and notes when it does not', async () => {
    const server = setup();
    await run(server);
    server.state.instances.sonarr[0]!.apiKey = 'rotated-key';

    const rotated = await run(server);

    expect(rotated.detail).toBe('updated Sonarr server (apiKey)');
    expect(rotated.detail).not.toContain('rotated-key');
    expect(server.state.instances.sonarr[0]?.apiKey).toBe(SONARR_KEY);

    const hidden = setup({ hideInstanceKeys: true });
    await run(hidden);
    const outcome = await run(hidden);
    expect(outcome.status).toBe('unchanged');
    expect(outcome.detail).toBe(
      'the Sonarr API key stored in Seerr could not be read back, so it was not compared; ' +
        'the Radarr API key stored in Seerr could not be read back, so it was not compared',
    );
  });

  it('aborts when the master profile is missing, naming it', async () => {
    const server = setup();
    arrServers.sonarr.state.qualityProfiles = [{ id: 1, name: 'Any' }];

    const error = await failureOf(run(server));

    expect(error.message).toBe(
      'Sonarr has no quality profile named "Moody Blues"; run the master-profile step first',
    );
    expect(server.state.instances.sonarr).toEqual([]);
    expect(server.state.initialized).toBe(false);
  });

  it('aborts when the root folder is missing', async () => {
    const server = setup();
    arrServers.radarr.state.rootFolders = [];

    const error = await failureOf(run(server));

    expect(error.message).toBe(
      'Radarr has no root folder /data/media/movies; run its provisioning step first',
    );
    expect(server.state.initialized).toBe(false);
  });

  it('accepts a root folder reported with a trailing slash', async () => {
    const server = setup();
    arrServers.radarr.state.rootFolders = [{ id: 1, path: '/data/media/movies/' }];

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
  });

  it('fails with a reset hint when the key is rejected but a media server is configured', async () => {
    const server = setup({ halfInitialized: true });

    const error = await failureOf(run(server));

    expect(error.message).toContain('moody-blues reset --fresh');
    expect(server.state.logins).toBe(0);
  });

  it('reports the server message when the account is not a Jellyfin administrator', async () => {
    const server = setup({
      accounts: [{ ...ADMIN, isAdministrator: false }],
    });

    const error = await failureOf(run(server));

    expect(error.message).toContain('Seerr could not sign in to Jellyfin as the administrator');
    expect(error.message).toContain('NOT_ADMIN');
    expect(error.message).not.toContain(ADMIN.password);
  });

  it('reports rejected credentials without echoing the password', async () => {
    const server = setup({
      accounts: [{ username: 'Admin', password: 'other', isAdministrator: true }],
    });

    const error = await failureOf(run(server));

    expect(error.message).toContain('INVALID_CREDENTIALS');
    expect(error.message).not.toContain(ADMIN.password);
    expect(server.state.user).toBeUndefined();
  });

  it('suggests jellyfin-provision when Jellyfin has no libraries', async () => {
    const server = setup({ jellyfinLibraries: [] });

    const error = await failureOf(run(server));

    expect(error.message).toBe(
      'Jellyfin has no libraries for Seerr to sync; run the jellyfin-provision step first',
    );
  });

  it('keeps going and notes a failed external hostname', async () => {
    const server = setup({ failExternalHostname: true });

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toContain(
      'the Jellyfin external hostname was not set: POST http://127.0.0.1:5055/api/v1/settings/jellyfin responded 500',
    );
    expect(outcome.detail).not.toContain(FAKE_SEERR_JELLYFIN_KEY);
    expect(server.state.initialized).toBe(true);
  });

  it('keeps going and notes a failed initial scan', async () => {
    const server = setup({ failScan: true });

    const outcome = await run(server);

    expect(outcome.detail).toContain('the initial library scan was not started');
    expect(server.state.initialized).toBe(true);
    expect(server.state.instances.sonarr).toHaveLength(1);
  });

  it('aborts when the connection test from Seerr fails and creates nothing', async () => {
    const server = setup({ failTest: true });

    const error = await failureOf(run(server));

    expect(error.message).toContain('responded 500');
    expect(server.state.instances.sonarr).toEqual([]);
    expect(server.state.initialized).toBe(false);
  });

  it('calls initialize only while the instance is not initialized', async () => {
    const pending = setup();
    await run(pending);
    expect(pending.count('POST', '/api/v1/settings/initialize')).toBe(1);

    await run(pending);
    expect(pending.count('POST', '/api/v1/settings/initialize')).toBe(1);
  });

  it('waits for Seerr to answer', async () => {
    const server = setup({ readyAfterFailures: 2 });

    await run(server);

    expect(server.count('GET', '/api/v1/settings/public')).toBeGreaterThan(2);
    expect(server.state.initialized).toBe(true);
  });

  it('never exposes keys, passwords or cookies in the detail or progress', async () => {
    const server = setup({ failExternalHostname: true, failScan: true });
    const progress: string[] = [];

    const outcome = await run(server, createContext({ reportProgress: (m) => progress.push(m) }));

    const visible = [outcome.detail ?? '', ...progress].join('\n');
    for (const secret of [
      ADMIN.password,
      SONARR_KEY,
      RADARR_KEY,
      FAKE_SEERR_API_KEY,
      FAKE_SEERR_JELLYFIN_KEY,
      FAKE_SEERR_SESSION_COOKIE,
    ]) {
      expect(visible).not.toContain(secret);
    }
  });

  it('sends the API key header on every call except the public ones', async () => {
    const server = setup();

    await run(server);

    for (const request of server.requests) {
      if (request.path === '/api/v1/settings/public' || request.path === '/api/v1/auth/jellyfin') {
        expect(request.headers['x-api-key']).toBeUndefined();
      } else {
        expect(request.headers['x-api-key']).toBe(FAKE_SEERR_API_KEY);
      }
    }
  });

  it('keeps the arr API keys out of the errors of a failed run', async () => {
    const server = setup({ failTest: true });

    const error = await failureOf(run(server));

    for (const secret of [SONARR_KEY, RADARR_KEY, FAKE_SEERR_API_KEY, ADMIN.password]) {
      expect(error.message).not.toContain(secret);
    }
  });
});

describe('createSeerrProvisionStep', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-seerr-step-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('is registered for every scope under the documented id', () => {
    const step = createSeerrProvisionStep();

    expect(step.id).toBe('seerr-provision');
    expect([...step.scopes].sort()).toEqual(['config', 'reset', 'setup', 'update']);
  });

  it('fails clearly when the service keys have not been written', async () => {
    const step = createSeerrProvisionStep();
    const ctx: ProvisionContext = {
      config: createDefaultConfig({ host: identity, domain: 'example.org' }),
      secrets: { rdApiToken: 'x', adminUsername: ADMIN.username, adminPassword: ADMIN.password },
      layout: createLayout(sandbox),
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
    };

    await expect(step.run(ctx, new AbortController().signal)).rejects.toThrow(
      /Missing service keys/,
    );
  });
});

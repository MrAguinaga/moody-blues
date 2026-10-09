import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import { ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import {
  createFakeJellyfin,
  type FakeJellyfin,
  type FakeJellyfinOptions,
} from '../testing/fake-jellyfin';
import { createJellyfinClient } from './jellyfin.client';
import { provisionJellyfin } from './jellyfin.provision';
import { createJellyfinProvisionStep } from './jellyfin-provision.step';

const identity = { puid: 1000, pgid: 1000 };
const ADMIN = { username: 'Admin', password: 'p@ss word' };
const noSleep = async () => undefined;

async function failureOf(attempt: Promise<unknown>): Promise<Error> {
  try {
    await attempt;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the promise to reject');
}
const READ_ONLY_ROUTES = [
  'GET /System/Info/Public',
  'GET /Auth/Keys',
  'GET /System/Configuration',
  'GET /System/Configuration/encoding',
  'GET /Library/VirtualFolders',
];

describe('provisionJellyfin', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-jellyfin-provision-'));
    layout = createLayout(sandbox);
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

  function setup(options: FakeJellyfinOptions = {}) {
    return createFakeJellyfin({ localAddress: 'https://watch.example.org', ...options });
  }

  function run(server: FakeJellyfin, ctx: ProvisionContext = createContext()) {
    const client = createJellyfinClient({
      baseUrl: server.baseUrl,
      fetch: server.fetch,
      sleep: noSleep,
      random: () => 0.5,
    });
    return provisionJellyfin(ctx, {
      client,
      signal: new AbortController().signal,
      ready: { sleep: noSleep },
    });
  }

  const routes = (server: FakeJellyfin, from = 0) =>
    server.requests.slice(from).map((request) => `${request.method} ${request.path}`);
  const envText = () => readFileSync(layout.envFile, 'utf8');

  it('provisions a fresh instance end to end', async () => {
    const server = setup();

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toBe(
      'completed the setup wizard, created the API key, stored the API key in the environment file, ' +
        'server settings ServerName, UICulture, PreferredMetadataLanguage, MetadataCountryCode, ' +
        'encoding safeguards TranscodingTempPath, EnableSegmentDeletion, EnableThrottling, SegmentKeepSeconds, ' +
        'created library Películas, created library Series',
    );
    expect(server.state.wizardCompleted).toBe(true);
    expect(server.canLogin(ADMIN.username, ADMIN.password)).toBe(true);
    expect(server.canLogin(ADMIN.username, 'wrong')).toBe(false);
    expect(server.state.config).toMatchObject({
      ServerName: 'Moody Blues',
      UICulture: 'es-MX',
      PreferredMetadataLanguage: 'es',
      MetadataCountryCode: 'MX',
      EnableLegacyAuthorization: false,
      EnableMetrics: false,
      CorsHosts: ['*'],
      CacheSize: 800,
    });
    expect(server.state.encoding).toMatchObject({
      TranscodingTempPath: '/cache/transcodes',
      EnableSegmentDeletion: true,
      EnableThrottling: true,
      SegmentKeepSeconds: 300,
      HardwareAccelerationType: 'none',
    });
    expect(
      server.state.libraries.map(({ Name, Locations, CollectionType }) => [
        Name,
        Locations,
        CollectionType,
      ]),
    ).toEqual([
      ['Películas', ['/data/media/movies'], 'movies'],
      ['Series', ['/data/media/tv'], 'tvshows'],
    ]);
    expect(envText()).toBe(`JELLYFIN_API_KEY=${server.state.apiKeys[0]?.AccessToken}\n`);
  });

  it('is idempotent: the second run reads everything and writes nothing', async () => {
    const server = setup();
    await run(server);
    const envBefore = envText();
    const seen = server.requests.length;

    const outcome = await run(server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.requests.slice(seen).filter((request) => request.method !== 'GET')).toEqual([]);
    expect(new Set(routes(server, seen))).toEqual(new Set(READ_ONLY_ROUTES));
    expect(envText()).toBe(envBefore);
    expect(server.state.libraries).toHaveLength(2);
    expect(server.state.apiKeys).toHaveLength(1);
  });

  it('never duplicates a library across runs', async () => {
    const server = setup();

    await run(server);
    await run(server);
    await run(server);

    expect(server.state.libraries.map((library) => library.Name)).toEqual(['Películas', 'Series']);
  });

  it('does not call the startup endpoints once the wizard is complete', async () => {
    const server = setup({ wizardCompleted: true });

    await run(server);

    expect(routes(server).filter((route) => route.includes('/Startup/'))).toEqual([]);
  });

  it('forwards the other server settings untouched', async () => {
    const server = setup({ wizardCompleted: true, config: { CorsHosts: ['https://a.example'] } });

    await run(server);

    expect(server.state.config.CorsHosts).toEqual(['https://a.example']);
    expect(server.state.config.IsStartupWizardCompleted).toBe(true);
  });

  it('rejects an invalid administrator name before sending anything', async () => {
    const server = setup();
    const ctx = createContext({
      secrets: { rdApiToken: 'rd', adminUsername: 'bad/name', adminPassword: 'secret-pass' },
    });

    await expect(run(server, ctx)).rejects.toThrow(
      /ADMIN_USERNAME is not a valid Jellyfin user name/,
    );
    expect(server.requests).toEqual([]);
  });

  it('accepts names with spaces, accents and the allowed punctuation', async () => {
    const server = setup();
    const ctx = createContext({
      secrets: { rdApiToken: 'rd', adminUsername: "María O'Neil-1.2_@+", adminPassword: 'secret' },
    });

    await run(server, ctx);

    expect(server.canLogin("María O'Neil-1.2_@+", 'secret')).toBe(true);
  });

  it('recovers a wizard interrupted after the user was created', async () => {
    const server = setup({ halfFinishedWizard: true });

    const outcome = await run(server);

    expect(outcome.detail).toMatch(/^completed the setup wizard/);
    expect(server.state.wizardCompleted).toBe(true);
    expect(server.count('POST', '/Startup/Complete')).toBe(1);
    expect(server.state.users).toHaveLength(1);
  });

  it('aborts an interrupted wizard whose user has other credentials', async () => {
    const server = setup({ halfFinishedWizard: true, adminPassword: 'another password' });

    await expect(run(server)).rejects.toThrow(
      /left half-finished with other credentials.*reset --fresh/,
    );
    expect(server.state.wizardCompleted).toBe(false);
    expect(server.count('POST', '/Startup/Complete')).toBe(0);
  });

  it('aborts with the reset hint when an initialized server rejects the credentials', async () => {
    const server = setup({ wizardCompleted: true, adminPassword: 'another password' });

    await expect(run(server)).rejects.toThrow(
      /rejected the administrator credentials.*reset --fresh/,
    );
    expect(server.writes().map((request) => request.path)).toEqual(['/Users/AuthenticateByName']);
  });

  it('regenerates a stale stored key', async () => {
    const server = setup({ wizardCompleted: true });
    writeFileSync(layout.envFile, 'JELLYFIN_API_KEY=stale-key\n');

    const outcome = await run(server);

    expect(outcome.detail).toMatch(/created the API key, stored the API key/);
    expect(envText()).not.toContain('stale-key');
  });

  describe('credential rotation', () => {
    const rotating = () => createContext({ flags: new Map([[ROTATE_CREDENTIALS_FLAG, true]]) });

    it('sets the password once when the flag is on', async () => {
      const server = setup({ wizardCompleted: true });
      await run(server);
      const ctx = rotating();
      ctx.secrets = { ...ctx.secrets, adminPassword: 'rotated secret' };

      const outcome = await run(server, ctx);

      expect(server.count('POST', '/Users/Password')).toBe(1);
      expect(outcome.detail).toBe('rotated the administrator password');
      expect(server.canLogin(ADMIN.username, 'rotated secret')).toBe(true);
    });

    it('never touches the password without the flag', async () => {
      const server = setup({ wizardCompleted: true });

      await run(server);
      await run(server);

      expect(server.count('POST', '/Users/Password')).toBe(0);
    });

    it('does not rotate on the run that created the administrator', async () => {
      const server = setup();

      await run(server, rotating());

      expect(server.count('POST', '/Users/Password')).toBe(0);
    });

    it('fails with the reset hint when the administrator name changed', async () => {
      const server = setup({ wizardCompleted: true, adminName: 'OldAdmin' });
      writeFileSync(layout.envFile, 'JELLYFIN_API_KEY=old-key\n');
      server.state.apiKeys.push({ AccessToken: 'old-key', AppName: 'moody-blues' });

      await expect(run(server, rotating())).rejects.toThrow(
        /no administrator with the configured ADMIN_USERNAME.*reset --fresh/,
      );
      expect(server.count('POST', '/Users/Password')).toBe(0);
    });
  });

  describe('libraries', () => {
    it('corrects drifted options with a single update and keeps the rest', async () => {
      const server = setup();
      await run(server);
      const movies = server.state.libraries[0]!;
      movies.LibraryOptions.EnableTrickplayImageExtraction = true;
      movies.LibraryOptions.SubtitleDownloadLanguages = ['eng'];
      const seen = server.requests.length;

      const outcome = await run(server);

      expect(outcome).toEqual({
        status: 'changed',
        detail: 'updated library Películas (EnableTrickplayImageExtraction)',
      });
      expect(
        server.requests
          .slice(seen)
          .filter((request) => request.method === 'POST')
          .map((r) => r.path),
      ).toEqual(['/Library/VirtualFolders/LibraryOptions']);
      expect(movies.LibraryOptions.EnableTrickplayImageExtraction).toBe(false);
      expect(movies.LibraryOptions.SubtitleDownloadLanguages).toEqual(['eng']);
    });

    it('notes a library that lacks the expected path without failing', async () => {
      const server = setup();
      await run(server);
      server.state.libraries[1]!.Locations = ['/elsewhere'];

      const outcome = await run(server);

      expect(outcome.status).toBe('unchanged');
      expect(outcome.detail).toBe(
        'library "Series" does not include /data/media/tv (found /elsewhere)',
      );
    });

    it('aborts when a library path does not exist in the container', async () => {
      const server = setup({ existingPaths: ['/data/media/movies'] });

      await expect(run(server)).rejects.toThrow(/rejected the library "Series".*\/data\/media\/tv/);
    });

    it('matches an existing library by its trimmed name', async () => {
      const server = setup();
      await run(server);
      server.state.libraries[0]!.Name = ' Películas ';

      await run(server);

      expect(server.state.libraries).toHaveLength(2);
    });
  });

  describe('published url', () => {
    it('notes an unexpected address without failing', async () => {
      const server = setup({ localAddress: 'http://jellyfin:8096' });

      const outcome = await run(server);

      expect(outcome.status).toBe('changed');
      expect(outcome.detail).toMatch(
        /published URL is http:\/\/jellyfin:8096, expected https:\/\/watch\.example\.org$/,
      );
    });

    it('accepts an address that starts with the expected one', async () => {
      const server = setup({ localAddress: 'https://watch.example.org/jellyfin' });

      const outcome = await run(server);

      expect(outcome.detail).not.toMatch(/published URL/);
    });
  });

  it('derives the metadata country only when the interface language has a region', async () => {
    const server = setup({ wizardCompleted: true });
    const config = createDefaultConfig({ host: identity, domain: 'example.org' });

    await run(
      server,
      createContext({ config: { ...config, languages: { ...config.languages, ui: 'es' } } }),
    );

    expect(server.state.config).toMatchObject({ UICulture: 'es', PreferredMetadataLanguage: 'es' });
    expect(server.state.config.MetadataCountryCode).toBe('US');
    expect(server.state.libraries[0]?.LibraryOptions).not.toHaveProperty('MetadataCountryCode');
  });

  it('waits through the startup window', async () => {
    const server = setup({ readyAfterFailures: 3 });

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
  });

  it('does not read the wizard state from the bootstrap host answer', async () => {
    const server = setup({ wizardCompleted: true, bootstrapResponses: 2 });

    const outcome = await run(server);

    expect(outcome.detail).not.toMatch(/setup wizard/);
    expect(routes(server).filter((route) => route.includes('/Startup/'))).toEqual([]);
  });

  describe('secrets', () => {
    it('keeps the password, the key and the tokens out of the outcome and the progress', async () => {
      const server = setup();
      const progress: string[] = [];
      const ctx = createContext({ reportProgress: (message) => progress.push(message) });

      const outcome = await run(server, ctx);

      const key = server.state.apiKeys[0]?.AccessToken as string;
      const visible = [outcome.detail ?? '', ...progress].join('\n');
      for (const secret of [key, ADMIN.password, ADMIN.username, 'fake-session']) {
        expect(visible).not.toContain(secret);
      }
    });

    it('keeps them out of the error messages too', async () => {
      const server = setup({ wizardCompleted: true, existingPaths: [] });
      const ctx = createContext();

      const failure = await failureOf(run(server, ctx));

      const key = server.state.apiKeys[0]?.AccessToken as string;
      expect(failure.message).toMatch(/rejected the library/);
      for (const secret of [key, ADMIN.password, 'fake-session']) {
        expect(failure.message).not.toContain(secret);
      }
    });

    it('keeps them out of an authentication failure', async () => {
      const server = setup({ wizardCompleted: true, adminPassword: 'other-secret' });

      const failure = await failureOf(run(server));

      expect(failure.message).not.toContain(ADMIN.password);
      expect(failure.message).not.toContain('other-secret');
    });
  });
});

describe('createJellyfinProvisionStep', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-jellyfin-step-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('runs the real step against the host port of the catalog', async () => {
    const server = createFakeJellyfin({ localAddress: 'https://watch.example.org' });
    const step = createJellyfinProvisionStep({
      fetch: server.fetch,
      sleep: noSleep,
      random: () => 0.5,
      ready: { sleep: noSleep },
    });
    const ctx: ProvisionContext = {
      config: createDefaultConfig({ host: identity, domain: 'example.org' }),
      secrets: { rdApiToken: 'rd', adminUsername: ADMIN.username, adminPassword: ADMIN.password },
      layout: createLayout(sandbox),
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
    };

    const first = await step.run(ctx, new AbortController().signal);
    const writesAfterFirst = server.writes().length;
    const second = await step.run(ctx, new AbortController().signal);

    expect(step.id).toBe('jellyfin-provision');
    expect(step.scopes).toEqual(['setup', 'reset', 'config', 'update']);
    expect(first.status).toBe('changed');
    expect(second).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(writesAfterFirst);
    expect(new URL(server.requests[0]?.url ?? '').origin).toBe('http://127.0.0.1:8096');
  });
});

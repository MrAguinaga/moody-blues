import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import { runPipeline } from '../pipeline/pipeline.runner';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { createFakeBazarr, type FakeBazarr, type FakeBazarrOptions } from '../testing/fake-bazarr';
import { createBazarrClient } from './bazarr.client';
import { buildLanguageProfile } from './bazarr.languages';
import { provisionBazarr, type ProvisionBazarrOptions } from './bazarr.provision';
import { BASE_PROVIDERS } from './bazarr.settings';
import { createBazarrProvisionStep } from './bazarr-provision.step';

const identity = { puid: 1000, pgid: 1000 };
const secrets = { rdApiToken: 'rd-token', adminUsername: 'Admin', adminPassword: 'p@ss word' };
const openSubtitles = { opensubtitlesUsername: 'os-user', opensubtitlesPassword: 'os-secret' };
const API_KEY = 'bazarr-key';
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
  server: FakeBazarr,
  ctx: ProvisionContext = createContext(),
  overrides: Partial<ProvisionBazarrOptions> = {},
) {
  const client = createBazarrClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    fetch: server.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return provisionBazarr(ctx, {
    client,
    serviceKeys: { sonarr: 'sonarr-key', radarr: 'radarr-key' },
    signal: new AbortController().signal,
    ready: { sleep: noSleep },
    link: { sleep: noSleep },
    tasks: { sleep: noSleep },
    ...overrides,
  });
}

function withSubtitles(subtitles: string[], extra: Partial<ProvisionContext> = {}) {
  const config = createDefaultConfig({ host: identity });
  return createContext({
    config: { ...config, languages: { ...config.languages, subtitles } },
    ...extra,
  });
}

function setup(options: Partial<FakeBazarrOptions> = {}) {
  return createFakeBazarr({ apiKey: API_KEY, ...options });
}

function providers(server: FakeBazarr): unknown {
  return server.state.settings.general?.enabled_providers;
}

describe('provisionBazarr', () => {
  let server: FakeBazarr;

  beforeEach(() => {
    server = setup();
  });

  it('provisions a fresh instance in a single settings request', async () => {
    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toBe(
      'enabled languages ea, es, language profile Spanish Latino, subtitle synchronization; ' +
        'no OpenSubtitles credentials: movie subtitles rely on the keyless providers',
    );
    expect(
      server.writes().filter((request) => request.path === '/api/system/settings'),
    ).toHaveLength(1);
    expect(
      server.state.languages
        .filter((l) => l.enabled)
        .map((l) => l.code2)
        .sort(),
    ).toEqual(['ea', 'es']);
    expect(server.state.profiles).toHaveLength(1);
    expect(server.state.profiles[0]).toMatchObject({ profileId: 1, name: 'Spanish Latino' });
    expect(server.state.settings.general).toMatchObject({
      serie_default_profile: 1,
      movie_default_profile: 1,
    });
  });

  it('turns synchronization on for every subtitle and lowers only the series score', async () => {
    await run(server);

    expect(server.state.settings.subsync).toMatchObject({
      use_subsync: true,
      use_subsync_threshold: false,
      use_subsync_movie_threshold: false,
      subsync_threshold: 90,
    });
    expect(server.state.settings.general).toMatchObject({
      minimum_score: 80,
      minimum_score_movie: 70,
    });
  });

  it('corrects synchronization drift alone and then stays quiet', async () => {
    await run(server);
    server.state.settings.subsync = { ...server.state.settings.subsync, use_subsync: false };
    server.state.settings.general = { ...server.state.settings.general, minimum_score: 90 };
    const writes = server.writes().length;

    const outcome = await run(server);

    expect(outcome).toMatchObject({ status: 'changed' });
    expect(outcome.detail).toContain('subtitle synchronization');
    expect(server.writes()).toHaveLength(writes + 1);
    expect((await run(server)).status).toBe('unchanged');
  });

  it('sends the profile items as python-style strings in a url-encoded form', async () => {
    await run(server);

    const [request] = server.writes();
    const form = new URLSearchParams(request?.body as string);
    expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(form.getAll('languages-enabled')).toEqual(['ea', 'es']);
    const profiles = JSON.parse(form.get('languages-profiles') as string) as {
      items: Record<string, unknown>[];
    }[];
    expect(profiles[0]?.items[0]).toMatchObject({ audio_exclude: 'False', hi: 'False' });
  });

  it('is idempotent: the second run emits no writes', async () => {
    await run(server);
    const writes = server.writes().length;

    const outcome = await run(server);

    expect(outcome.status).toBe('unchanged');
    expect(server.writes()).toHaveLength(writes);
  });

  it('does not touch the connection settings when nothing drifted', async () => {
    await run(server);

    expect(server.state.signalrRestarts).toBe(0);
  });

  it('repairs connection drift and restarts the link only for that service', async () => {
    server = setup({ seed: { sonarrApiKey: 'stale-key' } });

    const outcome = await run(server);

    expect(outcome.detail).toContain('Sonarr connection');
    expect(outcome.detail).not.toContain('Radarr connection');
    expect(server.state.settings.sonarr?.apikey).toBe('sonarr-key');
    expect(server.state.signalrRestarts).toBe(1);
  });

  it('never puts credentials in the detail', async () => {
    server = setup({ seed: { adminPassword: 'other' } });

    const outcome = await run(server, createContext({ secrets: { ...secrets, ...openSubtitles } }));

    for (const secret of ['p@ss word', 'os-secret', 'sonarr-key', 'radarr-key']) {
      expect(outcome.detail).not.toContain(secret);
    }
  });

  describe('subtitle providers', () => {
    it('enables opensubtitlescom only with credentials', async () => {
      await run(server, createContext({ secrets: { ...secrets, ...openSubtitles } }));

      expect(providers(server)).toEqual([...BASE_PROVIDERS, 'opensubtitlescom']);
      expect(server.state.settings.opensubtitlescom).toMatchObject({
        username: 'os-user',
        password: 'os-secret',
      });
    });

    it('enables the keyless providers that returned Spanish and not subf2m', async () => {
      await run(server);

      expect(providers(server)).toEqual(
        expect.arrayContaining([
          'gestdown',
          'yifysubtitles',
          'bsplayer',
          'subtitulamostv',
          'tvsubtitles',
          'subtitlecat',
        ]),
      );
      expect(providers(server)).not.toContain('subf2m');
    });

    it('keeps opensubtitlescom out without credentials', async () => {
      await run(server);

      expect(providers(server)).toEqual(BASE_PROVIDERS);
    });

    it('removes opensubtitlescom when the credentials are withdrawn', async () => {
      server = setup({
        seed: { opensubtitles: { username: 'os-user', password: 'os-secret' } },
      });
      expect(providers(server)).toEqual([...BASE_PROVIDERS, 'opensubtitlescom']);

      const outcome = await run(server);

      expect(outcome.detail).toContain('subtitle providers');
      expect(providers(server)).toEqual(BASE_PROVIDERS);
    });

    it('never enables the discontinued providers and keeps foreign ones', async () => {
      await run(server, createContext({ secrets: { ...secrets, ...openSubtitles } }));
      server.state.settings.general = {
        ...server.state.settings.general,
        enabled_providers: ['subdivx', 'podnapisi', 'gestdown', 'opensubtitlescom'],
      };

      await run(server, createContext({ secrets: { ...secrets, ...openSubtitles } }));

      expect(providers(server)).toEqual([
        'subdivx',
        'podnapisi',
        ...BASE_PROVIDERS,
        'opensubtitlescom',
      ]);
      server.state.settings.general = {
        ...server.state.settings.general,
        enabled_providers: [],
      };
      await run(server);
      expect(providers(server)).toEqual(BASE_PROVIDERS);
    });

    it('updates changed OpenSubtitles credentials and stays quiet afterwards', async () => {
      const ctx = createContext({ secrets: { ...secrets, ...openSubtitles } });
      await run(server, ctx);
      const rotated = createContext({
        secrets: { ...secrets, ...openSubtitles, opensubtitlesPassword: 'os-new' },
      });

      const outcome = await run(server, rotated);
      const writes = server.writes().length;
      await run(server, rotated);

      expect(outcome.detail).toContain('OpenSubtitles credentials');
      expect(server.state.settings.opensubtitlescom?.password).toBe('os-new');
      expect(server.writes()).toHaveLength(writes);
    });
  });

  describe('administrator account', () => {
    it('resends the plain password only when it differs from the stored hash', async () => {
      server = setup({ seed: { adminPassword: 'old-password' } });

      const outcome = await run(server);
      const writes = server.writes().length;
      await run(server);

      expect(outcome.detail).toContain('administrator account');
      expect(server.canLogin('Admin', 'p@ss word')).toBe(true);
      expect(server.canLogin('Admin', 'old-password')).toBe(false);
      expect(server.writes()).toHaveLength(writes);
    });

    it('follows a changed username', async () => {
      server = setup({ seed: { adminUsername: 'Previous' } });

      await run(server);

      expect(server.canLogin('Admin', 'p@ss word')).toBe(true);
    });
  });

  describe('language profile', () => {
    it('keeps the profiles it does not own', async () => {
      const foreign = { ...buildLanguageProfile(['en']), profileId: 2, name: 'Mine' };
      server = setup({ profiles: [foreign], enabledLanguages: ['en'] });

      await run(server);

      expect(server.state.profiles.map((profile) => profile.name)).toEqual([
        'Spanish Latino',
        'Mine',
      ]);
      expect(
        server.state.languages
          .filter((l) => l.enabled)
          .map((l) => l.code2)
          .sort(),
      ).toEqual(['ea', 'en', 'es']);
    });

    it('rewrites a profile whose content drifted', async () => {
      const drifted = { ...buildLanguageProfile(['es-419']), cutoff: 5, name: 'Spanish Latino' };
      server = setup({ profiles: [drifted], enabledLanguages: ['ea'] });

      const outcome = await run(server);

      expect(outcome.status).toBe('changed');
      expect(server.state.profiles[0]?.cutoff).toBe(1);
    });

    it('asks for Latin American Spanish first and generic Spanish as the fallback', async () => {
      await run(server);

      const profile = server.state.profiles[0];
      expect(profile?.items.map((item) => item.language)).toEqual(['ea', 'es']);
      expect(profile?.cutoff).toBe(1);
    });

    it('builds one item per configured language', async () => {
      await run(server, withSubtitles(['es-419', 'en']));

      expect(server.state.profiles[0]?.items.map((item) => item.language)).toEqual(['ea', 'en']);
    });

    it('rejects an unsupported language before writing anything', async () => {
      await expect(run(server, withSubtitles(['pt-BR']))).rejects.toThrow(/"pt-BR"/);
      expect(server.writes()).toHaveLength(0);
    });

    it('fails when Bazarr does not offer the language', async () => {
      server.state.languages = server.state.languages.filter((language) => language.code2 !== 'ea');

      await expect(run(server)).rejects.toThrow('Bazarr does not offer the subtitle languages ea');
    });
  });

  describe('library assignment', () => {
    it('assigns the profile only to the items without one', async () => {
      server = setup({
        series: [
          { id: 1, title: 'Unassigned', profileId: null },
          { id: 2, title: 'Assigned', profileId: 3 },
        ],
        movies: [{ id: 7, title: 'Movie', profileId: null }],
        profiles: [{ ...buildLanguageProfile(['en']), profileId: 3, name: 'Other' }],
      });

      const outcome = await run(server);

      expect(outcome.detail).toContain(
        'assigned the profile to 1 series, assigned the profile to 1 movie',
      );
      expect(server.state.series.map((item) => item.profileId)).toEqual([1, 3]);
      expect(server.state.movies.map((item) => item.profileId)).toEqual([1]);
    });

    it('returns to unchanged without writes once everything is assigned', async () => {
      server = setup({
        series: [{ id: 1, title: 'Unassigned', profileId: null }],
        movies: [{ id: 7, title: 'Movie', profileId: null }],
      });
      await run(server);
      const writes = server.writes().length;

      const outcome = await run(server);

      expect(outcome.status).toBe('unchanged');
      expect(server.writes()).toHaveLength(writes);
    });

    it('synchronizes the libraries after changing the profile and assigns what appears', async () => {
      server = setup({
        pendingSeries: [{ id: 5, title: 'Late series', profileId: null }],
        pendingMovies: [{ id: 6, title: 'Late movie', profileId: null }],
        taskPolls: 2,
      });

      const outcome = await run(server);

      expect(server.state.tasksRun).toEqual(['update_series', 'update_movies']);
      expect(outcome.detail).toContain('assigned the profile to 1 series');
      expect(server.state.series[0]?.profileId).toBe(1);
      expect(server.state.movies[0]?.profileId).toBe(1);
    });

    it('does not run the sync tasks when the profile and defaults are in place', async () => {
      await run(server);
      server.state.tasksRun.length = 0;

      await run(server);

      expect(server.state.tasksRun).toEqual([]);
    });

    it('fails when a sync task never finishes', async () => {
      server = setup({ stuckTasks: ['update_series'] });
      let clock = 0;

      await expect(
        run(server, createContext(), {
          tasks: {
            timeoutMs: 3_000,
            now: () => clock,
            sleep: async (ms) => {
              clock += ms;
            },
          },
        }),
      ).rejects.toThrow('Bazarr task "update_series" was still running after 3 s');
    });
  });

  describe('links', () => {
    it('waits until Bazarr reaches Sonarr and Radarr', async () => {
      server = setup({ linkDelayCalls: 3 });

      await run(server);

      expect(server.count('GET', '/api/system/status')).toBe(4);
    });

    it('fails naming the service Bazarr cannot reach', async () => {
      server = setup({ unreachable: ['radarr'] });
      let clock = 0;

      await expect(
        run(server, createContext(), {
          link: {
            timeoutMs: 6_000,
            intervalMs: 2_000,
            now: () => clock,
            sleep: async (ms) => {
              clock += ms;
            },
          },
        }),
      ).rejects.toThrow('Bazarr could not reach Radarr after 6 s');
    });
  });

  it('waits for Bazarr to answer', async () => {
    server = setup({ pingFailures: 2 });

    await run(server);

    expect(server.count('GET', '/api/system/ping')).toBe(3);
  });
});

describe('bazarr-provision step', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-bazarr-'));
    layout = createLayout(join(sandbox, 'home'));
    mkdirSync(layout.root, { recursive: true });
    writeFileSync(
      layout.envFile,
      [
        'SONARR_API_KEY=sonarr-key',
        'RADARR_API_KEY=radarr-key',
        'PROWLARR_API_KEY=prowlarr-key',
        `BAZARR_API_KEY=${API_KEY}`,
        'DECYPHARR_API_TOKEN=decypharr-token',
        'SEERR_API_KEY=seerr-key',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('runs in every scope that starts services', () => {
    const step = createBazarrProvisionStep();

    expect(step.id).toBe('bazarr-provision');
    expect(step.scopes).toEqual(['setup', 'reset', 'config', 'update']);
  });

  it('provisions through the host url with the seeded keys and stays quiet the second time', async () => {
    const server = setup();
    const step = createBazarrProvisionStep({ fetch: server.fetch, sleep: noSleep });
    const ctx = createContext({ layout });

    const first = await runPipeline([step], ctx, { scope: 'setup' });
    const writes = server.writes().length;
    const second = await runPipeline([step], ctx, { scope: 'setup' });

    expect(first.steps[0]).toMatchObject({ id: 'bazarr-provision', status: 'changed' });
    expect(second.steps[0]).toMatchObject({ id: 'bazarr-provision', status: 'unchanged' });
    expect(server.writes()).toHaveLength(writes);
    expect(
      server.requests.every((request) => request.url.startsWith('http://127.0.0.1:6767')),
    ).toBe(true);
    expect(server.state.signalrRestarts).toBe(0);
  });

  it('fails the pipeline when the environment file lacks the service keys', async () => {
    writeFileSync(layout.envFile, 'BAZARR_API_KEY=bazarr-key\n');
    const step = createBazarrProvisionStep({ sleep: noSleep });

    const report = await runPipeline([step], createContext({ layout }), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Missing service keys');
  });

  it('fails with a readiness error when Bazarr never answers', async () => {
    const server = setup({ pingFailures: 99 });
    let elapsed = 0;
    const step = createBazarrProvisionStep({
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
    expect(report.error).toContain('Bazarr was not ready');
  });
});

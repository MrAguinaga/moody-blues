import { describe, expect, it } from 'vitest';

import { createFakeBazarr, type FakeBazarrOptions } from '../testing/fake-bazarr';
import { createFakeFetch } from '../testing/fake-fetch';
import { type BazarrClientOptions, createBazarrClient } from './bazarr.client';
import { enabledLanguagesEntry, languageProfilesEntry, settingsEntry } from './bazarr.form';
import { buildLanguageProfile } from './bazarr.languages';

const API_KEY = 'bazarr-key';
const noSleep = async () => undefined;

function setup(
  options: Partial<FakeBazarrOptions> = {},
  clientOptions: Partial<BazarrClientOptions> = {},
) {
  const fake = createFakeBazarr({ apiKey: API_KEY, ...options });
  const client = createBazarrClient({
    baseUrl: fake.baseUrl,
    apiKey: API_KEY,
    fetch: fake.fetch,
    sleep: noSleep,
    random: () => 0.5,
    ...clientOptions,
  });
  return { fake, client };
}

describe('createBazarrClient', () => {
  it('authenticates every request with the X-API-KEY header', async () => {
    const { fake, client } = setup();

    await client.getStatus();
    await client.listLanguages();
    await client.listProfiles();

    expect(fake.requests.map((request) => request.headers['x-api-key'])).toEqual([
      API_KEY,
      API_KEY,
      API_KEY,
    ]);
  });

  it('waits for the ping before verifying the key', async () => {
    const { fake, client } = setup({ pingFailures: 2 });

    await client.waitReady({ sleep: noSleep });

    expect(fake.count('GET', '/api/system/ping')).toBe(3);
    expect(fake.count('GET', '/api/system/status')).toBe(1);
  });

  it('rejects a wrong api key', async () => {
    const { client } = setup({}, { apiKey: 'wrong-key' });

    await expect(client.waitReady({ sleep: noSleep, timeoutMs: 1 })).rejects.toThrow();
  });

  it('reads the linked versions from the status envelope', async () => {
    const { client } = setup();

    await expect(client.getStatus()).resolves.toMatchObject({
      sonarr_version: '4.0.20.3014',
      radarr_version: '6.4.4.10685',
    });
  });
});

describe('saveSettings', () => {
  it('posts a url-encoded form and accepts the empty 204 response', async () => {
    const { fake, client } = setup();

    await expect(
      client.saveSettings([
        enabledLanguagesEntry(['ea']),
        languageProfilesEntry([buildLanguageProfile(['es-419'])]),
        settingsEntry('general', 'serie_default_profile', 1),
      ]),
    ).resolves.toBeUndefined();

    const [request] = fake.writes();
    expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(fake.state.profiles.map((profile) => profile.name)).toEqual(['Spanish Latino']);
    expect(fake.state.languages.filter((language) => language.enabled).map((l) => l.code2)).toEqual(
      ['ea'],
    );
    expect(fake.state.settings.general?.serie_default_profile).toBe(1);
  });

  it('reports a 406 rejection without echoing secret values', async () => {
    const { client } = setup();

    const error = await client
      .saveSettings([settingsEntry('sonarr', 'apikey', '1234567890')])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Bazarr rejected the settings');
    expect((error as Error).message).toContain('sonarr.apikey');
    expect((error as Error).message).not.toContain('1234567890');
  });

  it('unwraps a plain text rejection', async () => {
    const fake = createFakeFetch();
    fake.on('POST', '/api/system/settings', { status: 406, text: 'general.port is not valid' });
    const client = createBazarrClient({
      baseUrl: 'http://127.0.0.1:6767',
      apiKey: API_KEY,
      fetch: fake.fetch,
    });

    await expect(client.saveSettings([settingsEntry('general', 'port', 1)])).rejects.toThrow(
      'Bazarr rejected the settings: general.port is not valid',
    );
  });

  it('lets other failures through as http errors', async () => {
    const fake = createFakeFetch();
    fake.on('POST', '/api/system/settings', { status: 500, text: 'boom' });
    const client = createBazarrClient({
      baseUrl: 'http://127.0.0.1:6767',
      apiKey: API_KEY,
      fetch: fake.fetch,
      retry: { attempts: 1 },
    });

    await expect(client.saveSettings([])).rejects.toMatchObject({ status: 500 });
  });
});

describe('tasks', () => {
  it('runs a task with a form and polls until job_running is false', async () => {
    const { fake, client } = setup({ taskPolls: 2 });

    await client.runTask('update_series');
    await client.waitTask('update_series', { sleep: noSleep });

    expect(fake.state.tasksRun).toEqual(['update_series']);
    expect(fake.writes()[0]?.body).toBe('taskid=update_series');
    expect(fake.count('GET', '/api/system/tasks')).toBe(3);
  });

  it('fails when the task never finishes', async () => {
    const { client } = setup({ stuckTasks: ['update_movies'] });
    let clock = 0;

    await expect(
      client.waitTask('update_movies', {
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        timeoutMs: 5_000,
        intervalMs: 1_000,
      }),
    ).rejects.toThrow('Bazarr task "update_movies" was still running after 5 s');
  });

  it('fails when Bazarr does not know the task', async () => {
    const { client } = setup();

    await expect(client.waitTask('missing', { sleep: noSleep })).rejects.toThrow(
      'Bazarr has no task "missing"',
    );
  });

  it('rejects running an unknown task', async () => {
    const { client } = setup();

    await expect(client.runTask('missing')).rejects.toMatchObject({ status: 500 });
  });
});

describe('libraries', () => {
  it('lists series and movies with their profile', async () => {
    const { client } = setup({
      series: [{ id: 3, title: 'Series', profileId: null }],
      movies: [{ id: 9, title: 'Movie', profileId: 1 }],
    });

    await expect(client.listSeries()).resolves.toEqual([
      { sonarrSeriesId: 3, title: 'Series', profileId: null },
    ]);
    await expect(client.listMovies()).resolves.toEqual([
      { radarrId: 9, title: 'Movie', profileId: 1 },
    ]);
  });

  it('assigns profiles with paired repeated fields', async () => {
    const { fake, client } = setup({
      profiles: [buildLanguageProfile(['es-419'])],
      series: [
        { id: 3, title: 'A', profileId: null },
        { id: 4, title: 'B', profileId: null },
      ],
      movies: [{ id: 9, title: 'M', profileId: null }],
    });

    await client.assignSeriesProfile([
      { id: 3, profileId: 1 },
      { id: 4, profileId: 1 },
    ]);
    await client.assignMovieProfile([{ id: 9, profileId: 1 }]);

    expect(fake.writes().map((request) => request.body)).toEqual([
      'seriesid=3&profileid=1&seriesid=4&profileid=1',
      'radarrid=9&profileid=1',
    ]);
    expect(fake.state.series.map((item) => item.profileId)).toEqual([1, 1]);
    expect(fake.state.movies[0]?.profileId).toBe(1);
  });

  it('rejects a profile Bazarr does not have', async () => {
    const { client } = setup({ series: [{ id: 3, title: 'A', profileId: null }] });

    await expect(client.assignSeriesProfile([{ id: 3, profileId: 1 }])).rejects.toMatchObject({
      status: 500,
    });
  });

  it('lists the subtitle providers with their state and retry', async () => {
    const { fake, client } = setup({
      providers: [
        { name: 'gestdown', status: 'Good', retry: '-' },
        { name: 'opensubtitlescom', status: 'AuthenticationError', retry: 'in 6 hours' },
      ],
    });

    expect(await client.listProviders()).toEqual([
      { name: 'gestdown', status: 'Good', retry: '-' },
      { name: 'opensubtitlescom', status: 'AuthenticationError', retry: 'in 6 hours' },
    ]);
    expect(fake.writes()).toEqual([]);
  });
});

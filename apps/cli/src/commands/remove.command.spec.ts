import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BIG_BUCK_BUNNY,
  CLASSIC_SERIES,
  createRemoveDoubles,
  grabbed,
  NIGHT_HASH,
  NIGHT_OF_THE_LIVING_DEAD,
  OTHER_HASH,
  type RemoveDoublesOptions,
} from '../remove/remove.testing';
import { createRemoveCommand, executeRemove, parseExternalId } from './remove.command';

vi.mock('../utils/command.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/command.utils')>()),
  abortOnInterrupt: () => new AbortController(),
}));

describe('remove command', () => {
  let output: string[];
  let errors: string[];

  beforeEach(() => {
    output = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      output.push(message);
    });
    vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  const doubles = (options: RemoveDoublesOptions = {}) =>
    createRemoveDoubles({
      movies: [NIGHT_OF_THE_LIVING_DEAD, BIG_BUCK_BUNNY],
      series: [CLASSIC_SERIES],
      movieHistory: [
        grabbed(
          'movieId',
          1,
          NIGHT_HASH.toUpperCase(),
          'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GROUP',
        ),
      ],
      torrents: [NIGHT_HASH, OTHER_HASH],
      media: [{ id: 40, mediaType: 'movie', tmdbId: 10331, tvdbId: null }],
      ...options,
    });

  const settings = (
    fake: ReturnType<typeof doubles>,
    patch: Partial<Parameters<typeof executeRemove>[0]> = {},
  ): Parameters<typeof executeRemove>[0] => ({
    keepDebrid: false,
    yes: false,
    mode: 'headless',
    version: '0.1.0',
    clients: fake.clients,
    ...patch,
  });

  it('declares the documented arguments and options', () => {
    const command = createRemoveCommand('0.0.0');

    expect(command.registeredArguments.map((argument) => argument.name())).toEqual(['query']);
    expect(command.registeredArguments[0]?.required).toBe(false);
    expect(command.options.map((option) => option.long)).toEqual([
      '--movie',
      '--series',
      '--keep-debrid',
      '--home',
    ]);
  });

  it.each(['1', '10331', ' 7 '])('accepts the id %j', (value) => {
    expect(parseExternalId(value)).toBe(Number(value.trim()));
  });

  it.each(['0', '-1', '1.5', 'abc', '', '1e3'])('rejects the id %j', (value) => {
    expect(() => parseExternalId(value)).toThrow(/positive whole number/);
  });

  it.each([
    ['no selector', {}],
    ['a query and a movie', { query: 'night', movie: 10331 }],
    ['a movie and a series', { movie: 10331, series: 72440 }],
    ['a blank query', { query: '   ' }],
  ])('fails with %s before reading anything', async (_label, patch) => {
    const fake = doubles();

    await executeRemove(settings(fake, patch));

    expect(errors[0]).toMatch(
      /Provide exactly one of <query>, --movie <tmdbId> or --series <tvdbId>\./,
    );
    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it('fails with code 1 when nothing matches', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { query: 'zzz', yes: true }));

    expect(errors).toEqual(['✖ No title in Radarr or Sonarr matches "zzz".']);
    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it('fails with code 1 for an unknown id', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { series: 999, yes: true }));

    expect(errors).toEqual(['✖ No series with tvdbId 999 in Sonarr.']);
    expect(process.exitCode).toBe(1);
  });

  it('lists the candidates and deletes nothing when several match in headless mode', async () => {
    const fake = doubles({
      movies: [
        NIGHT_OF_THE_LIVING_DEAD,
        { ...NIGHT_OF_THE_LIVING_DEAD, id: 3, year: 1990, tmdbId: 10332 },
      ],
    });

    await executeRemove(settings(fake, { query: 'night of the living dead', yes: true }));

    expect(errors).toEqual([
      '✖ Several titles match "night of the living dead".',
      '2 titles match "night of the living dead"; repeat the command with one of these options:',
      '  --movie 10331  Night of the Living Dead (1968) — movie',
      '  --movie 10332  Night of the Living Dead (1990) — movie',
    ]);
    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it('prints the plan and deletes nothing without --yes', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { query: 'night of the living' }));

    expect(output).toEqual([
      'Moody Blues CLI v0.1.0 — Remove (Headless)',
      'Title: Night of the Living Dead (1968) — movie',
      '  Folder          /data/media/movies/Night of the Living Dead (1968)',
      '  Real-Debrid     1 torrent will be deleted',
      '                  Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GROUP',
      '  Seerr           the title becomes requestable again',
    ]);
    expect(errors).toEqual([
      '✖ Nothing was deleted. Pass --yes to delete the title non-interactively.',
    ]);
    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(fake.library.movie).toHaveLength(2);
  });

  it('deletes everywhere with --yes and prints one line per step', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { query: 'night of the living', yes: true }));

    expect(output.slice(6)).toEqual([
      '✔ Radarr       title and files deleted',
      '✔ Decypharr    1 torrent deleted from Real-Debrid',
      '✔ Seerr        record cleared',
      '✔ Jellyfin     library refresh requested',
    ]);
    expect(errors).toEqual([]);
    expect(process.exitCode).toBe(0);
    expect([...fake.torrents]).toEqual([OTHER_HASH]);
  });

  it('selects a series by tvdbId and a movie by tmdbId without searching', async () => {
    const fake = doubles({
      seriesHistory: [grabbed('seriesId', 7, OTHER_HASH.toUpperCase(), 'Cosmos.S01')],
    });

    await executeRemove(settings(fake, { series: 72440, yes: true }));
    await executeRemove(settings(fake, { movie: 10378, yes: true }));

    expect(fake.calls).toContain('sonarr.deleteTitle:7');
    expect(fake.calls).toContain('radarr.deleteTitle:2');
  });

  it('keeps the torrents with --keep-debrid', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { movie: 10331, keepDebrid: true, yes: true }));

    expect(output).toContain('  Real-Debrid     nothing will be deleted (--keep-debrid)');
    expect(output).toContain('- Decypharr    torrents kept (--keep-debrid)');
    expect([...fake.torrents]).toContain(NIGHT_HASH);
    expect(process.exitCode).toBe(0);
  });

  it('exits with 2 and names the pending torrents when a later step fails', async () => {
    const fake = doubles({ failTorrents: [NIGHT_HASH] });

    await executeRemove(settings(fake, { movie: 10331, yes: true }));

    expect(process.exitCode).toBe(2);
    expect(errors).toEqual([
      '✖ The title was deleted from the library, but a later step failed.',
      `   ↳ Pending torrents: ${NIGHT_HASH}`,
    ]);
    expect(output).toContain(
      '✖ Decypharr    1 torrent could not be deleted (no torrents were deleted)',
    );
  });

  it('exits with 1 when the library deletion fails', async () => {
    const fake = doubles({ failLibraryDelete: true });

    await executeRemove(settings(fake, { movie: 10331, yes: true }));

    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual(['radarr.deleteTitle:1']);
  });

  it('prints one JSON document with the plan and the steps', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { movie: 10331, yes: true, mode: 'json' }));

    const json = JSON.parse(output.join('\n'));
    expect(json).toMatchObject({
      success: true,
      executed: true,
      target: { kind: 'movie', id: 1, tmdbId: 10331 },
      plan: { keepDebrid: false, torrents: [{ infohash: NIGHT_HASH }], kept: [] },
      pendingInfohashes: [],
    });
    expect(
      json.steps.map((step: { id: string; status: string }) => `${step.id}:${step.status}`),
    ).toEqual(['library:ok', 'decypharr:ok', 'seerr:ok', 'jellyfin:ok']);
    expect(process.exitCode).toBe(0);
  });

  it('prints the plan as JSON and deletes nothing without --yes', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { movie: 10331, mode: 'json' }));

    expect(JSON.parse(output.join('\n'))).toMatchObject({
      success: false,
      executed: false,
      error: 'Pass --yes to delete the title.',
      plan: { torrents: [{ infohash: NIGHT_HASH }] },
    });
    expect(process.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it('prints the candidates as JSON when several match', async () => {
    const fake = doubles();

    await executeRemove(settings(fake, { query: 'o', mode: 'json', yes: true }));

    const json = JSON.parse(output.join('\n'));
    expect(json.success).toBe(false);
    expect(json.candidates.length).toBeGreaterThan(1);
    expect(json.candidates[0]).toHaveProperty('selector');
    expect(process.exitCode).toBe(1);
  });

  it('prints a failure to read the library as JSON', async () => {
    const fake = doubles();
    fake.clients.radarr.listTitles = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:7878');
    };

    await executeRemove(settings(fake, { movie: 1, mode: 'json', yes: true }));

    expect(JSON.parse(output.join('\n'))).toMatchObject({
      success: false,
      error: 'connect ECONNREFUSED 127.0.0.1:7878',
    });
    expect(process.exitCode).toBe(1);
  });

  it('prints a failure to read the library as an error line', async () => {
    const fake = doubles();
    fake.clients.sonarr.listTitles = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8989');
    };

    await executeRemove(settings(fake, { movie: 1, yes: true }));

    expect(errors).toEqual(['✖ connect ECONNREFUSED 127.0.0.1:8989']);
    expect(process.exitCode).toBe(1);
  });
});

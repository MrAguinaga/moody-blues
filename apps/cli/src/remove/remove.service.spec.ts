import { describe, expect, it, vi } from 'vitest';

import { buildRemovePlan } from './remove.plan';
import { toRemoveTarget } from './remove.search';
import { readLibrary, runRemove } from './remove.service';
import {
  BIG_BUCK_BUNNY,
  CLASSIC_SERIES,
  createRemoveDoubles,
  grabbed,
  NIGHT_HASH,
  NIGHT_OF_THE_LIVING_DEAD,
  OTHER_HASH,
  type RemoveDoublesOptions,
} from './remove.testing';
import type { RemoveStepResult } from './remove.types';

const MEDIA = { id: 40, mediaType: 'movie' as const, tmdbId: 10331, tvdbId: null };

async function setup(options: RemoveDoublesOptions = {}) {
  const doubles = createRemoveDoubles({
    movies: [NIGHT_OF_THE_LIVING_DEAD, BIG_BUCK_BUNNY],
    movieHistory: [
      grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Night.of.the.Living.Dead.1968'),
    ],
    torrents: [NIGHT_HASH, OTHER_HASH],
    media: [MEDIA],
    ...options,
  });
  const library = await readLibrary(doubles.clients);
  const plan = await buildRemovePlan(
    doubles.clients,
    library,
    toRemoveTarget('movie', NIGHT_OF_THE_LIVING_DEAD),
    { keepDebrid: false },
  );
  return { doubles, plan };
}

describe('runRemove', () => {
  it('deletes in order: library, torrents, Seerr, Jellyfin', async () => {
    const { doubles, plan } = await setup();
    const onStep = vi.fn<(step: RemoveStepResult) => void>();

    const result = await runRemove({ clients: doubles.clients, plan, onStep });

    expect(doubles.calls).toEqual([
      'radarr.deleteTitle:1',
      `decypharr.deleteTorrent:${NIGHT_HASH}`,
      'seerr.findMedia:movie',
      'seerr.deleteMedia:40',
      'jellyfin.refreshLibrary',
    ]);
    expect(result).toMatchObject({ success: true, libraryDeleted: true, pendingInfohashes: [] });
    expect(result.steps.map(({ id, status }) => `${id}:${status}`)).toEqual([
      'library:ok',
      'decypharr:ok',
      'seerr:ok',
      'jellyfin:ok',
    ]);
    expect(onStep).toHaveBeenCalledTimes(4);
    expect(result.steps[1]?.message).toBe('1 torrent deleted from Real-Debrid');
    expect([...doubles.torrents]).toEqual([OTHER_HASH]);
    expect(doubles.media).toEqual([]);
  });

  it('looks a series up in Seerr as a tv title by its two ids', async () => {
    const doubles = createRemoveDoubles({
      series: [CLASSIC_SERIES],
      seriesHistory: [grabbed('seriesId', 7, OTHER_HASH.toUpperCase(), 'Cosmos.S01')],
      torrents: [OTHER_HASH],
      media: [{ id: 5, mediaType: 'tv', tmdbId: 1100, tvdbId: 72440 }],
    });
    const library = await readLibrary(doubles.clients);
    const plan = await buildRemovePlan(
      doubles.clients,
      library,
      toRemoveTarget('series', CLASSIC_SERIES),
      { keepDebrid: false },
    );

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.success).toBe(true);
    expect(doubles.calls).toContain('sonarr.deleteTitle:7');
    expect(doubles.calls).toContain('seerr.findMedia:tv');
    expect(doubles.media).toEqual([]);
  });

  it('counts a torrent Decypharr no longer has as gone, not as an error', async () => {
    const { doubles, plan } = await setup({ torrents: [] });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.success).toBe(true);
    expect(result.steps[1]).toMatchObject({
      status: 'ok',
      message: '1 torrent already gone',
    });
  });

  it('skips Decypharr when there is nothing to delete', async () => {
    const { doubles, plan } = await setup({ movieHistory: [] });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.steps[1]).toMatchObject({ status: 'skipped', message: 'no torrents to delete' });
    expect(doubles.calls.some((call) => call.startsWith('decypharr'))).toBe(false);
    expect(result.success).toBe(true);
  });

  it('skips Decypharr with --keep-debrid and still clears Seerr', async () => {
    const { doubles } = await setup();
    const library = await readLibrary(doubles.clients);
    const plan = await buildRemovePlan(
      doubles.clients,
      library,
      toRemoveTarget('movie', NIGHT_OF_THE_LIVING_DEAD),
      { keepDebrid: true },
    );

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.steps[1]).toMatchObject({
      status: 'skipped',
      message: 'torrents kept (--keep-debrid)',
    });
    expect([...doubles.torrents]).toContain(NIGHT_HASH);
    expect(doubles.media).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('reports a title that Seerr never had as already clean', async () => {
    const { doubles, plan } = await setup({ media: [] });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.steps[2]).toMatchObject({ status: 'ok', message: 'no record to clear' });
    expect(doubles.calls).not.toContain('seerr.deleteMedia:40');
  });

  it('touches nothing else when the library deletion fails', async () => {
    const { doubles, plan } = await setup({ failLibraryDelete: true });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(doubles.calls).toEqual(['radarr.deleteTitle:1']);
    expect(result).toMatchObject({ success: false, libraryDeleted: false, pendingInfohashes: [] });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ id: 'library', status: 'failed' });
    expect([...doubles.torrents]).toEqual([NIGHT_HASH, OTHER_HASH]);
  });

  it('lists the pending infohashes when Decypharr fails and still runs the later steps', async () => {
    const { doubles, plan } = await setup({ failTorrents: [NIGHT_HASH] });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.success).toBe(false);
    expect(result.libraryDeleted).toBe(true);
    expect(result.pendingInfohashes).toEqual([NIGHT_HASH]);
    expect(result.steps[1]).toMatchObject({ id: 'decypharr', status: 'failed' });
    expect(result.steps[1]?.details?.[0]).toContain(NIGHT_HASH);
    expect(result.steps.slice(2).map((step) => step.status)).toEqual(['ok', 'ok']);
  });

  it('keeps going with the other torrents when one fails', async () => {
    const doubles = createRemoveDoubles({
      movies: [NIGHT_OF_THE_LIVING_DEAD],
      movieHistory: [
        grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'First'),
        grabbed('movieId', 1, OTHER_HASH.toUpperCase(), 'Second'),
      ],
      torrents: [NIGHT_HASH, OTHER_HASH],
      failTorrents: [NIGHT_HASH],
    });
    const library = await readLibrary(doubles.clients);
    const plan = await buildRemovePlan(
      doubles.clients,
      library,
      toRemoveTarget('movie', NIGHT_OF_THE_LIVING_DEAD),
      { keepDebrid: false },
    );

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.pendingInfohashes).toEqual([NIGHT_HASH]);
    expect(result.steps[1]?.message).toBe(
      '1 torrent could not be deleted (1 torrent deleted from Real-Debrid)',
    );
    expect([...doubles.torrents]).toEqual([NIGHT_HASH]);
  });

  it('does not let a Seerr failure stop Jellyfin', async () => {
    const { doubles, plan } = await setup({ failSeerr: true });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result.success).toBe(false);
    expect(result.steps.map(({ id, status }) => `${id}:${status}`)).toEqual([
      'library:ok',
      'decypharr:ok',
      'seerr:failed',
      'jellyfin:ok',
    ]);
    expect(doubles.calls).toContain('jellyfin.refreshLibrary');
    expect(result.steps[2]?.hint).toMatch(/Seerr/);
  });

  it('reports a Jellyfin failure without undoing anything', async () => {
    const { doubles, plan } = await setup({ failJellyfin: true });

    const result = await runRemove({ clients: doubles.clients, plan });

    expect(result).toMatchObject({ success: false, libraryDeleted: true });
    expect(result.steps[3]).toMatchObject({ id: 'jellyfin', status: 'failed' });
  });
});

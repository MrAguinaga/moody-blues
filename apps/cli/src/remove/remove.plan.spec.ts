import { describe, expect, it } from 'vitest';

import type { HistoryRecord } from '@moody-blues/provisioner';

import { buildRemovePlan, classifyDownloads, extractGrabbedDownloads } from './remove.plan';
import { toRemoveTarget } from './remove.search';
import {
  BIG_BUCK_BUNNY,
  CLASSIC_SERIES,
  createRemoveDoubles,
  grabbed,
  NIGHT_HASH,
  NIGHT_OF_THE_LIVING_DEAD,
  OTHER_HASH,
} from './remove.testing';

describe('extractGrabbedDownloads', () => {
  it('keeps the distinct grabbed download ids, normalized to lower case', () => {
    const history: HistoryRecord[] = [
      grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Night.of.the.Living.Dead.1968'),
      grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Night.of.the.Living.Dead.1968'),
    ];

    expect(extractGrabbedDownloads(history)).toEqual([
      {
        downloadId: NIGHT_HASH.toUpperCase(),
        infohash: NIGHT_HASH,
        name: 'Night.of.the.Living.Dead.1968',
      },
    ]);
  });

  it('collapses a season pack grabbed once per episode into one torrent', () => {
    const history = Array.from({ length: 12 }, () =>
      grabbed('seriesId', 7, OTHER_HASH.toUpperCase(), 'Cosmos.S01.1080p'),
    );

    expect(extractGrabbedDownloads(history)).toHaveLength(1);
  });

  it('ignores the events that are not a grab or carry no download id', () => {
    const history: HistoryRecord[] = [
      { eventType: 'downloadFolderImported', downloadId: NIGHT_HASH, movieId: 1 },
      { eventType: 'grabbed', movieId: 1, sourceTitle: 'No download id' },
      { eventType: 'grabbed', movieId: 1, downloadId: '' },
    ];

    expect(extractGrabbedDownloads(history)).toEqual([]);
  });

  it('answers an empty list for a title without history', () => {
    expect(extractGrabbedDownloads([])).toEqual([]);
  });
});

describe('classifyDownloads', () => {
  const download = (infohash: string, name?: string) => ({
    downloadId: infohash.toUpperCase(),
    infohash,
    name,
  });

  it('deletes the torrents nobody else uses', () => {
    expect(classifyDownloads([download(NIGHT_HASH, 'Night')], new Map(), false)).toEqual({
      torrents: [{ infohash: NIGHT_HASH, name: 'Night' }],
      kept: [],
    });
  });

  it('keeps a torrent shared with another title and names it', () => {
    const shared = new Map([[NIGHT_HASH, ['Big Buck Bunny (2008)', 'Cosmos (1980)']]]);

    expect(classifyDownloads([download(NIGHT_HASH, 'Night')], shared, false)).toEqual({
      torrents: [],
      kept: [
        {
          infohash: NIGHT_HASH,
          name: 'Night',
          reason: 'also used by Big Buck Bunny (2008), Cosmos (1980)',
        },
      ],
    });
  });

  it('keeps every torrent with --keep-debrid', () => {
    expect(classifyDownloads([download(NIGHT_HASH)], new Map(), true)).toEqual({
      torrents: [],
      kept: [{ infohash: NIGHT_HASH, name: undefined, reason: 'kept by --keep-debrid' }],
    });
  });

  it('never deletes a download id that is not a 40 character infohash', () => {
    const result = classifyDownloads(
      [download('sabnzbd_nzo_abc123'), download('../../etc')],
      new Map(),
      false,
    );

    expect(result.torrents).toEqual([]);
    expect(result.kept.map((torrent) => torrent.reason)).toEqual([
      'the download id is not a torrent infohash',
      'the download id is not a torrent infohash',
    ]);
  });
});

describe('buildRemovePlan', () => {
  const movie = toRemoveTarget('movie', NIGHT_OF_THE_LIVING_DEAD);

  it('plans an empty deletion for a title without history', async () => {
    const doubles = createRemoveDoubles({ movies: [NIGHT_OF_THE_LIVING_DEAD] });

    const plan = await buildRemovePlan(
      doubles.clients,
      { movies: [NIGHT_OF_THE_LIVING_DEAD], series: [] },
      movie,
      {
        keepDebrid: false,
      },
    );

    expect(plan).toEqual({ target: movie, torrents: [], kept: [], keepDebrid: false });
  });

  it('plans one torrent for a season pack', async () => {
    const doubles = createRemoveDoubles({
      series: [CLASSIC_SERIES],
      seriesHistory: Array.from({ length: 13 }, () =>
        grabbed('seriesId', 7, OTHER_HASH.toUpperCase(), 'Cosmos.S01.1080p.BluRay'),
      ),
    });

    const plan = await buildRemovePlan(
      doubles.clients,
      { movies: [], series: [CLASSIC_SERIES] },
      toRemoveTarget('series', CLASSIC_SERIES),
      { keepDebrid: false },
    );

    expect(plan.torrents).toEqual([{ infohash: OTHER_HASH, name: 'Cosmos.S01.1080p.BluRay' }]);
  });

  it('keeps a torrent whose download id another movie of the library also grabbed', async () => {
    const library = { movies: [NIGHT_OF_THE_LIVING_DEAD, BIG_BUCK_BUNNY], series: [] };
    const doubles = createRemoveDoubles({
      ...library,
      movieHistory: [
        grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Collection.Pack'),
        grabbed('movieId', 2, NIGHT_HASH.toUpperCase(), 'Collection.Pack'),
        grabbed('movieId', 1, OTHER_HASH.toUpperCase(), 'Night.1968'),
      ],
    });

    const plan = await buildRemovePlan(doubles.clients, library, movie, { keepDebrid: false });

    expect(plan.torrents).toEqual([{ infohash: OTHER_HASH, name: 'Night.1968' }]);
    expect(plan.kept).toEqual([
      {
        infohash: NIGHT_HASH,
        name: 'Collection.Pack',
        reason: 'also used by Big Buck Bunny (2008)',
      },
    ]);
  });

  it('finds the other title even when it stored the download id in lower case', async () => {
    const library = { movies: [NIGHT_OF_THE_LIVING_DEAD, BIG_BUCK_BUNNY], series: [] };
    const doubles = createRemoveDoubles({
      ...library,
      movieHistory: [
        grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Pack'),
        grabbed('movieId', 2, NIGHT_HASH, 'Pack'),
      ],
    });

    const plan = await buildRemovePlan(doubles.clients, library, movie, { keepDebrid: false });

    expect(plan.torrents).toEqual([]);
    expect(plan.kept[0]?.reason).toBe('also used by Big Buck Bunny (2008)');
  });

  it('keeps a torrent a series of Sonarr also grabbed', async () => {
    const library = { movies: [NIGHT_OF_THE_LIVING_DEAD], series: [CLASSIC_SERIES] };
    const doubles = createRemoveDoubles({
      ...library,
      movieHistory: [grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Pack')],
      seriesHistory: [grabbed('seriesId', 7, NIGHT_HASH.toUpperCase(), 'Pack')],
    });

    const plan = await buildRemovePlan(doubles.clients, library, movie, { keepDebrid: false });

    expect(plan.kept[0]?.reason).toBe('also used by Cosmos (1980)');
  });

  it('never plans an infohash that is not in the history of the title', async () => {
    const library = { movies: [NIGHT_OF_THE_LIVING_DEAD, BIG_BUCK_BUNNY], series: [] };
    const doubles = createRemoveDoubles({
      ...library,
      torrents: [NIGHT_HASH, OTHER_HASH, 'b'.repeat(40)],
      movieHistory: [
        grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Night.1968'),
        grabbed('movieId', 2, OTHER_HASH.toUpperCase(), 'Bunny.2008'),
      ],
    });

    const plan = await buildRemovePlan(doubles.clients, library, movie, { keepDebrid: false });

    expect(plan.torrents.map((torrent) => torrent.infohash)).toEqual([NIGHT_HASH]);
    expect(plan.kept).toEqual([]);
  });

  it('moves every torrent to the kept list with --keep-debrid', async () => {
    const doubles = createRemoveDoubles({
      movies: [NIGHT_OF_THE_LIVING_DEAD],
      movieHistory: [grabbed('movieId', 1, NIGHT_HASH.toUpperCase(), 'Night.1968')],
    });

    const plan = await buildRemovePlan(
      doubles.clients,
      { movies: [NIGHT_OF_THE_LIVING_DEAD], series: [] },
      movie,
      {
        keepDebrid: true,
      },
    );

    expect(plan.torrents).toEqual([]);
    expect(plan.kept).toEqual([
      { infohash: NIGHT_HASH, name: 'Night.1968', reason: 'kept by --keep-debrid' },
    ]);
    expect(plan.keepDebrid).toBe(true);
  });
});

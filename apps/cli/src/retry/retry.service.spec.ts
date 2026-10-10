import { describe, expect, it } from 'vitest';

import { runRetry, seasonsOf } from './retry.service';
import {
  AZUMANGA,
  createRetryDoubles,
  DVD,
  episode,
  episodeFile,
  NOW,
  PACK_EXTRA,
  PACK_HASH,
  packFile,
  planOf,
  RELEASE_KAA,
  RELEASE_MAN,
  type RetryDoublesOptions,
  seasonOf,
} from './retry.testing';

const HASH = PACK_HASH.toLowerCase();
const failure = (time: string, reason: string) =>
  `2026-10-09 ${time} | ERROR | [qbit] failed to submit torrent to debrid: ${reason}`;

function setup(options: RetryDoublesOptions, plan = planOf(options.season)) {
  const doubles = createRetryDoubles(options);
  const reported: string[] = [];
  const run = () =>
    runRetry({
      clients: doubles.clients,
      runtime: doubles.runtime,
      plan,
      onStep: (step) => reported.push(`${step.id}:${step.status}`),
    });
  return { doubles, run, reported };
}

const FOUR_FILES = [1, 2, 3, 4].map(packFile);

describe('runRetry sending the release', () => {
  it('forces the release onto every episode of the season with its quality and languages', async () => {
    const season = seasonOf(3);
    const { doubles, run } = setup({ season, packFiles: [1, 2, 3].map(packFile) });

    await run();

    expect(doubles.grabs).toEqual([
      {
        guid: RELEASE_MAN.guid,
        indexerId: 3,
        quality: RELEASE_MAN.quality,
        languages: [{ id: 8, name: 'Japanese' }],
        shouldOverride: true,
        seriesId: AZUMANGA.id,
        episodeIds: [101, 102, 103],
      },
    ]);
  });

  it('reports the reason Decypharr wrote in its log when it rejects the release', async () => {
    const { doubles, run, reported } = setup({
      season: seasonOf(3),
      refuse: true,
      log: failure('12:00:03', 'torrent X has error status: error'),
    });

    const result = await run();

    expect(result.outcome).toBe('rejected');
    expect(result.success).toBe(false);
    expect(result.steps).toEqual([
      {
        id: 'decypharr',
        status: 'failed',
        message: 'release 1 rejected: torrent X has error status: error',
      },
    ]);
    expect(reported).toEqual(['decypharr:failed']);
    expect(doubles.calls).toEqual(['sonarr.grabRelease']);
  });

  it('explains the rejection even when the log has nothing', async () => {
    const { run } = setup({ season: seasonOf(2), refuse: true, log: '' });

    expect((await run()).steps[0]?.message).toContain('probably not cached on Real-Debrid');
  });

  it('explains the rejection even when the log cannot be read', async () => {
    const { run } = setup({ season: seasonOf(2), refuse: true, log: new Error('EACCES') });

    expect((await run()).steps[0]?.message).toContain('its log could not be read');
  });

  it('reports a failure that is not a Decypharr refusal as failed, without a rollback', async () => {
    const { doubles, run } = setup({ season: seasonOf(2) });
    doubles.clients.sonarr.grabRelease = async () => {
      throw new Error('POST /api/v3/release responded 500: boom');
    };

    const result = await run();

    expect(result.outcome).toBe('failed');
    expect(result.steps[0]?.message).toContain('could not be sent');
    expect(doubles.calls).toEqual([]);
  });
});

describe('runRetry verifying and importing', () => {
  it('imports the pack by episode number after reading each file through the mount', async () => {
    const season = seasonOf(4, [1]);
    const { doubles, run, reported } = setup(
      { season, packFiles: [...FOUR_FILES, PACK_EXTRA] },
      planOf(season, RELEASE_MAN, [episodeFile(501)]),
    );

    const result = await run();

    expect(result).toMatchObject({ outcome: 'imported', imported: 3, success: true });
    expect(reported).toEqual(['decypharr:ok', 'verify:ok', 'sonarr:ok']);
    expect(doubles.calls.filter((call) => call.startsWith('probe:'))).toHaveLength(3);
    expect(doubles.imports).toHaveLength(1);
    expect(doubles.imports[0]).toEqual(
      [2, 3, 4].map((number) => ({
        path: packFile(number),
        seriesId: AZUMANGA.id,
        episodeIds: [100 + number],
        quality: RELEASE_MAN.quality,
        languages: [{ id: 8, name: 'Japanese' }],
        releaseGroup: 'man',
        downloadId: PACK_HASH,
      })),
    );
    expect(result.steps[0]?.message).toBe('release 1 delivered (5 files)');
    expect(result.steps[1]?.message).toBe(
      '3 episodes readable through the mount, no re-insertions',
    );
    expect(result.steps[2]?.message).toBe('3 episodes imported, 1 file skipped');
    expect(result.steps[2]?.details).toContain(`no episode number: ${PACK_EXTRA}`);
    expect(doubles.calls.some((call) => call.startsWith('decypharr.deleteTorrent'))).toBe(false);
  });

  it('replaces the episodes of a worse quality, which Sonarr sends to the recycle bin', async () => {
    const season = seasonOf(3, [1, 2, 3]);
    const files = [episodeFile(501, DVD), episodeFile(502, DVD), episodeFile(503, DVD)];
    const { doubles, run } = setup(
      { season, packFiles: [1, 2, 3].map(packFile) },
      planOf(season, RELEASE_MAN, files),
    );

    const result = await run();

    expect(result.imported).toBe(3);
    expect(doubles.imports[0]).toHaveLength(3);
    expect(doubles.episodes.map((item) => item.episodeFileId)).not.toContain(501);
  });

  it('waits for the pack to be delivered before reading it', async () => {
    const season = seasonOf(2);
    const { doubles, run } = setup({ season, packFiles: [1, 2].map(packFile) });
    const queue = doubles.clients.sonarr.listQueue;
    let polls = 0;
    doubles.clients.sonarr.listQueue = async (listing) => {
      polls += 1;
      return polls < 3 ? [] : queue(listing);
    };

    expect((await run()).outcome).toBe('imported');
    expect(polls).toBe(3);
  });

  it('recognizes a re-sent pack by its repeated grab in the history', async () => {
    const season = seasonOf(2);
    const { run } = setup({
      season,
      packFiles: [1, 2].map(packFile),
      history: [{ id: 5, eventType: 'grabbed', downloadId: PACK_HASH, seriesId: AZUMANGA.id }],
    });

    expect((await run()).outcome).toBe('imported');
  });
});

describe('runRetry rolling back', () => {
  it('deletes the torrent and blocklists the release when a file cannot be read, importing nothing', async () => {
    const season = seasonOf(3);
    const { doubles, run, reported } = setup({
      season,
      packFiles: [1, 2, 3].map(packFile),
      unreadable: [packFile(2)],
    });

    const result = await run();

    expect(result.outcome).toBe('unverified');
    expect(result.success).toBe(false);
    expect(reported).toEqual(['decypharr:ok', 'verify:failed', 'rollback:ok']);
    expect(result.steps[1]?.message).toContain('episode 2 is not readable through the mount');
    expect(result.steps[2]).toMatchObject({
      status: 'ok',
      message: 'The library was not touched',
      details: ['Torrent deleted from Real-Debrid', 'Queue item removed and release blocklisted'],
    });
    expect(doubles.calls).toContain(`decypharr.deleteTorrent:${HASH}`);
    expect(doubles.calls).toContain(
      'sonarr.removeQueueItem:31:{"removeFromClient":false,"blocklist":true,"skipRedownload":true}',
    );
    expect(doubles.calls).not.toContain('sonarr.manualImport');
    expect(doubles.calls.filter((call) => call.startsWith('probe:'))).toHaveLength(2);
  });

  it('rolls back when Decypharr re-inserted the torrent', async () => {
    const { doubles, run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      log: `2026-10-09 12:00:30 | INFO  | [manager] Successfully re-inserted entry debrid=realdebrid infohash=${HASH} name=x\n`,
    });

    const result = await run();

    expect(result.outcome).toBe('unverified');
    expect(result.steps[1]?.message).toBe('Decypharr re-inserted the torrent 1 time');
    expect(doubles.calls).not.toContain('sonarr.manualImport');
  });

  it('rolls back when Decypharr marked the torrent as bad', async () => {
    const { run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      log: "2026-10-09 12:00:30 | WARN  | [repair] can't repair Azumanga Daioh since it's been marked as bad\n",
    });

    expect((await run()).steps[1]?.message).toBe('Decypharr marked the torrent as bad');
  });

  it('does not import when the Decypharr log cannot be read', async () => {
    const { doubles, run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      log: new Error('EACCES'),
    });

    const result = await run();

    expect(result.steps[1]?.message).toContain('the Decypharr log could not be read');
    expect(doubles.calls).not.toContain('sonarr.manualImport');
  });

  it('keeps a torrent the library already uses and only clears the queue item', async () => {
    const { doubles, run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      unreadable: [packFile(1)],
      history: [
        {
          id: 4,
          eventType: 'downloadFolderImported',
          downloadId: PACK_HASH,
          seriesId: AZUMANGA.id,
        },
      ],
    });

    const result = await run();

    expect(result.steps.at(-1)?.details).toEqual([
      'The torrent was already used by the library, so it was kept',
      'Queue item removed',
    ]);
    expect(doubles.calls.some((call) => call.startsWith('decypharr.deleteTorrent'))).toBe(false);
    expect(doubles.calls).toContain(
      'sonarr.removeQueueItem:31:{"removeFromClient":false,"blocklist":false,"skipRedownload":true}',
    );
  });

  it('reports an incomplete rollback with a hint when the torrent cannot be deleted', async () => {
    const { run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      unreadable: [packFile(1)],
      failTorrentDelete: true,
    });

    const rollback = (await run()).steps.at(-1);

    expect(rollback).toMatchObject({ id: 'rollback', status: 'failed' });
    expect(rollback?.hint).toContain('doctor --fix');
    expect(rollback?.details?.join('\n')).toContain(`torrent ${HASH}`);
  });

  it('rolls back a pack that is never delivered', async () => {
    const { doubles, run } = setup({ season: seasonOf(2), delivery: 'never' });

    const result = await run();

    expect(result.outcome).toBe('unverified');
    expect(result.steps[0]?.message).toBe('release 1 was not delivered in time');
    expect(doubles.calls).toContain(`decypharr.deleteTorrent:${HASH}`);
    expect(doubles.clock.now - NOW).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('rolls back a pack that Sonarr reports as failed', async () => {
    const { run } = setup({ season: seasonOf(2), delivery: 'failed' });

    const result = await run();

    expect(result.steps[0]?.message).toBe('release 1 failed: Download failed');
    expect(result.outcome).toBe('unverified');
  });

  it('rolls back when no pack file matches an episode that needs one', async () => {
    const { doubles, run } = setup({ season: seasonOf(2), packFiles: [PACK_EXTRA] });

    const result = await run();

    expect(result.steps[1]).toMatchObject({
      id: 'verify',
      status: 'failed',
      message: 'no file of the release matches an episode that needs one',
    });
    expect(doubles.calls).not.toContain('sonarr.manualImport');
  });
});

describe('runRetry after the import starts', () => {
  it('does not delete anything when Sonarr fails the import', async () => {
    const { doubles, run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      failImport: true,
    });

    const result = await run();

    expect(result.outcome).toBe('failed');
    expect(result.steps.at(-1)).toMatchObject({ id: 'sonarr', status: 'failed' });
    expect(result.steps.at(-1)?.message).toBe('Sonarr failed the import: Import failed');
    expect(doubles.calls.some((call) => call.startsWith('decypharr.deleteTorrent'))).toBe(false);
  });

  it('fails when the episodes do not show the new file afterwards', async () => {
    const { run } = setup({
      season: seasonOf(2),
      packFiles: [1, 2].map(packFile),
      skipImportEffect: true,
    });

    const result = await run();

    expect(result).toMatchObject({ outcome: 'failed', imported: 0, success: false });
    expect(result.steps.at(-1)?.hint).toContain('recycle bin');
  });

  it('leaves a release Sonarr recognized to Sonarr own import', async () => {
    const season = seasonOf(2);
    const { doubles, run } = setup({ season, delivery: 'automatic' }, planOf(season, RELEASE_KAA));

    const result = await run();

    expect(result).toMatchObject({ outcome: 'imported', success: true });
    expect(result.steps.map((step) => step.id)).toEqual(['decypharr', 'sonarr']);
    expect(doubles.calls).not.toContain('sonarr.manualImport');
  });
});

describe('seasonsOf', () => {
  const aired = '2002-04-08T00:00:00Z';
  const future = '2030-01-01T00:00:00Z';

  it('keeps the monitored seasons with aired episodes that have no file', () => {
    const seasons = seasonsOf(
      [
        episode(1, { hasFile: true }),
        episode(2),
        episode(3, { airDateUtc: future }),
        episode(4, { monitored: false }),
        episode(1, { id: 900, seasonNumber: 0 }),
        episode(1, { id: 901, seasonNumber: 2, hasFile: true }),
      ],
      NOW,
    );

    expect(seasons.map((season) => season.seasonNumber)).toEqual([1]);
    expect(seasons[0]?.episodes.map((item) => item.episodeNumber)).toEqual([1, 2, 3]);
    expect(seasons[0]?.missing.map((item) => item.episodeNumber)).toEqual([2]);
  });

  it('returns the requested season even when it is complete', () => {
    const seasons = seasonsOf([episode(1, { hasFile: true, airDateUtc: aired })], NOW, 1);

    expect(seasons).toHaveLength(1);
    expect(seasons[0]?.missing).toEqual([]);
  });

  it('returns nothing for a season the series does not have', () => {
    expect(seasonsOf([episode(1)], NOW, 4)).toEqual([]);
  });
});

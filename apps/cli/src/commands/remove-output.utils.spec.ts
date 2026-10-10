import { describe, expect, it } from 'vitest';

import type { RemovePlan, RemoveResult, RemoveTarget } from '../remove';
import {
  formatRemoveCandidates,
  formatRemovePlan,
  formatRemoveResult,
  toRemoveJson,
  toRemoveRefusedJson,
} from './remove-output.utils';

const movie: RemoveTarget = {
  kind: 'movie',
  id: 1,
  title: 'Night of the Living Dead',
  year: 1968,
  path: '/data/media/movies/Night of the Living Dead (1968)',
  tmdbId: 10331,
};

const plan = (patch: Partial<RemovePlan> = {}): RemovePlan => ({
  target: movie,
  torrents: [
    { infohash: 'c'.repeat(40), name: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GROUP' },
  ],
  kept: [],
  keepDebrid: false,
  ...patch,
});

const completed: RemoveResult = {
  plan: plan(),
  libraryDeleted: true,
  pendingInfohashes: [],
  success: true,
  steps: [
    { id: 'library', status: 'ok', message: 'title and files deleted' },
    { id: 'decypharr', status: 'ok', message: '1 torrent deleted from Real-Debrid' },
    { id: 'seerr', status: 'ok', message: 'record cleared' },
    { id: 'jellyfin', status: 'ok', message: 'library refresh requested' },
  ],
};

describe('formatRemovePlan', () => {
  it('prints the folder, the torrents by name and the Seerr effect', () => {
    expect(formatRemovePlan(plan())).toEqual([
      'Title: Night of the Living Dead (1968) — movie',
      '  Folder          /data/media/movies/Night of the Living Dead (1968)',
      '  Real-Debrid     1 torrent will be deleted',
      '                  Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GROUP',
      '  Seerr           the title becomes requestable again',
    ]);
  });

  it('states that a title without history deletes no torrents', () => {
    expect(formatRemovePlan(plan({ torrents: [] }))[2]).toBe(
      '  Real-Debrid     no torrents in the download history of the title',
    );
  });

  it('lists the kept torrents with their reason', () => {
    const lines = formatRemovePlan(
      plan({
        torrents: [],
        kept: [{ infohash: 'a'.repeat(40), name: 'Pack', reason: 'also used by Cosmos (1980)' }],
      }),
    );

    expect(lines.slice(2, 4)).toEqual([
      '  Real-Debrid     no torrents in the download history of the title',
      '  Kept            1 torrent stay in Real-Debrid',
    ]);
    expect(lines[4]).toBe('                  Pack (also used by Cosmos (1980))');
  });

  it('explains --keep-debrid and falls back to the infohash without a name', () => {
    const lines = formatRemovePlan(
      plan({
        torrents: [],
        keepDebrid: true,
        kept: [{ infohash: 'a'.repeat(40), reason: 'kept by --keep-debrid' }],
      }),
    );

    expect(lines[2]).toBe('  Real-Debrid     nothing will be deleted (--keep-debrid)');
    expect(lines[4]).toBe(`                  ${'a'.repeat(40)} (kept by --keep-debrid)`);
  });

  it('omits the year and the folder when they are unknown', () => {
    const lines = formatRemovePlan(
      plan({ target: { kind: 'series', id: 7, title: 'Cosmos', tvdbId: 3 }, torrents: [] }),
    );

    expect(lines[0]).toBe('Title: Cosmos — series');
    expect(lines[1]).toMatch(/Real-Debrid/);
  });
});

describe('formatRemoveResult', () => {
  it('prints one line per step', () => {
    expect(formatRemoveResult(completed)).toEqual([
      '✔ Radarr       title and files deleted',
      '✔ Decypharr    1 torrent deleted from Real-Debrid',
      '✔ Seerr        record cleared',
      '✔ Jellyfin     library refresh requested',
    ]);
  });

  it('names Sonarr for a series and marks skipped steps', () => {
    const series = plan({ target: { kind: 'series', id: 7, title: 'Cosmos', tvdbId: 3 } });

    expect(
      formatRemoveResult({
        ...completed,
        plan: series,
        steps: [
          { id: 'library', status: 'ok', message: 'title and files deleted' },
          { id: 'decypharr', status: 'skipped', message: 'no torrents to delete' },
        ],
      }),
    ).toEqual(['✔ Sonarr       title and files deleted', '- Decypharr    no torrents to delete']);
  });

  it('prints the details, the hint and the pending torrents of a partial failure', () => {
    const hash = 'c'.repeat(40);

    expect(
      formatRemoveResult({
        ...completed,
        success: false,
        pendingInfohashes: [hash],
        steps: [
          { id: 'library', status: 'ok', message: 'title and files deleted' },
          {
            id: 'decypharr',
            status: 'failed',
            message: '1 torrent could not be deleted',
            details: [`${hash}: boom`],
            hint: 'Delete it from the Decypharr panel.',
          },
        ],
      }),
    ).toEqual([
      '✔ Radarr       title and files deleted',
      '✖ Decypharr    1 torrent could not be deleted',
      `   ↳ ${hash}: boom`,
      '   ↳ Delete it from the Decypharr panel.',
      '✖ The title was deleted from the library, but a later step failed.',
      `   ↳ Pending torrents: ${hash}`,
    ]);
  });

  it('says the title was not deleted when the library step fails', () => {
    expect(
      formatRemoveResult({
        ...completed,
        success: false,
        libraryDeleted: false,
        steps: [{ id: 'library', status: 'failed', message: 'boom', hint: 'Repeat it.' }],
      }),
    ).toEqual(['✖ Radarr       boom', '   ↳ Repeat it.', '✖ The title was not deleted.']);
  });
});

describe('formatRemoveCandidates', () => {
  it('lists the option that selects each candidate', () => {
    expect(
      formatRemoveCandidates('cosmos', [
        movie,
        { kind: 'series', id: 7, title: 'Cosmos', year: 1980, tvdbId: 72440 },
      ]),
    ).toEqual([
      '2 titles match "cosmos"; repeat the command with one of these options:',
      '  --movie 10331   Night of the Living Dead (1968) — movie',
      '  --series 72440  Cosmos (1980) — series',
    ]);
  });
});

describe('toRemoveJson', () => {
  it('serializes the plan and the result of every step', () => {
    expect(toRemoveJson(plan(), completed)).toEqual({
      success: true,
      executed: true,
      target: {
        kind: 'movie',
        id: 1,
        title: 'Night of the Living Dead',
        year: 1968,
        path: '/data/media/movies/Night of the Living Dead (1968)',
        tmdbId: 10331,
        tvdbId: null,
      },
      plan: {
        keepDebrid: false,
        torrents: [
          {
            infohash: 'c'.repeat(40),
            name: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GROUP',
          },
        ],
        kept: [],
      },
      steps: [
        { id: 'library', status: 'ok', message: 'title and files deleted', details: [] },
        {
          id: 'decypharr',
          status: 'ok',
          message: '1 torrent deleted from Real-Debrid',
          details: [],
        },
        { id: 'seerr', status: 'ok', message: 'record cleared', details: [] },
        { id: 'jellyfin', status: 'ok', message: 'library refresh requested', details: [] },
      ],
      pendingInfohashes: [],
    });
  });

  it('marks a plan that was not executed and carries the reason', () => {
    const json = toRemoveJson(plan(), undefined, 'Pass --yes to delete the title.');

    expect(json).toMatchObject({
      success: false,
      executed: false,
      error: 'Pass --yes to delete the title.',
      steps: [],
    });
  });
});

describe('toRemoveRefusedJson', () => {
  it('lists the candidates with their selector', () => {
    expect(toRemoveRefusedJson('Several titles match "x".', [movie])).toEqual({
      success: false,
      executed: false,
      error: 'Several titles match "x".',
      candidates: [
        {
          kind: 'movie',
          id: 1,
          title: 'Night of the Living Dead',
          year: 1968,
          path: '/data/media/movies/Night of the Living Dead (1968)',
          tmdbId: 10331,
          tvdbId: null,
          selector: '--movie 10331',
        },
      ],
    });
  });
});

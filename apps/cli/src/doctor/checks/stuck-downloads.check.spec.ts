import { describe, expect, it } from 'vitest';

import type { QueueRecord } from '@moody-blues/provisioner';

import { createStubArr, createTestContext, MINUTE_MS, TEST_NOW } from '../doctor-context.testing';
import { evaluateStuck, stuckDownloadsCheck } from './stuck-downloads.check';

const THRESHOLD = 10 * MINUTE_MS;

function record(overrides: Partial<QueueRecord> & { id: number }): QueueRecord {
  return {
    title: 'Big.Buck.Bunny.2008.1080p.BluRay.x264-GRP',
    trackedDownloadState: 'importPending',
    trackedDownloadStatus: 'ok',
    added: new Date(TEST_NOW - 34 * MINUTE_MS).toISOString(),
    ...overrides,
  };
}

const evaluate = (records: QueueRecord[]) =>
  evaluateStuck(records, { now: TEST_NOW, stuckAfterMs: THRESHOLD });

describe('evaluateStuck', () => {
  it.each(['importPending', 'importing', 'importBlocked', 'failed'])(
    'marks %s older than the threshold',
    (state) => {
      const { stuck } = evaluate([record({ id: 1, trackedDownloadState: state })]);

      expect(stuck).toEqual([expect.objectContaining({ queueId: 1, state, ageMinutes: 34 })]);
    },
  );

  it.each(['importPending', 'importing', 'importBlocked', 'failed'])(
    'does not mark %s younger than the threshold',
    (state) => {
      const added = new Date(TEST_NOW - 3 * MINUTE_MS).toISOString();

      expect(evaluate([record({ id: 1, trackedDownloadState: state, added })]).stuck).toEqual([]);
    },
  );

  it('marks an item exactly at the threshold', () => {
    const added = new Date(TEST_NOW - THRESHOLD).toISOString();

    expect(evaluate([record({ id: 1, added })]).stuck).toHaveLength(1);
  });

  it.each(['downloading', 'imported', 'failedPending', 'ignored'])(
    'never marks %s, however old',
    (state) => {
      const added = new Date(TEST_NOW - 6 * 60 * MINUTE_MS).toISOString();

      expect(evaluate([record({ id: 1, trackedDownloadState: state, added })])).toEqual({
        stuck: [],
        unknownAge: [],
      });
    },
  );

  it('reports an item in a stuck state whose age cannot be measured', () => {
    const { stuck, unknownAge } = evaluate([
      record({ id: 5, added: undefined }),
      record({ id: 6, added: 'not a date' }),
    ]);

    expect(stuck).toEqual([]);
    expect(unknownAge.map((item) => item.queueId)).toEqual([5, 6]);
  });

  it('takes the first status message and falls back to the error message', () => {
    const { stuck } = evaluate([
      record({
        id: 1,
        statusMessages: [
          { title: 'x', messages: [] },
          { title: 'y', messages: ['Unable to parse file', 'second'] },
        ],
      }),
      record({ id: 2, errorMessage: 'Import failed' }),
      record({ id: 3 }),
    ]);

    expect(stuck.map((item) => item.message)).toEqual([
      'Unable to parse file',
      'Import failed',
      undefined,
    ]);
  });

  it('cuts a long message to 200 characters', () => {
    const { stuck } = evaluate([record({ id: 1, errorMessage: 'x'.repeat(500) })]);

    expect(stuck[0]?.message).toHaveLength(200);
    expect(stuck[0]?.message?.endsWith('…')).toBe(true);
  });

  it('honours a different threshold', () => {
    const added = new Date(TEST_NOW - 3 * MINUTE_MS).toISOString();

    expect(
      evaluateStuck([record({ id: 1, added })], { now: TEST_NOW, stuckAfterMs: MINUTE_MS }).stuck,
    ).toHaveLength(1);
  });
});

describe('stuckDownloadsCheck', () => {
  it('fails with a fixable error for an importPending item of 34 minutes', async () => {
    const { ctx } = createTestContext({
      stubs: {
        radarr: createStubArr('6.4', [
          record({ id: 12, statusMessages: [{ messages: ['Unable to parse file'] }] }),
        ]),
      },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result).toMatchObject({
      status: 'error',
      message: '1 download has been stuck for more than 10 minutes',
      fixable: true,
      details: [
        'radarr #12 "Big.Buck.Bunny.2008.1080p.BluRay.x264-GRP" importPending for 34 min: Unable to parse file',
      ],
      suggestion:
        'Run "moody-blues doctor --fix" to remove it, blocklist the release and search for another one.',
    });
    expect(result.stuckItems).toEqual([
      expect.objectContaining({ app: 'radarr', queueId: 12, ageMinutes: 34 }),
    ]);
  });

  it('detects an item Sonarr could not match to a series', async () => {
    const { ctx } = createTestContext({
      stubs: {
        sonarr: createStubArr('4.0', [
          record({
            id: 5,
            seriesId: null,
            title: 'Some.Unknown.Show.S01.1080p-GRP',
            trackedDownloadState: 'importBlocked',
            trackedDownloadStatus: 'warning',
            statusMessages: [
              { messages: ['Unable to parse download, automatic import is not possible.'] },
            ],
          }),
        ]),
      },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details?.[0]).toContain(
      'sonarr #5 "Some.Unknown.Show.S01.1080p-GRP" importBlocked',
    );
    expect(result.stuckItems).toEqual([expect.objectContaining({ app: 'sonarr', queueId: 5 })]);
  });

  it('reports nothing for the same item with 3 minutes of age', async () => {
    const added = new Date(TEST_NOW - 3 * MINUTE_MS).toISOString();
    const { ctx } = createTestContext({
      stubs: { radarr: createStubArr('6.4', [record({ id: 12, added })]) },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.fixable).toBeUndefined();
  });

  it('keeps everything ok for a six hour download, an empty queue and a lone deleted-from-RD line', async () => {
    const sixHours = new Date(TEST_NOW - 6 * 60 * MINUTE_MS).toISOString();
    const { ctx } = createTestContext({
      storage: true,
      stubs: {
        sonarr: createStubArr('4.0', [
          record({ id: 1, trackedDownloadState: 'downloading', added: sixHours }),
        ]),
        radarr: createStubArr('6.4', []),
      },
      log: {
        text: '2026-10-09 11:59:00 | INFO  | [realdebrid] Torrent: ABC deleted from RD\n',
        modifiedAt: TEST_NOW,
      },
    });

    expect((await stuckDownloadsCheck.run(ctx)).status).toBe('ok');
  });

  it('lists ten lines and summarizes the rest', async () => {
    const records = Array.from({ length: 13 }, (_, index) => record({ id: index + 1 }));
    const { ctx } = createTestContext({ stubs: { radarr: createStubArr('6.4', records) } });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.message).toBe('13 downloads have been stuck for more than 10 minutes');
    expect(result.details).toHaveLength(11);
    expect(result.details?.at(-1)).toBe('and 3 more');
    expect(result.stuckItems).toHaveLength(13);
  });

  it('merges the queues of Sonarr and Radarr', async () => {
    const { ctx } = createTestContext({
      stubs: {
        sonarr: createStubArr('4.0', [record({ id: 3, title: 'Show.S01E01' })]),
        radarr: createStubArr('6.4', [record({ id: 9 })]),
      },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.stuckItems?.map((item) => `${item.app}#${item.queueId}`)).toEqual([
      'sonarr#3',
      'radarr#9',
    ]);
  });

  it('adds the re-insertion correlation when the log shows a loop', async () => {
    const line = '2026-10-09 11:58:00 | INFO  | [manager] Successfully re-inserted entry x';
    const { ctx } = createTestContext({
      storage: true,
      stubs: { radarr: createStubArr('6.4', [record({ id: 1 })]) },
      log: { text: `${line}\n${line}\n${line}\n`, modifiedAt: TEST_NOW },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.details).toContain(
      'Decypharr is re-inserting torrents (see decypharr-reinsertion)',
    );
  });

  it('warns when an app queue cannot be read', async () => {
    const radarr = createStubArr('6.4');
    radarr.on('GET', '/api/v3/queue', { status: 500, text: 'boom' });
    const { ctx } = createTestContext({ stubs: { radarr } });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details?.[0]).toContain('Could not read the queue of radarr');
  });

  it('still fails for a stuck item when the other app cannot be read', async () => {
    const radarr = createStubArr('6.4');
    radarr.on('GET', '/api/v3/queue', { status: 500, text: 'boom' });
    const { ctx } = createTestContext({
      stubs: { sonarr: createStubArr('4.0', [record({ id: 4 })]), radarr },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(
      result.details?.some((line) => line.includes('Could not read the queue of radarr')),
    ).toBe(true);
  });

  it('warns about an item whose age cannot be measured', async () => {
    const { ctx } = createTestContext({
      stubs: { radarr: createStubArr('6.4', [record({ id: 7, added: undefined })]) },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual([
      'Cannot measure the age of radarr #7 "Big.Buck.Bunny.2008.1080p.BluRay.x264-GRP"',
    ]);
  });

  it('only reads the app that is running', async () => {
    const { ctx, stubs } = createTestContext({
      services: { sonarr: { state: 'exited', health: 'none' } },
    });

    await stuckDownloadsCheck.run(ctx);

    expect(stubs.sonarr.requests).toEqual([]);
    expect(stubs.radarr.requests).toHaveLength(1);
  });

  it('is skipped when neither app is running', async () => {
    const { ctx } = createTestContext({
      services: {
        sonarr: { state: 'exited', health: 'none' },
        radarr: { state: 'exited', health: 'none' },
      },
    });

    expect((await stuckDownloadsCheck.run(ctx)).status).toBe('skipped');
  });

  it('respects a different threshold', async () => {
    const added = new Date(TEST_NOW - 3 * MINUTE_MS).toISOString();
    const { ctx } = createTestContext({
      stuckAfterMs: MINUTE_MS,
      stubs: { radarr: createStubArr('6.4', [record({ id: 12, added })]) },
    });

    const result = await stuckDownloadsCheck.run(ctx);

    expect(result.message).toBe('1 download has been stuck for more than 1 minute');
  });
});

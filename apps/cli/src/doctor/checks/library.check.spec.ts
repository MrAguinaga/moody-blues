import { describe, expect, it } from 'vitest';

import type { MissingEpisodeResource, QueueRecord } from '@moody-blues/provisioner';

import { createStubArr, createTestContext, MINUTE_MS, TEST_NOW } from '../doctor-context.testing';
import { evaluateLibrary, libraryCheck } from './library.check';

const DAY_MS = 24 * 60 * MINUTE_MS;

function episode(
  id: number,
  patch: Partial<MissingEpisodeResource> = {},
  series: Partial<NonNullable<MissingEpisodeResource['series']>> = {},
): MissingEpisodeResource {
  return {
    id,
    seriesId: 5,
    seasonNumber: 1,
    episodeNumber: id,
    monitored: true,
    hasFile: false,
    airDateUtc: new Date(TEST_NOW - 400 * DAY_MS).toISOString(),
    series: {
      id: 5,
      title: 'Azumanga Daioh',
      year: 2002,
      monitored: true,
      added: new Date(TEST_NOW - 3 * DAY_MS).toISOString(),
      ...series,
    },
    ...patch,
  };
}

function sonarrWith(missing: MissingEpisodeResource[], queue: QueueRecord[] = []) {
  const stub = createStubArr('4.0.20', queue);
  stub.on('GET', '/api/v3/wanted/missing', {
    body: { page: 1, pageSize: 200, totalRecords: missing.length, records: missing },
  });
  return stub;
}

describe('evaluateLibrary', () => {
  const now = { now: TEST_NOW };

  it('groups the missing episodes by series and season', () => {
    const result = evaluateLibrary(
      [episode(1), episode(2), episode(3, { seasonNumber: 2 })],
      new Set(),
      now,
    );

    expect(result).toEqual([
      {
        seriesId: 5,
        title: 'Azumanga Daioh',
        year: 2002,
        seasons: [
          { seasonNumber: 1, missing: 2 },
          { seasonNumber: 2, missing: 1 },
        ],
      },
    ]);
  });

  it('ignores a series that is still airing: its latest episodes are inside the grace period', () => {
    const aired = new Date(TEST_NOW - 3 * 60 * MINUTE_MS).toISOString();

    expect(evaluateLibrary([episode(1, { airDateUtc: aired })], new Set(), now)).toEqual([]);
  });

  it('ignores a series with a download in the queue', () => {
    expect(evaluateLibrary([episode(1)], new Set([5]), now)).toEqual([]);
  });

  it('ignores a series added less than an hour ago', () => {
    const added = new Date(TEST_NOW - 30 * MINUTE_MS).toISOString();

    expect(evaluateLibrary([episode(1, {}, { added })], new Set(), now)).toEqual([]);
  });

  it('ignores unmonitored series, specials and episodes without an air date', () => {
    expect(
      evaluateLibrary(
        [
          episode(1, {}, { monitored: false }),
          episode(2, { seasonNumber: 0 }),
          episode(3, { airDateUtc: undefined }),
          episode(4, { series: undefined }),
        ],
        new Set(),
        now,
      ),
    ).toEqual([]);
  });
});

describe('libraryCheck', () => {
  it('is ok when nothing is missing', async () => {
    const { ctx } = createTestContext({ stubs: { sonarr: sonarrWith([]) } });

    expect(await libraryCheck.run(ctx)).toEqual({
      status: 'ok',
      message: 'Every series has all of its aired episodes',
    });
  });

  it('warns about an incomplete series and points to the retry command', async () => {
    const { ctx } = createTestContext({ stubs: { sonarr: sonarrWith([episode(1), episode(2)]) } });

    const result = await libraryCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toBe(
      '1 series has aired episodes without a file and nothing downloading',
    );
    expect(result.details).toEqual(['Azumanga Daioh (2002) — season 1: 2 episodes without a file']);
    expect(result.suggestion).toContain('moody-blues retry "Azumanga Daioh"');
  });

  it('stays ok while the series has a download in the queue', async () => {
    const { ctx } = createTestContext({
      stubs: { sonarr: sonarrWith([episode(1)], [{ id: 1, seriesId: 5 }]) },
    });

    expect((await libraryCheck.run(ctx)).status).toBe('ok');
  });

  it('is skipped when Sonarr is not running', async () => {
    const { ctx } = createTestContext({ services: { sonarr: { state: 'exited' } } });

    expect((await libraryCheck.run(ctx)).status).toBe('skipped');
  });

  it('warns, never fails, when the library cannot be read', async () => {
    const stub = createStubArr('4.0.20');
    stub.on('GET', '/api/v3/wanted/missing', { status: 500, body: { message: 'boom' } });
    const { ctx } = createTestContext({ stubs: { sonarr: stub } });

    const result = await libraryCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toBe('The Sonarr library could not be read');
  });
});

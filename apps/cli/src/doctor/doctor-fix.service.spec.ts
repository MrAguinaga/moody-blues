import { describe, expect, it, vi } from 'vitest';

import { stuckDownloadsCheck } from './checks/stuck-downloads.check';
import type { DoctorResult, StuckItem } from './doctor.types';
import {
  createStubArr,
  createTestContext,
  MINUTE_MS,
  stubQueueDelete,
  TEST_NOW,
} from './doctor-context.testing';
import { applyFixes, buildFixPlan, describeFixPlan, unappliedOutcome } from './doctor-fix.service';

const item = (queueId: number, app: StuckItem['app'] = 'radarr'): StuckItem => ({
  app,
  queueId,
  title: `Movie ${queueId}`,
  state: 'importPending',
  ageMinutes: 34,
  message: 'Unable to parse file',
});

const stuckResult = (items: StuckItem[]): DoctorResult => ({
  id: 'stuck-downloads',
  name: 'Stuck downloads',
  status: 'error',
  message: 'stuck',
  stuckItems: items,
});

describe('buildFixPlan', () => {
  it('has no plan without stuck items', () => {
    expect(buildFixPlan([stuckResult([])])).toBeUndefined();
    expect(buildFixPlan([])).toBeUndefined();
  });

  it('keeps ten items and counts the rest as pending', () => {
    const plan = buildFixPlan([stuckResult(Array.from({ length: 14 }, (_, index) => item(index)))]);

    expect(plan?.items).toHaveLength(10);
    expect(plan?.pending).toBe(4);
  });

  it('keeps every item up to the limit', () => {
    const plan = buildFixPlan([stuckResult([item(1), item(2, 'sonarr')])]);

    expect(plan).toEqual({ items: [item(1), item(2, 'sonarr')], pending: 0 });
  });
});

describe('describeFixPlan', () => {
  it('lists each item and the pending remainder', () => {
    expect(describeFixPlan({ items: [item(12)], pending: 2 })).toEqual([
      'radarr #12 "Movie 12" importPending for 34 min: Unable to parse file',
      '2 more will remain; run the command again to handle them',
    ]);
  });
});

describe('unappliedOutcome', () => {
  it('describes a plan that was not applied', () => {
    expect(unappliedOutcome({ items: [item(12)], pending: 0 }, 4, 'declined')).toEqual({
      id: 'remove-stuck-downloads',
      applied: false,
      removed: 0,
      failed: [],
      items: ['radarr #12'],
      pending: 0,
      reinsertionsBefore: 4,
      reinsertionsAfter: 4,
      loopStopped: false,
      note: 'declined',
    });
  });
});

describe('applyFixes', () => {
  function setup(statuses: Record<number, number>) {
    const sonarr = createStubArr('4.0');
    const radarr = createStubArr('6.4');
    for (const [id, status] of Object.entries(statuses)) {
      stubQueueDelete(radarr, Number(id), status);
    }
    const { ctx } = createTestContext({ stubs: { sonarr, radarr } });
    const settle = vi.fn(async () => undefined);
    return {
      sonarr,
      radarr,
      settle,
      deps: {
        clients: ctx.clients,
        reinsertionsBefore: 0,
        settle,
        countReinsertions: async () => 0,
        redact: ctx.redact,
      },
    };
  }

  it('issues only DELETE /api/v3/queue/{id} with the two parameters, one item at a time', async () => {
    const { radarr, sonarr, deps } = setup({ 1: 200, 2: 200 });

    await applyFixes({ items: [item(1), item(2)], pending: 0 }, deps);

    expect(radarr.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'DELETE /api/v3/queue/1',
      'DELETE /api/v3/queue/2',
    ]);
    expect(radarr.requests.map((request) => request.query)).toEqual([
      { removeFromClient: 'true', blocklist: 'true' },
      { removeFromClient: 'true', blocklist: 'true' },
    ]);
    expect(sonarr.requests).toEqual([]);
  });

  it('removes an item without a series found by the check', async () => {
    const sonarr = createStubArr('4.0', [
      {
        id: 5,
        title: 'Some.Unknown.Show.S01.1080p-GRP',
        seriesId: null,
        trackedDownloadState: 'importBlocked',
        added: new Date(TEST_NOW - 34 * MINUTE_MS).toISOString(),
      },
    ]);
    stubQueueDelete(sonarr, 5);
    const { ctx } = createTestContext({ stubs: { sonarr } });
    const scan = await stuckDownloadsCheck.run(ctx);
    const plan = buildFixPlan([{ id: 'stuck-downloads', name: 'Stuck downloads', ...scan }]);

    const outcome = await applyFixes(plan!, {
      clients: ctx.clients,
      reinsertionsBefore: 0,
      settle: async () => undefined,
      countReinsertions: async () => 0,
      redact: ctx.redact,
    });

    expect(outcome.items).toEqual(['sonarr #5']);
    expect(sonarr.queue).toEqual([]);
  });

  it('routes each item to its own app', async () => {
    const { sonarr, radarr, deps } = setup({ 1: 200 });
    stubQueueDelete(sonarr, 7);

    await applyFixes({ items: [item(1), item(7, 'sonarr')], pending: 0 }, deps);

    expect(sonarr.requests.map((request) => request.path)).toEqual(['/api/v3/queue/7']);
    expect(radarr.requests.map((request) => request.path)).toEqual(['/api/v3/queue/1']);
  });

  it('waits 30 seconds only after something was removed', async () => {
    const removed = setup({ 1: 200 });
    await applyFixes({ items: [item(1)], pending: 0 }, removed.deps);
    const rejected = setup({ 1: 404 });
    await applyFixes({ items: [item(1)], pending: 0 }, rejected.deps);

    expect(removed.settle).toHaveBeenCalledWith(30_000);
    expect(rejected.settle).not.toHaveBeenCalled();
  });

  it('records a rejected removal without aborting the others and does not retry it', async () => {
    const { radarr, deps } = setup({ 1: 404, 2: 200 });

    const outcome = await applyFixes({ items: [item(1), item(2)], pending: 0 }, deps);

    expect(radarr.requests).toHaveLength(2);
    expect(outcome).toMatchObject({ applied: true, removed: 1, items: ['radarr #2'] });
    expect(outcome.failed).toEqual([expect.stringContaining('radarr #1')]);
  });

  it('redacts secrets in the failures', async () => {
    const { radarr, deps } = setup({});
    radarr.on('DELETE', '/api/v3/queue/1', new Error('connection reset with radarr-secret-key'));

    const outcome = await applyFixes({ items: [item(1)], pending: 0 }, deps);

    expect(outcome.failed.join('\n')).not.toContain('radarr-secret-key');
    expect(outcome.applied).toBe(false);
  });

  it('compares the re-insertions before and after', async () => {
    const stopped = setup({ 1: 200 });
    const growing = setup({ 1: 200 });

    const first = await applyFixes(
      { items: [item(1)], pending: 0 },
      { ...stopped.deps, reinsertionsBefore: 4, countReinsertions: async () => 4 },
    );
    const second = await applyFixes(
      { items: [item(1)], pending: 0 },
      { ...growing.deps, reinsertionsBefore: 4, countReinsertions: async () => 7 },
    );

    expect(first).toMatchObject({ reinsertionsBefore: 4, reinsertionsAfter: 4, loopStopped: true });
    expect(second).toMatchObject({ reinsertionsAfter: 7, loopStopped: false });
  });
});

import { describe, expect, it } from 'vitest';

import { buildDoctorChecks, DOCTOR_CHECKS } from './checks';
import { runDoctor, summarize } from './doctor.runner';
import type { DoctorCheck, DoctorCheckId, DoctorOutcome, FixDecision } from './doctor.types';
import {
  createStubArr,
  createTestContext,
  MINUTE_MS,
  stubQueueDelete,
  TEST_KEYS,
  TEST_NOW,
} from './doctor-context.testing';

const NEVER = () => new Promise<void>(() => undefined);

const fake = (id: DoctorCheckId, run: () => Promise<DoctorOutcome>): DoctorCheck => ({
  id,
  name: `Check ${id}`,
  run,
});

const ok = (message = 'fine'): DoctorOutcome => ({ status: 'ok', message });

describe('summarize', () => {
  it('counts every status', () => {
    expect(
      summarize([{ status: 'ok' }, { status: 'ok' }, { status: 'error' }, { status: 'skipped' }]),
    ).toEqual({ ok: 2, warning: 0, error: 1, skipped: 1 });
  });
});

describe('the registry of checks', () => {
  it('lists the 22 checks in the documented order', () => {
    expect(DOCTOR_CHECKS.map((check) => check.id)).toEqual([
      'docker-daemon',
      'docker-compose',
      'ports-availability',
      'fuse',
      'transcoding',
      'dns',
      'disk-space',
      'containers',
      'api-sonarr',
      'api-radarr',
      'api-prowlarr',
      'api-bazarr',
      'api-jellyfin',
      'api-seerr',
      'decypharr-config',
      'decypharr-link',
      'debrid-mount',
      'realdebrid-token',
      'stuck-downloads',
      'decypharr-reinsertion',
      'library',
      'bazarr-providers',
      'jellyfin-policy',
    ]);
  });

  it('adds the Real-Debrid account check after the token check only on request', () => {
    const ids = buildDoctorChecks({ realDebrid: true }).map((check) => check.id);

    expect(ids).toHaveLength(24);
    expect(ids.indexOf('realdebrid-account')).toBe(ids.indexOf('realdebrid-token') + 1);
    expect(buildDoctorChecks().map((check) => check.id)).not.toContain('realdebrid-account');
  });
});

describe('runDoctor', () => {
  it('runs the checks in order and reports each one as it finishes', async () => {
    const { ctx } = createTestContext();
    const seen: string[] = [];

    const report = await runDoctor({
      ctx,
      checks: [
        fake('dns', async () => ok()),
        fake('fuse', async () => ({ status: 'skipped', message: 'n/a' })),
      ],
      sleep: NEVER,
      onResult: (result) => seen.push(result.id),
    });

    expect(seen).toEqual(['dns', 'fuse']);
    expect(report.checks.map((check) => check.name)).toEqual(['Check dns', 'Check fuse']);
    expect(report).toMatchObject({
      version: '9.9.9',
      home: '/mb-test',
      success: true,
      counts: { ok: 1, warning: 0, error: 0, skipped: 1 },
      fixes: [],
    });
  });

  it('turns a check that throws into an error without losing the others', async () => {
    const { ctx } = createTestContext();

    const report = await runDoctor({
      ctx,
      checks: [
        fake('dns', async () => {
          throw new Error('boom');
        }),
        fake('fuse', async () => ok()),
      ],
      sleep: NEVER,
    });

    expect(report.checks[0]).toMatchObject({
      status: 'error',
      message: 'The check failed unexpectedly: boom',
    });
    expect(report.checks[1]?.status).toBe('ok');
    expect(report.success).toBe(false);
  });

  it('turns a check that never answers into a timed out error', async () => {
    const { ctx } = createTestContext();

    const report = await runDoctor({
      ctx,
      checks: [
        fake('dns', () => new Promise<DoctorOutcome>(() => undefined)),
        fake('fuse', async () => ok()),
      ],
      sleep: async () => undefined,
      checkTimeoutMs: 10_000,
    });

    expect(report.checks[0]).toMatchObject({
      status: 'error',
      message: 'The check timed out after 10 s',
    });
  });

  it('stops running checks once the signal is aborted', async () => {
    const controller = new AbortController();
    const { ctx } = createTestContext();
    const aborted = { ...ctx, signal: controller.signal };

    const report = await runDoctor({
      ctx: aborted,
      checks: [
        fake('dns', async () => {
          controller.abort();
          return ok();
        }),
        fake('fuse', async () => ok()),
      ],
      sleep: NEVER,
    });

    expect(report.checks.map((check) => check.id)).toEqual(['dns']);
  });

  it('redacts every known secret from messages, details and suggestions', async () => {
    const { ctx } = createTestContext();
    const checks = Object.values(TEST_KEYS).map((secret, index) =>
      fake(DOCTOR_CHECKS[index]?.id as DoctorCheckId, async () => ({
        status: 'error',
        message: `failed with ${secret}`,
        details: [`header X-Api-Key ${secret}`],
        suggestion: `retry with ${secret}`,
      })),
    );

    const report = await runDoctor({ ctx, checks, sleep: NEVER });

    const text = JSON.stringify(report);
    for (const secret of Object.values(TEST_KEYS)) {
      expect(text).not.toContain(secret);
    }
    expect(report.checks[0]?.message).toBe('failed with ***');
  });

  it('redacts the secrets of an unexpected exception', async () => {
    const { ctx } = createTestContext();

    const report = await runDoctor({
      ctx,
      checks: [
        fake('dns', async () => {
          throw new Error(`GET failed with ${TEST_KEYS.sonarr}`);
        }),
      ],
      sleep: NEVER,
    });

    expect(JSON.stringify(report)).not.toContain(TEST_KEYS.sonarr);
  });

  it('skips the service checks by dependency when Docker does not report the stack', async () => {
    const { ctx, stubs } = createTestContext({ stack: new Error('docker is down') });

    const report = await runDoctor({ ctx, checks: DOCTOR_CHECKS.slice(7), sleep: NEVER });

    const status = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    expect(status).toMatchObject({
      containers: 'error',
      'api-sonarr': 'skipped',
      'api-radarr': 'skipped',
      'api-prowlarr': 'skipped',
      'api-bazarr': 'skipped',
      'api-jellyfin': 'skipped',
      'api-seerr': 'skipped',
      'stuck-downloads': 'skipped',
      'bazarr-providers': 'skipped',
    });
    expect(stubs.sonarr.requests).toEqual([]);
  });

  it('emits no write request to any service without --fix', async () => {
    const stuck = {
      id: 12,
      title: 'Movie',
      trackedDownloadState: 'importPending',
      added: new Date(TEST_NOW - 34 * MINUTE_MS).toISOString(),
    };
    const { ctx, stubs } = createTestContext({
      stubs: { radarr: createStubArr('6.4', [stuck]) },
    });

    const report = await runDoctor({ ctx, checks: DOCTOR_CHECKS.slice(7), sleep: NEVER });

    expect(report.checks.find((check) => check.id === 'stuck-downloads')?.status).toBe('error');
    for (const stub of Object.values(stubs)) {
      expect(stub.writes()).toEqual([]);
    }
  });
});

describe('runDoctor with the fix', () => {
  const stuckItem = (id: number) => ({
    id,
    title: `Movie ${id}`,
    trackedDownloadState: 'importPending',
    trackedDownloadStatus: 'warning',
    added: new Date(TEST_NOW - 34 * MINUTE_MS).toISOString(),
  });
  const checks = DOCTOR_CHECKS.filter((check) =>
    ['stuck-downloads', 'decypharr-reinsertion'].includes(check.id),
  );
  const reinsertionLine =
    '2026-10-09 11:59:00 | INFO  | [manager] Successfully re-inserted entry x';

  function scenario(ids: number[], options: { failing?: number[] } = {}) {
    const radarr = createStubArr('6.4', ids.map(stuckItem));
    for (const id of ids) {
      stubQueueDelete(radarr, id, options.failing?.includes(id) ? 404 : 200);
    }
    const settled: number[] = [];
    const decisions: FixDecision[] = [];
    return { radarr, settled, decisions };
  }

  function options(decision: FixDecision, state: ReturnType<typeof scenario>) {
    return {
      sleep: NEVER,
      settle: async (ms: number) => {
        state.settled.push(ms);
      },
      fix: {
        confirm: async () => {
          state.decisions.push(decision);
          return decision;
        },
      },
    };
  }

  it('removes the planned items with exactly the two documented parameters and checks again', async () => {
    const state = scenario([12]);
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    const report = await runDoctor({ ctx, checks, ...options('approved', state) });

    expect(state.radarr.writes()).toEqual([
      expect.objectContaining({
        method: 'DELETE',
        path: '/api/v3/queue/12',
        query: { removeFromClient: 'true', blocklist: 'true' },
      }),
    ]);
    expect(state.settled).toEqual([30_000]);
    expect(report.checks.find((check) => check.id === 'stuck-downloads')?.status).toBe('ok');
    expect(report.fixes).toEqual([
      {
        id: 'remove-stuck-downloads',
        applied: true,
        removed: 1,
        failed: [],
        items: ['radarr #12'],
        pending: 0,
        reinsertionsBefore: 0,
        reinsertionsAfter: 0,
        loopStopped: true,
      },
    ]);
    expect(report.success).toBe(true);
  });

  it('applies nothing when the confirmation is unavailable', async () => {
    const state = scenario([12]);
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    const report = await runDoctor({ ctx, checks, ...options('unavailable', state) });

    expect(state.radarr.writes()).toEqual([]);
    expect(state.settled).toEqual([]);
    expect(report.fixes[0]).toMatchObject({
      applied: false,
      removed: 0,
      items: ['radarr #12'],
      pending: 0,
      note: 'Confirmation is required: pass --yes to apply the fix without a terminal.',
    });
    expect(report.checks.find((check) => check.id === 'stuck-downloads')?.status).toBe('error');
    expect(report.success).toBe(false);
  });

  it('applies nothing when the user declines', async () => {
    const state = scenario([12]);
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    const report = await runDoctor({ ctx, checks, ...options('declined', state) });

    expect(state.radarr.writes()).toEqual([]);
    expect(report.fixes[0]?.note).toBe('The fix was declined.');
    expect(report.success).toBe(false);
  });

  it('does not ask for confirmation when nothing is stuck', async () => {
    const state = scenario([]);
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    const report = await runDoctor({ ctx, checks, ...options('approved', state) });

    expect(state.decisions).toEqual([]);
    expect(report.fixes).toEqual([]);
    expect(report.success).toBe(true);
  });

  it('removes at most ten items and leaves the rest pending', async () => {
    const ids = Array.from({ length: 13 }, (_, index) => index + 1);
    const state = scenario(ids);
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    const report = await runDoctor({ ctx, checks, ...options('approved', state) });

    expect(state.radarr.writes()).toHaveLength(10);
    expect(report.fixes[0]).toMatchObject({ removed: 10, pending: 3 });
    const stuck = report.checks.find((check) => check.id === 'stuck-downloads');
    expect(stuck?.status).toBe('error');
    expect(stuck?.message).toContain('3 downloads');
    expect(report.success).toBe(false);
  });

  it('keeps going when one removal is rejected', async () => {
    const state = scenario([1, 2, 3], { failing: [2] });
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    const report = await runDoctor({ ctx, checks, ...options('approved', state) });

    expect(state.radarr.writes().map((request) => request.path)).toEqual([
      '/api/v3/queue/1',
      '/api/v3/queue/2',
      '/api/v3/queue/3',
    ]);
    expect(report.fixes[0]).toMatchObject({ removed: 2, items: ['radarr #1', 'radarr #3'] });
    expect(report.fixes[0]?.failed).toHaveLength(1);
    expect(report.fixes[0]?.failed[0]).toContain('radarr #2');
    expect(report.success).toBe(false);
  });

  it('never touches an item that was not in the confirmed plan', async () => {
    const state = scenario([12]);
    const { ctx } = createTestContext({ stubs: { radarr: state.radarr } });

    await runDoctor({
      ctx,
      checks,
      sleep: NEVER,
      settle: async () => undefined,
      fix: {
        confirm: async () => {
          state.radarr.queue.push(stuckItem(99));
          stubQueueDelete(state.radarr, 99);
          return 'approved';
        },
      },
    });

    expect(state.radarr.writes().map((request) => request.path)).toEqual(['/api/v3/queue/12']);
    expect(state.radarr.queue.map((record) => record.id)).toEqual([99]);
  });

  it('reports a re-insertion loop that keeps growing and fails', async () => {
    const state = scenario([12]);
    const lines = [reinsertionLine, reinsertionLine];
    const { ctx } = createTestContext({
      storage: true,
      stubs: { radarr: state.radarr },
      log: () => ({ text: lines.join('\n'), modifiedAt: TEST_NOW }),
    });
    const grow = async () => {
      lines.push(reinsertionLine, reinsertionLine, reinsertionLine);
    };

    const report = await runDoctor({
      ctx,
      checks,
      sleep: NEVER,
      settle: grow,
      fix: { confirm: async () => 'approved' },
    });

    expect(report.fixes[0]).toMatchObject({
      reinsertionsBefore: 2,
      reinsertionsAfter: 5,
      loopStopped: false,
    });
    expect(report.success).toBe(false);
  });

  it('succeeds when the re-insertions stop', async () => {
    const state = scenario([12]);
    const { ctx } = createTestContext({
      storage: true,
      stubs: { radarr: state.radarr },
      log: () => ({ text: `${reinsertionLine}\n${reinsertionLine}\n`, modifiedAt: TEST_NOW }),
    });

    const report = await runDoctor({ ctx, checks, ...options('approved', state) });

    expect(report.fixes[0]).toMatchObject({
      reinsertionsBefore: 2,
      reinsertionsAfter: 2,
      loopStopped: true,
    });
    expect(report.success).toBe(true);
  });
});

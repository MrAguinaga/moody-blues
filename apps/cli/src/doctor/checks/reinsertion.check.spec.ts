import { describe, expect, it } from 'vitest';

import { createTestContext, TEST_NOW } from '../doctor-context.testing';
import { reinsertionCheck } from './reinsertion.check';

const line = (time: string) =>
  `2026-10-09 ${time} | INFO  | [manager] Successfully re-inserted entry debrid=realdebrid infohash=abc name=Movie`;

const logOf = (...lines: string[]) => ({ text: `${lines.join('\n')}\n`, modifiedAt: TEST_NOW });

describe('reinsertionCheck', () => {
  it('is skipped without the storage profile and does not read the log', async () => {
    const { ctx, logReads } = createTestContext({ storage: false });

    expect((await reinsertionCheck.run(ctx)).status).toBe('skipped');
    expect(logReads).toEqual([]);
  });

  it('is ok below three re-insertions in the window', async () => {
    const { ctx } = createTestContext({
      storage: true,
      log: logOf(line('11:50:00'), line('11:59:00')),
    });

    expect(await reinsertionCheck.run(ctx)).toEqual({
      status: 'ok',
      message: '2 re-insertions in the last 15 minutes',
    });
  });

  it('warns with three or more re-insertions in the window', async () => {
    const { ctx } = createTestContext({
      storage: true,
      log: logOf(line('11:50:00'), line('11:55:00'), line('11:59:00')),
    });

    const result = await reinsertionCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toBe('3 re-insertions in the last 15 minutes');
    expect(result.details).toEqual(['Last re-insertion at 2026-10-09T11:59:00.000Z']);
    expect(result.suggestion).toContain('moody-blues logs decypharr');
    expect(result.suggestion).toContain('decypharr.log');
  });

  it('does not count old re-insertions', async () => {
    const { ctx } = createTestContext({
      storage: true,
      log: logOf(line('09:00:00'), line('09:01:00'), line('09:02:00')),
    });

    expect((await reinsertionCheck.run(ctx)).status).toBe('ok');
  });

  it('never counts the deleted-from-RD lines on their own', async () => {
    const deleted = (time: string) =>
      `2026-10-09 ${time} | INFO  | [realdebrid] Torrent: ABC deleted from RD`;
    const { ctx } = createTestContext({
      storage: true,
      log: logOf(
        deleted('11:57:00'),
        deleted('11:58:00'),
        deleted('11:59:00'),
        deleted('11:59:30'),
      ),
    });

    expect(await reinsertionCheck.run(ctx)).toEqual({
      status: 'ok',
      message: '0 re-insertions in the last 15 minutes',
    });
  });

  it('warns, never fails, when the log cannot be read', async () => {
    const { ctx } = createTestContext({
      storage: true,
      log: Object.assign(new Error('denied'), { code: 'EACCES' }),
    });

    const result = await reinsertionCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['/mb-test/config/decypharr/logs/decypharr.log: EACCES']);
  });

  it('warns when the log does not exist', async () => {
    const { ctx } = createTestContext({ storage: true });

    expect((await reinsertionCheck.run(ctx)).status).toBe('warning');
  });
});

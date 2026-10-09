import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MINUTE_MS, TEST_NOW } from './doctor-context.testing';
import {
  isRealDebridAuthRejection,
  parseLineTimestamp,
  readLogTail,
  scanAuthRejections,
  scanReinsertions,
} from './doctor-log.utils';

const WINDOW_MS = 15 * MINUTE_MS;

function options(overrides: Partial<Parameters<typeof scanReinsertions>[1]> = {}) {
  return {
    now: TEST_NOW,
    windowMs: WINDOW_MS,
    fileModifiedAt: TEST_NOW,
    timeZone: 'UTC',
    ...overrides,
  };
}

const reinsertion = (time: string) =>
  `2026-10-09 ${time} | INFO  | [manager] Successfully re-inserted entry debrid=realdebrid infohash=abc name=Movie`;

describe('parseLineTimestamp', () => {
  it('reads a naive timestamp in the given time zone', () => {
    expect(parseLineTimestamp('2026-10-09 06:00:00 | INFO | x', 'America/Mexico_City')).toBe(
      Date.parse('2026-10-09T12:00:00.000Z'),
    );
  });

  it('honours an explicit offset and ignores the zone', () => {
    expect(parseLineTimestamp('2026-10-09T12:00:00.250Z INFO', 'America/Mexico_City')).toBe(
      Date.parse('2026-10-09T12:00:00.250Z'),
    );
    expect(parseLineTimestamp('2026-10-09T08:00:00-04:00 INFO', 'UTC')).toBe(
      Date.parse('2026-10-09T12:00:00.000Z'),
    );
  });

  it('falls back to the local zone for an unknown zone name', () => {
    const local = new Date(2026, 9, 9, 12, 0, 0).getTime();

    expect(parseLineTimestamp('2026-10-09 12:00:00 INFO', 'Not/AZone')).toBe(local);
  });

  it('returns nothing for a line without a timestamp', () => {
    expect(parseLineTimestamp('rclone: something happened', 'UTC')).toBeUndefined();
  });
});

describe('scanReinsertions', () => {
  it('counts the re-insertions inside the window and reports the last one', () => {
    const log = [
      reinsertion('11:30:00'),
      reinsertion('11:50:10'),
      reinsertion('11:55:00'),
      reinsertion('11:58:30'),
    ].join('\n');

    expect(scanReinsertions(log, options())).toEqual({
      count: 3,
      lastAt: '2026-10-09T11:58:30.000Z',
    });
  });

  it('does not count a line that only reports a torrent deleted from Real-Debrid', () => {
    const log = [
      '2026-10-09 11:59:00 | INFO  | [realdebrid] Torrent: ABC123 deleted from RD',
      '2026-10-09 11:59:30 | INFO  | [realdebrid] Torrent: DEF456 deleted from RD',
      '2026-10-09 11:59:40 | INFO  | [realdebrid] Torrent: GHI789 deleted from RD',
    ].join('\n');

    expect(scanReinsertions(log, options()).count).toBe(0);
  });

  it('counts a line without a timestamp only while the file was modified inside the window', () => {
    const log = 'Successfully re-inserted entry debrid=realdebrid';

    expect(scanReinsertions(log, options({ fileModifiedAt: TEST_NOW - MINUTE_MS })).count).toBe(1);
    expect(
      scanReinsertions(log, options({ fileModifiedAt: TEST_NOW - 20 * MINUTE_MS })).count,
    ).toBe(0);
  });

  it('reads the timestamps in the zone of the installation', () => {
    const log = reinsertion('06:00:00');

    expect(scanReinsertions(log, options({ timeZone: 'America/Mexico_City' })).count).toBe(1);
    expect(scanReinsertions(log, options({ timeZone: 'UTC' })).count).toBe(0);
  });
});

describe('scanAuthRejections', () => {
  it.each([
    '2026-10-09 11:59:00 | ERROR | [realdebrid] bad_token',
    '2026-10-09 11:59:00 | ERROR | [realdebrid] invalid token for the account',
    '2026-10-09 11:59:00 | ERROR | [realdebrid] 401 Unauthorized',
    '2026-10-09 11:59:00 | ERROR | [realdebrid] permission_denied',
    '2026-10-09 11:59:00 | ERROR | [realdebrid] account_locked',
    '2026-10-09 11:59:00 | ERROR | [realdebrid] disabled_account',
  ])('flags %s', (line) => {
    expect(scanAuthRejections(line, options()).count).toBe(1);
  });

  it.each([
    '2026-10-09 11:59:00 | WARN  | [realdebrid] 404 torrent_not_cached',
    '2026-10-09 11:59:00 | WARN  | [realdebrid] 451 torrent_blocked UnavailableForLegalReasons',
    '2026-10-09 11:59:00 | INFO  | [realdebrid] Torrent: 4012345 deleted from RD',
    '2026-10-09 11:59:00 | ERROR | [sonarr] 401 Unauthorized',
  ])('does not flag %s', (line) => {
    expect(scanAuthRejections(line, options()).count).toBe(0);
    expect(isRealDebridAuthRejection(line)).toBe(false);
  });

  it('ignores a rejection older than the window', () => {
    const line = '2026-10-09 10:00:00 | ERROR | [realdebrid] bad_token';

    expect(scanAuthRejections(line, options()).count).toBe(0);
  });
});

describe('readLogTail', () => {
  const created: string[] = [];

  afterEach(() => {
    created.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  });

  function tempFile(content: string): string {
    const directory = mkdtempSync(join(tmpdir(), 'doctor-log-'));
    created.push(directory);
    const path = join(directory, 'decypharr.log');
    writeFileSync(path, content);
    return path;
  }

  it('returns the whole file when it fits and its modification time', async () => {
    const path = tempFile('first\nsecond\n');
    utimesSync(path, new Date('2026-10-09T12:00:00Z'), new Date('2026-10-09T12:00:00Z'));

    const tail = await readLogTail(path, 1024);

    expect(tail.text).toBe('first\nsecond\n');
    expect(tail.modifiedAt).toBe(Date.parse('2026-10-09T12:00:00Z'));
  });

  it('returns only the last bytes and drops the line it cut in half', async () => {
    const path = tempFile('aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n');

    const tail = await readLogTail(path, 16);

    expect(tail.text).toBe('cccccccccc\n');
  });

  it('rejects when the file does not exist', async () => {
    await expect(readLogTail('/nonexistent/decypharr.log', 16)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

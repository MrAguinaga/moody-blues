import { describe, expect, it } from 'vitest';

import { findRejectionReason, scanPackHealth } from './retry.verify';

const HASH = 'c610ad37c610ad37c610ad37c610ad37c610ad37';
const SINCE = Date.parse('2026-10-09T12:00:00.000Z');
const NAME = '[man] Azumanga Daioh [BD 1080p HEVC FLAC]';

const reinserted = (time: string, hash = HASH) =>
  `2026-10-09 ${time} | INFO  | [manager] Successfully re-inserted entry debrid=realdebrid infohash=${hash} name=x`;
const bad = (time: string, name = NAME) =>
  `2026-10-09 ${time} | WARN  | [repair] can't repair ${name} since it's been marked as bad`;
const logOf = (...lines: string[]) => ({ text: `${lines.join('\n')}\n`, modifiedAt: SINCE });
const query = {
  infohash: HASH.toUpperCase(),
  names: [NAME, 'Azumanga Daioh'],
  since: SINCE,
  timeZone: 'UTC',
};

describe('scanPackHealth', () => {
  it('is healthy without a re-insertion or a bad mark', () => {
    expect(scanPackHealth(logOf(), query)).toEqual({ reinsertions: 0, markedBad: false });
  });

  it('counts the re-insertions of this infohash after the grab', () => {
    const log = logOf(
      reinserted('12:00:10'),
      reinserted('12:00:15', HASH.toUpperCase()),
      reinserted('12:00:20', 'ffff'),
    );

    expect(scanPackHealth(log, query).reinsertions).toBe(2);
  });

  it('ignores re-insertions from before the grab', () => {
    expect(scanPackHealth(logOf(reinserted('11:40:00')), query).reinsertions).toBe(0);
  });

  it('detects the bad mark by torrent name', () => {
    expect(scanPackHealth(logOf(bad('12:09:00')), query).markedBad).toBe(true);
    expect(scanPackHealth(logOf(bad('12:09:00', 'Other show')), query).markedBad).toBe(false);
  });

  it('counts a line without a timestamp when the log was written after the grab', () => {
    const log = {
      text: `Successfully re-inserted entry infohash=${HASH}\n`,
      modifiedAt: SINCE + 1000,
    };

    expect(scanPackHealth(log, query).reinsertions).toBe(1);
  });
});

describe('findRejectionReason', () => {
  const failure = (time: string, reason: string) =>
    `2026-10-09 ${time} | ERROR | [qbit] failed to submit torrent to debrid: ${reason}`;

  it('returns the reason of the last submission failure after the grab', () => {
    const log = logOf(
      failure('11:00:00', 'old'),
      failure('12:00:03', 'torrent 1 has error status: error'),
    );

    expect(findRejectionReason(log, SINCE, 'UTC')).toBe('torrent 1 has error status: error');
  });

  it('returns nothing when the log has no failure since the grab', () => {
    expect(findRejectionReason(logOf(failure('11:00:00', 'old')), SINCE, 'UTC')).toBeUndefined();
  });

  it('shortens a very long reason', () => {
    const reason = findRejectionReason(logOf(failure('12:00:03', 'x'.repeat(400))), SINCE, 'UTC');

    expect(reason).toHaveLength(160);
    expect(reason?.endsWith('…')).toBe(true);
  });
});

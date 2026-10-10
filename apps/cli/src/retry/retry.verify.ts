import { REINSERTION_MARKER } from '../doctor/doctor.constants';
import { parseLineTimestamp } from '../doctor/doctor-log.utils';
import type { RetryLog } from './retry.types';

const MARKED_BAD = "since it's been marked as bad";
const SUBMISSION_FAILURE = 'failed to submit torrent to debrid';
const MAX_REASON_LENGTH = 160;
const CLOCK_SLACK_MS = 5_000;

export interface PackHealthQuery {
  infohash: string;
  names: readonly string[];
  since: number;
  timeZone?: string;
}

export interface PackHealth {
  reinsertions: number;
  markedBad: boolean;
}

function recentLines(log: RetryLog, since: number, timeZone: string | undefined): string[] {
  return log.text.split('\n').filter((line) => {
    const timestamp = parseLineTimestamp(line, timeZone) ?? log.modifiedAt;
    return timestamp >= since - CLOCK_SLACK_MS;
  });
}

export function scanPackHealth(log: RetryLog, query: PackHealthQuery): PackHealth {
  const infohash = query.infohash.toLowerCase();
  const names = query.names.filter((name) => name !== '').map((name) => name.toLowerCase());
  let reinsertions = 0;
  let markedBad = false;

  for (const line of recentLines(log, query.since, query.timeZone)) {
    const text = line.toLowerCase();
    if (line.includes(REINSERTION_MARKER) && text.includes(`infohash=${infohash}`)) {
      reinsertions += 1;
    }
    if (
      line.includes(MARKED_BAD) &&
      (text.includes(infohash) || names.some((name) => text.includes(name)))
    ) {
      markedBad = true;
    }
  }
  return { reinsertions, markedBad };
}

export function findRejectionReason(
  log: RetryLog,
  since: number,
  timeZone?: string,
): string | undefined {
  const lines = recentLines(log, since, timeZone).filter((line) =>
    line.includes(SUBMISSION_FAILURE),
  );
  const last = lines.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const reason = last
    .slice(last.indexOf(SUBMISSION_FAILURE) + SUBMISSION_FAILURE.length)
    .replace(/^[\s:]+/, '')
    .trim();
  return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…` : reason;
}

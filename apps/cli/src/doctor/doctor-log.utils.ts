import { open } from 'node:fs/promises';

import {
  LOG_TAIL_BYTES,
  RD_AUTH_REJECTION_PATTERNS,
  REINSERTION_MARKER,
  REINSERTION_WINDOW_MS,
} from './doctor.constants';
import type { DoctorContext, LogTail } from './doctor.types';

const LINE_TIMESTAMP =
  /^\s*\[?(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,3})\d*)?(Z|[+-]\d{2}:?\d{2})?/;
const PROVIDER_MARKER = /realdebrid/i;

export interface LogScanOptions {
  now: number;
  windowMs: number;
  fileModifiedAt: number;
  timeZone?: string;
}

export interface LogScan {
  count: number;
  lastAt?: string;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(timeZone)) {
    try {
      formatters.set(
        timeZone,
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    } catch {
      formatters.set(timeZone, null);
    }
  }
  return formatters.get(timeZone) ?? null;
}

function zoneOffsetMs(formatter: Intl.DateTimeFormat, utcMs: number): number {
  const parts = formatter.formatToParts(new Date(utcMs));
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return wallClockAsUtc - Math.floor(utcMs / 1000) * 1000;
}

function naiveToEpoch(naiveAsUtcMs: number, timeZone: string | undefined): number {
  const formatter = timeZone ? formatterFor(timeZone) : null;
  if (!formatter) {
    const wall = new Date(naiveAsUtcMs);
    return new Date(
      wall.getUTCFullYear(),
      wall.getUTCMonth(),
      wall.getUTCDate(),
      wall.getUTCHours(),
      wall.getUTCMinutes(),
      wall.getUTCSeconds(),
      wall.getUTCMilliseconds(),
    ).getTime();
  }
  const firstGuess = naiveAsUtcMs - zoneOffsetMs(formatter, naiveAsUtcMs);
  return naiveAsUtcMs - zoneOffsetMs(formatter, firstGuess);
}

function explicitOffsetMs(suffix: string): number {
  if (suffix === 'Z') {
    return 0;
  }
  const sign = suffix.startsWith('-') ? -1 : 1;
  const digits = suffix.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
}

export function parseLineTimestamp(line: string, timeZone?: string): number | undefined {
  const match = LINE_TIMESTAMP.exec(line);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, fraction, suffix] = match;
  const naiveAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    fraction ? Number(fraction.padEnd(3, '0')) : 0,
  );
  return suffix ? naiveAsUtc - explicitOffsetMs(suffix) : naiveToEpoch(naiveAsUtc, timeZone);
}

function scanLines(
  logText: string,
  matches: (line: string) => boolean,
  options: LogScanOptions,
): LogScan {
  const { now, windowMs, fileModifiedAt, timeZone } = options;
  let count = 0;
  let lastTimestamp: number | undefined;

  for (const line of logText.split('\n')) {
    if (!matches(line)) {
      continue;
    }
    const timestamp = parseLineTimestamp(line, timeZone);
    const reference = timestamp ?? fileModifiedAt;
    if (now - reference > windowMs) {
      continue;
    }
    count += 1;
    if (timestamp !== undefined && (lastTimestamp === undefined || timestamp > lastTimestamp)) {
      lastTimestamp = timestamp;
    }
  }

  return {
    count,
    lastAt: lastTimestamp === undefined ? undefined : new Date(lastTimestamp).toISOString(),
  };
}

export function scanReinsertions(logText: string, options: LogScanOptions): LogScan {
  return scanLines(logText, (line) => line.includes(REINSERTION_MARKER), options);
}

export function isRealDebridAuthRejection(line: string): boolean {
  return (
    PROVIDER_MARKER.test(line) && RD_AUTH_REJECTION_PATTERNS.some((pattern) => pattern.test(line))
  );
}

export function scanAuthRejections(logText: string, options: LogScanOptions): LogScan {
  return scanLines(logText, isRealDebridAuthRejection, options);
}

export async function readLogTail(path: string, bytes: number): Promise<LogTail> {
  const handle = await open(path, 'r');
  try {
    const { size, mtimeMs } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    const startsMidLine = size > length;
    return {
      text: startsMidLine ? text.slice(text.indexOf('\n') + 1) : text,
      modifiedAt: mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

export type DecypharrLog = ({ readable: true } & LogTail) | { readable: false; reason: string };

export function readDecypharrLog(ctx: DoctorContext): Promise<DecypharrLog> {
  return ctx.memo('decypharr-log', async () => {
    try {
      return { readable: true, ...(await ctx.readLogTail(ctx.decypharrLogPath, LOG_TAIL_BYTES)) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        readable: false,
        reason: code ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  });
}

export function scanOptionsFor(ctx: DoctorContext, log: LogTail): LogScanOptions {
  return {
    now: ctx.now(),
    windowMs: REINSERTION_WINDOW_MS,
    fileModifiedAt: log.modifiedAt,
    timeZone: ctx.timeZone,
  };
}

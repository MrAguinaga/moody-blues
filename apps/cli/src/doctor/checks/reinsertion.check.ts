import { REINSERTION_THRESHOLD, REINSERTION_WINDOW_MS } from '../doctor.constants';
import type { DoctorCheck, DoctorContext } from '../doctor.types';
import {
  type LogScan,
  readDecypharrLog,
  scanOptionsFor,
  scanReinsertions,
} from '../doctor-log.utils';
import { skipped, STORAGE_DISABLED_MESSAGE, storageDisabled } from './check-gate.utils';

const WINDOW_MINUTES = REINSERTION_WINDOW_MS / 60_000;

export type ReinsertionReading =
  { readable: true; scan: LogScan } | { readable: false; reason: string };

export async function readReinsertions(ctx: DoctorContext): Promise<ReinsertionReading> {
  const log = await readDecypharrLog(ctx);
  return log.readable
    ? { readable: true, scan: scanReinsertions(log.text, scanOptionsFor(ctx, log)) }
    : { readable: false, reason: log.reason };
}

export function isReinsertionLoop(reading: ReinsertionReading): boolean {
  return reading.readable && reading.scan.count >= REINSERTION_THRESHOLD;
}

export const reinsertionCheck: DoctorCheck = {
  id: 'decypharr-reinsertion',
  name: 'Decypharr re-insertions',
  run: async (ctx) => {
    if (storageDisabled(ctx)) {
      return skipped(STORAGE_DISABLED_MESSAGE);
    }
    const reading = await readReinsertions(ctx);
    if (!reading.readable) {
      return {
        status: 'warning',
        message: 'The Decypharr log could not be read, so re-insertions cannot be counted',
        details: [`${ctx.decypharrLogPath}: ${reading.reason}`],
        suggestion:
          'Check that the log exists and that your user can read it (the file belongs to the container user).',
      };
    }

    const { count, lastAt } = reading.scan;
    const summary = `${count} re-insertion${count === 1 ? '' : 's'} in the last ${WINDOW_MINUTES} minutes`;
    if (isReinsertionLoop(reading)) {
      return {
        status: 'warning',
        message: summary,
        details: lastAt ? [`Last re-insertion at ${lastAt}`] : [],
        suggestion: `Inspect ${ctx.decypharrLogPath}. If downloads are stuck in the queue, run "moody-blues doctor --fix".`,
      };
    }
    return { status: 'ok', message: summary };
  },
};

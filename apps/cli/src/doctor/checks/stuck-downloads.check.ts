import type { QueueRecord } from '@moody-blues/provisioner';

import {
  ARR_APPS,
  MAX_DETAIL_LINES,
  MAX_QUEUE_MESSAGE_LENGTH,
  STUCK_STATES,
} from '../doctor.constants';
import type { DoctorCheck, DoctorContext, DoctorOutcome, StuckItem } from '../doctor.types';
import { errorText, gateService, skipped, storageDisabled } from './check-gate.utils';
import { isReinsertionLoop, readReinsertions } from './reinsertion.check';

const MINUTE_MS = 60_000;
const LOOP_LINE = 'Decypharr is re-inserting torrents (see decypharr-reinsertion)';

export interface StuckEvaluation {
  stuck: Omit<StuckItem, 'app'>[];
  unknownAge: { queueId: number; title: string }[];
}

export interface StuckEvaluationOptions {
  now: number;
  stuckAfterMs: number;
}

export interface StuckScan {
  items: StuckItem[];
  unknownAge: string[];
  unreadable: string[];
  inspected: number;
}

function truncate(text: string): string {
  return text.length > MAX_QUEUE_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_QUEUE_MESSAGE_LENGTH - 1)}…`
    : text;
}

function firstMessage(record: QueueRecord): string | undefined {
  const fromStatus = record.statusMessages
    ?.flatMap((entry) => entry.messages ?? [])
    .find((message) => message.trim() !== '');
  const text = fromStatus ?? (record.errorMessage?.trim() ? record.errorMessage : undefined);
  return text === undefined ? undefined : truncate(text.trim());
}

export function evaluateStuck(
  records: readonly QueueRecord[],
  { now, stuckAfterMs }: StuckEvaluationOptions,
): StuckEvaluation {
  const evaluation: StuckEvaluation = { stuck: [], unknownAge: [] };

  for (const record of records) {
    const state = record.trackedDownloadState;
    if (state === undefined || !STUCK_STATES.includes(state)) {
      continue;
    }
    const title = record.title ?? '(untitled)';
    const addedAt = record.added === undefined ? Number.NaN : Date.parse(record.added);
    if (Number.isNaN(addedAt)) {
      evaluation.unknownAge.push({ queueId: record.id, title });
      continue;
    }
    const ageMs = now - addedAt;
    if (ageMs >= stuckAfterMs) {
      evaluation.stuck.push({
        queueId: record.id,
        title,
        state,
        ageMinutes: Math.floor(ageMs / MINUTE_MS),
        message: firstMessage(record),
      });
    }
  }
  return evaluation;
}

export function describeStuckItem(item: StuckItem): string {
  const suffix = item.message ? `: ${item.message}` : '';
  return `${item.app} #${item.queueId} "${item.title}" ${item.state} for ${item.ageMinutes} min${suffix}`;
}

export async function scanStuckDownloads(ctx: DoctorContext): Promise<StuckScan | undefined> {
  const scan: StuckScan = { items: [], unknownAge: [], unreadable: [], inspected: 0 };
  let running = 0;

  for (const app of ARR_APPS) {
    if (await gateService(ctx, app)) {
      continue;
    }
    running += 1;
    try {
      const records = await ctx.clients[app].listQueue({ includeUnknownSeries: true });
      const evaluation = evaluateStuck(records, {
        now: ctx.now(),
        stuckAfterMs: ctx.stuckAfterMs,
      });
      scan.inspected += records.length;
      scan.items.push(...evaluation.stuck.map((item) => ({ ...item, app })));
      scan.unknownAge.push(
        ...evaluation.unknownAge.map(({ queueId, title }) => `${app} #${queueId} "${title}"`),
      );
    } catch (error) {
      scan.unreadable.push(`${app}: ${errorText(error)}`);
    }
  }
  return running === 0 ? undefined : scan;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function formatThreshold(stuckAfterMs: number): string {
  const minutes = Math.round(stuckAfterMs / MINUTE_MS);
  return `${minutes} ${pluralize(minutes, 'minute', 'minutes')}`;
}

export function outcomeFromScan(
  scan: StuckScan,
  stuckAfterMs: number,
  loopDetected: boolean,
): DoctorOutcome {
  const { items, unknownAge, unreadable } = scan;
  const unreadableLines = unreadable.map((line) => `Could not read the queue of ${line}`);
  const unknownLines = unknownAge.map((line) => `Cannot measure the age of ${line}`);

  if (items.length > 0) {
    const shown = items.slice(0, MAX_DETAIL_LINES).map(describeStuckItem);
    const hidden = items.length - shown.length;
    return {
      status: 'error',
      message: `${items.length} ${pluralize(items.length, 'download has', 'downloads have')} been stuck for more than ${formatThreshold(stuckAfterMs)}`,
      details: [
        ...shown,
        ...(hidden > 0 ? [`and ${hidden} more`] : []),
        ...unknownLines,
        ...unreadableLines,
        ...(loopDetected ? [LOOP_LINE] : []),
      ],
      suggestion: `Run "moody-blues doctor --fix" to remove ${pluralize(items.length, 'it', 'them')}, blocklist the release and search for another one.`,
      fixable: true,
      stuckItems: items,
    };
  }

  if (unreadable.length > 0 || unknownAge.length > 0) {
    return {
      status: 'warning',
      message:
        unreadable.length > 0
          ? 'The download queue could not be read completely'
          : `The age of ${unknownAge.length} queue ${pluralize(unknownAge.length, 'item', 'items')} cannot be measured`,
      details: [...unreadableLines, ...unknownLines],
      suggestion: 'Open the Activity > Queue page of the affected app to inspect it.',
    };
  }

  return {
    status: 'ok',
    message: `No stuck downloads (${scan.inspected} ${pluralize(scan.inspected, 'item', 'items')} in the queues)`,
  };
}

export const stuckDownloadsCheck: DoctorCheck = {
  id: 'stuck-downloads',
  name: 'Stuck downloads',
  run: async (ctx) => {
    const scan = await scanStuckDownloads(ctx);
    if (!scan) {
      return skipped('Neither Sonarr nor Radarr is running (see the Containers check)');
    }
    const loopDetected = !storageDisabled(ctx) && isReinsertionLoop(await readReinsertions(ctx));
    return outcomeFromScan(scan, ctx.stuckAfterMs, loopDetected);
  },
};

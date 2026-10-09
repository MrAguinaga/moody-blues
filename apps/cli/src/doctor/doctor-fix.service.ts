import { describeStuckItem } from './checks/stuck-downloads.check';
import { FIX_SETTLE_MS, MAX_FIX_ITEMS } from './doctor.constants';
import type { DoctorClients, DoctorResult, FixOutcome, FixPlan, StuckItem } from './doctor.types';

export const FIX_ACTION =
  'remove it from the download client, blocklist the release and search for another one';
export const FIX_ID = 'remove-stuck-downloads';

export interface ApplyFixDeps {
  clients: Pick<DoctorClients, 'sonarr' | 'radarr'>;
  reinsertionsBefore: number;
  settle(ms: number): Promise<void>;
  countReinsertions(): Promise<number>;
  redact(text: string): string;
}

export function itemLabel(item: Pick<StuckItem, 'app' | 'queueId'>): string {
  return `${item.app} #${item.queueId}`;
}

export function buildFixPlan(
  results: readonly DoctorResult[],
  maxItems: number = MAX_FIX_ITEMS,
): FixPlan | undefined {
  const items = results.find((result) => result.id === 'stuck-downloads')?.stuckItems ?? [];
  if (items.length === 0) {
    return undefined;
  }
  return { items: items.slice(0, maxItems), pending: Math.max(0, items.length - maxItems) };
}

export function describeFixPlan(plan: FixPlan): string[] {
  return [
    ...plan.items.map(describeStuckItem),
    ...(plan.pending > 0
      ? [`${plan.pending} more will remain; run the command again to handle them`]
      : []),
  ];
}

export function unappliedOutcome(plan: FixPlan, reinsertions: number, note: string): FixOutcome {
  return {
    id: FIX_ID,
    applied: false,
    removed: 0,
    failed: [],
    items: plan.items.map(itemLabel),
    pending: plan.pending,
    reinsertionsBefore: reinsertions,
    reinsertionsAfter: reinsertions,
    loopStopped: false,
    note,
  };
}

export async function applyFixes(plan: FixPlan, deps: ApplyFixDeps): Promise<FixOutcome> {
  const removed: string[] = [];
  const failed: string[] = [];

  for (const item of plan.items) {
    try {
      await deps.clients[item.app].removeQueueItem(item.queueId, {
        removeFromClient: true,
        blocklist: true,
      });
      removed.push(itemLabel(item));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push(deps.redact(`${itemLabel(item)}: ${reason}`));
    }
  }

  if (removed.length > 0) {
    await deps.settle(FIX_SETTLE_MS);
  }
  const reinsertionsAfter = await deps.countReinsertions();

  return {
    id: FIX_ID,
    applied: removed.length > 0,
    removed: removed.length,
    failed,
    items: removed,
    pending: plan.pending,
    reinsertionsBefore: deps.reinsertionsBefore,
    reinsertionsAfter,
    loopStopped: reinsertionsAfter <= deps.reinsertionsBefore,
  };
}

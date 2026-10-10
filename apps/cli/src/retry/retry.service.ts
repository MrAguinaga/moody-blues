import {
  type EpisodeResource,
  type HistoryRecord,
  HttpStatusError,
  type ManualImportFile,
  type QueueRecord,
  type ReleaseGrab,
  type TitleResource,
} from '@moody-blues/provisioner';

import { errorMessage } from '../utils/command.utils';
import { classifyReleases, namesOfSeries } from './retry.candidates';
import { importableAssignments, isVideoFile, matchPackFiles } from './retry.plan';
import type {
  CandidateSearch,
  PackAssignment,
  RetryClients,
  RetryOutcome,
  RetryPlan,
  RetryResult,
  RetryRuntime,
  RetrySeason,
  RetrySonarr,
  RetryStepResult,
  RetryTarget,
} from './retry.types';
import { findRejectionReason, scanPackHealth } from './retry.verify';

const DELIVERY_POLL_MS = 5_000;
const DELIVERY_TIMEOUT_MS = 5 * 60_000;
const IMPORT_POLL_MS = 5_000;
const IMPORT_MIN_TIMEOUT_MS = 5 * 60_000;
const IMPORT_TIMEOUT_PER_FILE_MS = 60_000;
const GRABBED_EVENT = 'grabbed';
const IMPORTED_EVENT = 'downloadfolderimported';
const FINISHED_COMMANDS: readonly string[] = ['failed', 'aborted', 'cancelled', 'orphaned'];
const DECYPHARR_REFUSAL = /qbittorrent/i;

export interface RunRetryOptions {
  clients: RetryClients;
  runtime: RetryRuntime;
  plan: RetryPlan;
  onStep?: (step: RetryStepResult) => void;
}

interface GrabInfo {
  downloadId?: string;
  historyId?: number;
  queueId?: number;
  outputPath?: string;
}

type Delivery =
  | { state: 'blocked'; outputPath: string }
  | { state: 'automatic' }
  | { state: 'failed'; reason: string }
  | { state: 'timeout' };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function describeEpisodes(count: number): string {
  return plural(count, 'episode');
}

function sameId(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

export function seasonsOf(
  episodes: readonly EpisodeResource[],
  now: number,
  only?: number,
): RetrySeason[] {
  const bySeason = new Map<number, EpisodeResource[]>();
  for (const episode of episodes) {
    if (episode.monitored && episode.seasonNumber > 0) {
      bySeason.set(episode.seasonNumber, [...(bySeason.get(episode.seasonNumber) ?? []), episode]);
    }
  }
  return [...bySeason]
    .filter(([seasonNumber]) => only === undefined || seasonNumber === only)
    .sort(([left], [right]) => left - right)
    .map(([seasonNumber, seasonEpisodes]) => ({
      seasonNumber,
      episodes: seasonEpisodes.sort((left, right) => left.episodeNumber - right.episodeNumber),
      missing: seasonEpisodes.filter((episode) => {
        const airedAt =
          episode.airDateUtc === undefined ? Number.NaN : Date.parse(episode.airDateUtc);
        return !episode.hasFile && !Number.isNaN(airedAt) && airedAt <= now;
      }),
    }))
    .filter((season) => only !== undefined || season.missing.length > 0);
}

export async function searchCandidates(
  sonarr: Pick<RetrySonarr, 'searchReleases'>,
  series: TitleResource,
  seasonNumber: number,
): Promise<CandidateSearch> {
  return classifyReleases(
    await sonarr.searchReleases(series.id, seasonNumber),
    namesOfSeries(series),
  );
}

export async function readSeasons(
  sonarr: Pick<RetrySonarr, 'listEpisodes'>,
  target: RetryTarget,
  now: number,
  only?: number,
): Promise<RetrySeason[]> {
  return seasonsOf(await sonarr.listEpisodes(target.id), now, only);
}

function buildGrab(plan: RetryPlan): ReleaseGrab {
  const { release } = plan.candidate;
  return {
    guid: release.guid,
    indexerId: release.indexerId,
    quality: release.quality,
    languages: release.languages ?? [],
    shouldOverride: true,
    seriesId: plan.target.id,
    episodeIds: plan.season.episodes.map((episode) => episode.id),
  };
}

function grabbedCounts(history: readonly HistoryRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of history) {
    if (record.eventType?.toLowerCase() === GRABBED_EVENT && record.downloadId) {
      const key = record.downloadId.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function findNewGrab(
  history: readonly HistoryRecord[],
  before: ReadonlyMap<string, number>,
): HistoryRecord | undefined {
  const now = grabbedCounts(history);
  return history.find(
    (record) =>
      record.eventType?.toLowerCase() === GRABBED_EVENT &&
      record.downloadId !== undefined &&
      (now.get(record.downloadId.toLowerCase()) ?? 0) >
        (before.get(record.downloadId.toLowerCase()) ?? 0),
  );
}

function isDecypharrRefusal(error: unknown): boolean {
  return error instanceof HttpStatusError && DECYPHARR_REFUSAL.test(error.bodySnippet);
}

function queueMessage(item: QueueRecord): string {
  const text = item.statusMessages
    ?.flatMap((entry) => entry.messages ?? [])
    .find((message) => message.trim() !== '');
  return text ?? item.errorMessage ?? 'Sonarr reported the download as failed';
}

async function waitForDelivery(
  { sonarr }: RetryClients,
  runtime: RetryRuntime,
  plan: RetryPlan,
  before: ReadonlyMap<string, number>,
  grab: GrabInfo,
): Promise<Delivery> {
  const deadline = runtime.now() + DELIVERY_TIMEOUT_MS;
  for (;;) {
    if (grab.downloadId === undefined) {
      const found = findNewGrab(await sonarr.listHistory(plan.target.id), before);
      grab.downloadId = found?.downloadId;
      grab.historyId = found?.id;
    }
    if (grab.downloadId !== undefined) {
      const queue = await sonarr.listQueue({ includeUnknownSeries: true });
      const item = queue.find((record) => sameId(record.downloadId, grab.downloadId));
      if (item) {
        grab.queueId = item.id;
        const state = item.trackedDownloadState;
        if (state === 'importBlocked' && item.outputPath) {
          grab.outputPath = item.outputPath;
          return { state: 'blocked', outputPath: item.outputPath };
        }
        if (state === 'importPending' || state === 'importing') {
          return { state: 'automatic' };
        }
        if (state === 'failed' || state === 'failedPending') {
          return { state: 'failed', reason: queueMessage(item) };
        }
      } else if (
        (await sonarr.listHistoryByDownloadId(grab.downloadId)).some(
          (record) => record.eventType?.toLowerCase() === IMPORTED_EVENT,
        )
      ) {
        return { state: 'automatic' };
      }
    }
    if (runtime.now() >= deadline) {
      return { state: 'timeout' };
    }
    await runtime.sleep(DELIVERY_POLL_MS);
  }
}

async function rollBack(
  { sonarr, decypharr }: RetryClients,
  plan: RetryPlan,
  grab: GrabInfo,
): Promise<RetryStepResult> {
  const details: string[] = [];
  const failures: string[] = [];
  const downloadId = grab.downloadId;
  let torrentKept = false;

  if (downloadId !== undefined) {
    try {
      const history = await sonarr.listHistoryByDownloadId(downloadId);
      torrentKept = history.some(
        (record) =>
          record.eventType?.toLowerCase() === IMPORTED_EVENT ||
          (record.seriesId !== undefined && record.seriesId !== plan.target.id),
      );
      if (torrentKept) {
        details.push('The torrent was already used by the library, so it was kept');
      } else if (await decypharr.deleteTorrent(downloadId.toLowerCase())) {
        details.push('Torrent deleted from Real-Debrid');
      } else {
        details.push('The torrent was already gone');
      }
    } catch (error) {
      failures.push(`torrent ${downloadId.toLowerCase()}: ${errorMessage(error)}`);
    }
  }

  try {
    if (grab.queueId !== undefined) {
      await sonarr.removeQueueItem(grab.queueId, {
        removeFromClient: false,
        blocklist: !torrentKept,
        skipRedownload: true,
      });
      details.push(
        torrentKept ? 'Queue item removed' : 'Queue item removed and release blocklisted',
      );
    } else if (grab.historyId !== undefined && !torrentKept) {
      await sonarr.blocklistHistory(grab.historyId);
      details.push('Release blocklisted');
    }
  } catch (error) {
    failures.push(`Sonarr queue: ${errorMessage(error)}`);
  }

  if (failures.length > 0) {
    return {
      id: 'rollback',
      status: 'failed',
      message: 'The rollback is incomplete; the library was not touched',
      details: [...details, ...failures],
      hint: 'Run "moody-blues doctor --fix" or delete the torrent from the Decypharr panel (Torrents).',
    };
  }
  return {
    id: 'rollback',
    status: 'ok',
    message: 'The library was not touched',
    details,
  };
}

async function probeAll(
  runtime: RetryRuntime,
  assignments: readonly PackAssignment[],
): Promise<string | undefined> {
  for (const { path, episode } of assignments) {
    try {
      await runtime.probe(path);
    } catch (error) {
      return `episode ${episode.episodeNumber} is not readable through the mount: ${errorMessage(error)}`;
    }
  }
  return undefined;
}

async function checkHealth(
  runtime: RetryRuntime,
  plan: RetryPlan,
  grab: GrabInfo,
  since: number,
  outputPath: string,
): Promise<string | undefined> {
  let log;
  try {
    log = await runtime.readDecypharrLog();
  } catch (error) {
    return `the Decypharr log could not be read (${errorMessage(error)})`;
  }
  const health = scanPackHealth(log, {
    infohash: grab.downloadId ?? '',
    names: [plan.candidate.release.title, outputPath.slice(outputPath.lastIndexOf('/') + 1)],
    since,
    timeZone: runtime.timeZone,
  });
  if (health.markedBad) {
    return 'Decypharr marked the torrent as bad';
  }
  return health.reinsertions > 0
    ? `Decypharr re-inserted the torrent ${plural(health.reinsertions, 'time')}`
    : undefined;
}

async function runManualImport(
  { sonarr }: RetryClients,
  runtime: RetryRuntime,
  files: readonly ManualImportFile[],
): Promise<string> {
  const command = await sonarr.manualImport(files);
  const deadline =
    runtime.now() + Math.max(IMPORT_MIN_TIMEOUT_MS, files.length * IMPORT_TIMEOUT_PER_FILE_MS);
  for (;;) {
    const current = await sonarr.getCommand(command.id);
    if (current.status === 'completed') {
      return current.message ?? 'import completed';
    }
    if (FINISHED_COMMANDS.includes(current.status)) {
      throw new Error(
        `Sonarr ${current.status} the import${current.message ? `: ${current.message}` : ''}`,
      );
    }
    if (runtime.now() >= deadline) {
      throw new Error('Sonarr did not finish the import in time; check Activity > Queue');
    }
    await runtime.sleep(IMPORT_POLL_MS);
  }
}

function importFiles(
  plan: RetryPlan,
  grab: GrabInfo,
  assignments: readonly PackAssignment[],
): ManualImportFile[] {
  const { release } = plan.candidate;
  return assignments.map(({ path, episode, releaseGroup }) => ({
    path,
    seriesId: plan.target.id,
    episodeIds: [episode.id],
    quality: release.quality,
    languages: release.languages ?? [],
    ...(releaseGroup ? { releaseGroup } : {}),
    downloadId: grab.downloadId,
  }));
}

export async function runRetry({
  clients,
  runtime,
  plan,
  onStep,
}: RunRetryOptions): Promise<RetryResult> {
  const steps: RetryStepResult[] = [];
  const record = (step: RetryStepResult) => {
    steps.push(step);
    onStep?.(step);
  };
  const finish = (outcome: RetryOutcome, imported = 0): RetryResult => ({
    plan,
    steps,
    outcome,
    imported,
    success: outcome === 'imported',
  });
  const { sonarr } = clients;
  const position = plan.candidate.position;
  const grab: GrabInfo = {};
  const startedAt = runtime.now();

  let before: Map<string, number>;
  try {
    before = grabbedCounts(await sonarr.listHistory(plan.target.id));
    await sonarr.grabRelease(buildGrab(plan));
  } catch (error) {
    if (!isDecypharrRefusal(error)) {
      record({
        id: 'decypharr',
        status: 'failed',
        message: `release ${position} could not be sent: ${errorMessage(error)}`,
      });
      return finish('failed');
    }
    const reason = await rejectionReason(runtime, startedAt);
    record({
      id: 'decypharr',
      status: 'failed',
      message: `release ${position} rejected: ${reason}`,
    });
    return finish('rejected');
  }

  const unverified = async (step: RetryStepResult): Promise<RetryResult> => {
    record(step);
    record(await rollBack(clients, plan, grab));
    return finish('unverified');
  };

  const delivery = await waitForDelivery(clients, runtime, plan, before, grab);
  if (delivery.state === 'timeout' || delivery.state === 'failed') {
    return unverified({
      id: 'decypharr',
      status: 'failed',
      message:
        delivery.state === 'failed'
          ? `release ${position} failed: ${delivery.reason}`
          : `release ${position} was not delivered in time`,
    });
  }
  if (delivery.state === 'automatic') {
    record({
      id: 'decypharr',
      status: 'ok',
      message: `release ${position} delivered`,
    });
    record({
      id: 'sonarr',
      status: 'ok',
      message: 'Sonarr recognized the release and imports it by itself',
      hint: 'The pre-import verification only runs for releases Sonarr cannot parse.',
    });
    return finish('imported');
  }

  let files: string[];
  try {
    files = await runtime.listVideoFiles(delivery.outputPath);
  } catch (error) {
    return unverified({
      id: 'decypharr',
      status: 'failed',
      message: `release ${position} was delivered, but its files cannot be listed: ${errorMessage(error)}`,
    });
  }
  record({
    id: 'decypharr',
    status: 'ok',
    message: `release ${position} delivered (${plural(files.filter(isVideoFile).length, 'file')})`,
  });

  const match = matchPackFiles(files, plan.season.episodes);
  const assignments = importableAssignments(plan, match);
  if (assignments.length === 0) {
    return unverified({
      id: 'verify',
      status: 'failed',
      message: 'no file of the release matches an episode that needs one',
      details: match.ignored.map((path) => `ignored: ${path}`),
    });
  }

  const unreadable = await probeAll(runtime, assignments);
  const unhealthy =
    unreadable ?? (await checkHealth(runtime, plan, grab, startedAt, delivery.outputPath));
  if (unhealthy !== undefined) {
    return unverified({ id: 'verify', status: 'failed', message: unhealthy });
  }
  record({
    id: 'verify',
    status: 'ok',
    message: `${describeEpisodes(assignments.length)} readable through the mount, no re-insertions`,
  });

  try {
    const summary = await runManualImport(clients, runtime, importFiles(plan, grab, assignments));
    const after = await sonarr.listEpisodes(plan.target.id, plan.season.seasonNumber);
    const previous = new Map(
      plan.season.episodes.map((episode) => [episode.id, episode.episodeFileId]),
    );
    const imported = assignments.filter(({ episode }) => {
      const current = after.find((candidate) => candidate.id === episode.id);
      return current?.hasFile === true && current.episodeFileId !== previous.get(episode.id);
    }).length;
    const skipped = match.ignored.length + match.ambiguous.length;
    const complete = imported === assignments.length;
    record({
      id: 'sonarr',
      status: complete ? 'ok' : 'failed',
      message: `${describeEpisodes(imported)} imported${skipped > 0 ? `, ${plural(skipped, 'file')} skipped` : ''}`,
      details: [
        summary,
        ...match.ambiguous.map((path) => `ambiguous episode number: ${path}`),
        ...match.ignored.map((path) => `no episode number: ${path}`),
      ],
      ...(complete
        ? {}
        : {
            hint: 'Check Activity > History in Sonarr; the replaced files are in the recycle bin.',
          }),
    });
    return finish(complete ? 'imported' : 'failed', imported);
  } catch (error) {
    record({
      id: 'sonarr',
      status: 'failed',
      message: errorMessage(error),
      hint: 'Check Activity > History in Sonarr; the replaced files are in the recycle bin.',
    });
    return finish('failed');
  }
}

async function rejectionReason(runtime: RetryRuntime, since: number): Promise<string> {
  try {
    const reason = findRejectionReason(await runtime.readDecypharrLog(), since, runtime.timeZone);
    if (reason) {
      return reason;
    }
  } catch {
    return 'Decypharr refused it and its log could not be read';
  }
  return 'Decypharr refused it (the torrent is probably not cached on Real-Debrid)';
}

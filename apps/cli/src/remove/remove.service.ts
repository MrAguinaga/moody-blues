import { errorMessage } from '../utils/command.utils';
import type {
  RemoveClients,
  RemoveLibrary,
  RemovePlan,
  RemoveResult,
  RemoveStepResult,
  RemoveTorrent,
} from './remove.types';

export interface RunRemoveOptions {
  clients: RemoveClients;
  plan: RemovePlan;
  onStep?: (step: RemoveStepResult) => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export async function readLibrary(
  clients: Pick<RemoveClients, 'radarr' | 'sonarr'>,
): Promise<RemoveLibrary> {
  const [movies, series] = await Promise.all([
    clients.radarr.listTitles(),
    clients.sonarr.listTitles(),
  ]);
  return { movies, series };
}

async function attempt(
  id: RemoveStepResult['id'],
  action: () => Promise<Omit<RemoveStepResult, 'id'>>,
  hint: string,
): Promise<RemoveStepResult> {
  try {
    return { id, ...(await action()) };
  } catch (error) {
    return { id, status: 'failed', message: errorMessage(error), hint };
  }
}

interface TorrentDeletion {
  deleted: number;
  alreadyGone: number;
  failed: { torrent: RemoveTorrent; reason: string }[];
}

async function deleteTorrents(
  clients: RemoveClients,
  torrents: readonly RemoveTorrent[],
): Promise<TorrentDeletion> {
  const outcome: TorrentDeletion = { deleted: 0, alreadyGone: 0, failed: [] };
  for (const torrent of torrents) {
    try {
      if (await clients.decypharr.deleteTorrent(torrent.infohash)) {
        outcome.deleted += 1;
      } else {
        outcome.alreadyGone += 1;
      }
    } catch (error) {
      outcome.failed.push({ torrent, reason: errorMessage(error) });
    }
  }
  return outcome;
}

function describeDeletion({ deleted, alreadyGone }: TorrentDeletion): string {
  const parts = [
    ...(deleted > 0 ? [`${plural(deleted, 'torrent')} deleted from Real-Debrid`] : []),
    ...(alreadyGone > 0 ? [`${plural(alreadyGone, 'torrent')} already gone`] : []),
  ];
  return parts.join(', ') || 'no torrents were deleted';
}

async function removeTorrents(
  clients: RemoveClients,
  plan: RemovePlan,
): Promise<{ step: RemoveStepResult; pending: string[] }> {
  if (plan.torrents.length === 0) {
    const message = plan.keepDebrid ? 'torrents kept (--keep-debrid)' : 'no torrents to delete';
    return { step: { id: 'decypharr', status: 'skipped', message }, pending: [] };
  }
  const outcome = await deleteTorrents(clients, plan.torrents);
  if (outcome.failed.length === 0) {
    return {
      step: { id: 'decypharr', status: 'ok', message: describeDeletion(outcome) },
      pending: [],
    };
  }
  const pending = outcome.failed.map(({ torrent }) => torrent.infohash);
  return {
    pending,
    step: {
      id: 'decypharr',
      status: 'failed',
      message: `${plural(outcome.failed.length, 'torrent')} could not be deleted (${describeDeletion(outcome)})`,
      details: outcome.failed.map(({ torrent, reason }) => `${torrent.infohash}: ${reason}`),
      hint: 'Delete the pending torrents from the Decypharr panel (Torrents); the title is already gone from the library.',
    },
  };
}

function clearSeerr(clients: RemoveClients, plan: RemovePlan): Promise<RemoveStepResult> {
  const { target } = plan;
  return attempt(
    'seerr',
    async () => {
      const media = await clients.seerr.findMedia({
        mediaType: target.kind === 'movie' ? 'movie' : 'tv',
        tmdbId: target.tmdbId,
        tvdbId: target.tvdbId,
      });
      if (!media) {
        return { status: 'ok', message: 'no record to clear' };
      }
      await clients.seerr.deleteMedia(media.id);
      return { status: 'ok', message: 'record cleared' };
    },
    'Remove the title from Seerr (Manage > Media) so it can be requested again.',
  );
}

export async function runRemove({
  clients,
  plan,
  onStep,
}: RunRemoveOptions): Promise<RemoveResult> {
  const steps: RemoveStepResult[] = [];
  const record = (step: RemoveStepResult) => {
    steps.push(step);
    onStep?.(step);
    return step;
  };
  const owner = plan.target.kind === 'movie' ? clients.radarr : clients.sonarr;

  const library = record(
    await attempt(
      'library',
      async () => {
        await owner.deleteTitle(plan.target.id);
        return { status: 'ok', message: 'title and files deleted' };
      },
      'Nothing else was touched; repeat the command.',
    ),
  );
  if (library.status === 'failed') {
    return { plan, steps, libraryDeleted: false, pendingInfohashes: [], success: false };
  }

  const torrents = await removeTorrents(clients, plan);
  record(torrents.step);
  record(await clearSeerr(clients, plan));
  record(
    await attempt(
      'jellyfin',
      async () => {
        await clients.jellyfin.refreshLibrary();
        return { status: 'ok', message: 'library refresh requested' };
      },
      'Run "Scan All Libraries" from the Jellyfin dashboard.',
    ),
  );

  return {
    plan,
    steps,
    libraryDeleted: true,
    pendingInfohashes: torrents.pending,
    success: steps.every((step) => step.status !== 'failed'),
  };
}

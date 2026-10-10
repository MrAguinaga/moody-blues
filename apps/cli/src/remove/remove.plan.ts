import type { HistoryRecord } from '@moody-blues/provisioner';

import type {
  KeptTorrent,
  RemoveClients,
  RemoveKind,
  RemoveLibrary,
  RemovePlan,
  RemoveTarget,
  RemoveTorrent,
} from './remove.types';

const INFOHASH = /^[0-9a-f]{40}$/;
const GRABBED_EVENT = 'grabbed';
const KEPT_BY_FLAG = 'kept by --keep-debrid';
const NOT_AN_INFOHASH = 'the download id is not a torrent infohash';

export interface GrabbedDownload {
  downloadId: string;
  infohash: string;
  name?: string;
}

export interface ClassifiedDownloads {
  torrents: RemoveTorrent[];
  kept: KeptTorrent[];
}

export function extractGrabbedDownloads(history: readonly HistoryRecord[]): GrabbedDownload[] {
  const downloads = new Map<string, GrabbedDownload>();
  for (const record of history) {
    if (record.eventType?.toLowerCase() !== GRABBED_EVENT || !record.downloadId) {
      continue;
    }
    const infohash = record.downloadId.toLowerCase();
    if (!downloads.has(infohash)) {
      downloads.set(infohash, {
        downloadId: record.downloadId,
        infohash,
        name: record.sourceTitle,
      });
    }
  }
  return [...downloads.values()];
}

export function classifyDownloads(
  downloads: readonly GrabbedDownload[],
  otherTitles: ReadonlyMap<string, readonly string[]>,
  keepDebrid: boolean,
): ClassifiedDownloads {
  const torrents: RemoveTorrent[] = [];
  const kept: KeptTorrent[] = [];
  for (const { infohash, name } of downloads) {
    const sharedWith = otherTitles.get(infohash) ?? [];
    if (!INFOHASH.test(infohash)) {
      kept.push({ infohash, name, reason: NOT_AN_INFOHASH });
    } else if (sharedWith.length > 0) {
      kept.push({ infohash, name, reason: `also used by ${sharedWith.join(', ')}` });
    } else if (keepDebrid) {
      kept.push({ infohash, name, reason: KEPT_BY_FLAG });
    } else {
      torrents.push({ infohash, name });
    }
  }
  return { torrents, kept };
}

function describeTitle(library: RemoveLibrary, kind: RemoveKind, id: number): string {
  const resource = (kind === 'movie' ? library.movies : library.series).find(
    (candidate) => candidate.id === id,
  );
  if (!resource) {
    return `${kind} #${id}`;
  }
  return resource.year ? `${resource.title} (${resource.year})` : resource.title;
}

async function titlesUsing(
  clients: Pick<RemoveClients, 'radarr' | 'sonarr'>,
  library: RemoveLibrary,
  target: RemoveTarget,
  downloadId: string,
): Promise<string[]> {
  // Servarr stores the infohash in upper case while Decypharr reports it in lower case, so every spelling is asked for.
  const spellings = new Set([downloadId, downloadId.toUpperCase(), downloadId.toLowerCase()]);
  const titles = new Set<string>();
  const sources = [
    { kind: 'movie' as const, client: clients.radarr, idOf: (r: HistoryRecord) => r.movieId },
    { kind: 'series' as const, client: clients.sonarr, idOf: (r: HistoryRecord) => r.seriesId },
  ];
  for (const { kind, client, idOf } of sources) {
    for (const spelling of spellings) {
      for (const record of await client.listHistoryByDownloadId(spelling)) {
        const id = idOf(record);
        if (id !== undefined && !(kind === target.kind && id === target.id)) {
          titles.add(describeTitle(library, kind, id));
        }
      }
    }
  }
  return [...titles];
}

export async function buildRemovePlan(
  clients: Pick<RemoveClients, 'radarr' | 'sonarr'>,
  library: RemoveLibrary,
  target: RemoveTarget,
  options: { keepDebrid: boolean },
): Promise<RemovePlan> {
  const owner = target.kind === 'movie' ? clients.radarr : clients.sonarr;
  const downloads = extractGrabbedDownloads(await owner.listHistory(target.id));
  const otherTitles = new Map<string, string[]>();
  for (const { downloadId, infohash } of downloads) {
    if (INFOHASH.test(infohash)) {
      otherTitles.set(infohash, await titlesUsing(clients, library, target, downloadId));
    }
  }
  return {
    target,
    ...classifyDownloads(downloads, otherTitles, options.keepDebrid),
    keepDebrid: options.keepDebrid,
  };
}

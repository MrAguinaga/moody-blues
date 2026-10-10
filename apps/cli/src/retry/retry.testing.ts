import {
  type ArrCommandResource,
  type EpisodeFileResource,
  type EpisodeResource,
  type HistoryRecord,
  HttpStatusError,
  type ManualImportFile,
  type QueueRecord,
  type ReleaseGrab,
  type ReleaseQualityResource,
  type ReleaseResource,
  type TitleResource,
} from '@moody-blues/provisioner';

import { buildRetryPlan } from './retry.plan';
import type {
  RetryCandidate,
  RetryClients,
  RetryLog,
  RetryPlan,
  RetryRuntime,
  RetrySeason,
} from './retry.types';

export const NOW = Date.parse('2026-10-09T12:00:00.000Z');
export const PACK_HASH = 'C610AD37C610AD37C610AD37C610AD37C610AD37';
export const PACK_FOLDER = '/data/downloads/sonarr/Azumanga Daioh';

export const AZUMANGA: TitleResource = {
  id: 9,
  title: 'Azumanga Daioh',
  originalTitle: 'あずまんが大王',
  year: 2002,
  path: '/data/media/tv/Azumanga Daioh (2002)',
  tvdbId: 79040,
  alternateTitles: [{ title: 'Azumanga Daioh The Animation' }],
};

export const BLURAY_1080: ReleaseQualityResource = {
  quality: { id: 7, name: 'Bluray-1080p' },
  revision: { version: 1, real: 0, isRepack: false },
};
export const DVD: ReleaseQualityResource = {
  quality: { id: 2, name: 'DVD' },
  revision: { version: 1, real: 0, isRepack: false },
};

export function release(patch: Partial<ReleaseResource> & { title: string }): ReleaseResource {
  return {
    guid: `guid-${patch.title}`,
    indexerId: 3,
    indexer: 'Nyaa',
    quality: BLURAY_1080,
    languages: [{ id: 8, name: 'Japanese' }],
    seeders: 10,
    size: 20_000_000_000,
    customFormatScore: 0,
    fullSeason: false,
    rejections: [],
    ...patch,
  };
}

export const RELEASE_DUAL = release({
  title: 'Azumanga Daioh + Extras (Dual Audio) 1080p BD x265 Opus',
  customFormatScore: 2400,
  seeders: 221,
  rejections: ['Unknown Series'],
});
export const RELEASE_MAN = release({
  title: '[man] Azumanga Daioh [BD 1080p HEVC FLAC]',
  customFormatScore: 2400,
  seeders: 100,
  rejections: ['Unable to parse release'],
});
export const RELEASE_KAA = release({
  title: '[KAA] Azumanga Daioh 01-26 DVD (Complete)',
  quality: DVD,
  customFormatScore: 2000,
  seeders: 67,
  fullSeason: true,
  rejections: [],
});
export const RELEASE_LOOSE = release({
  title: 'Azumanga Daioh S01E01 1080p BluRay',
  rejections: ['Existing file on disk is of equal or higher preference: Bluray-1080p v1'],
});
export const RELEASE_OTHER = release({
  title: 'Another Show 1080p BD',
  rejections: ['Unknown Series'],
});
export const RELEASE_BLOCKED = release({
  title: 'Azumanga Daioh 1080p BD (blocked)',
  fullSeason: true,
  rejections: ['Release is blocklisted'],
});

export function episode(number: number, patch: Partial<EpisodeResource> = {}): EpisodeResource {
  return {
    id: 100 + number,
    seriesId: AZUMANGA.id,
    seasonNumber: 1,
    episodeNumber: number,
    monitored: true,
    hasFile: false,
    airDateUtc: '2002-04-08T00:00:00Z',
    ...patch,
  };
}

export function seasonOf(count: number, withFile: readonly number[] = []): RetrySeason {
  const episodes = Array.from({ length: count }, (_, index) =>
    withFile.includes(index + 1)
      ? episode(index + 1, { hasFile: true, episodeFileId: 500 + index + 1 })
      : episode(index + 1),
  );
  return { seasonNumber: 1, episodes, missing: episodes.filter((item) => !item.hasFile) };
}

export function episodeFile(
  id: number,
  quality: ReleaseQualityResource = BLURAY_1080,
): EpisodeFileResource {
  return { id, seriesId: AZUMANGA.id, seasonNumber: 1, quality };
}

export function candidateOf(
  source: ReleaseResource,
  patch: Partial<RetryCandidate> = {},
): RetryCandidate {
  return {
    position: 1,
    release: source,
    qualityName: source.quality.quality.name,
    rank: source.quality.quality.id === 7 ? 10805 : 4801,
    recognized: false,
    score: source.customFormatScore ?? 0,
    seeders: source.seeders ?? 0,
    ...patch,
  };
}

export function planOf(
  season: RetrySeason,
  source: ReleaseResource = RELEASE_MAN,
  files: readonly EpisodeFileResource[] = [],
): RetryPlan {
  return buildRetryPlan(
    { kind: 'series', id: AZUMANGA.id, title: AZUMANGA.title, year: AZUMANGA.year, tvdbId: 79040 },
    season,
    files,
    candidateOf(source),
  );
}

export function packFile(number: number): string {
  const label = String(number).padStart(2, '0');
  return `${PACK_FOLDER}/[man] Azumanga Daioh - ${label} [BD-DVDRip 1440x1080 x265 FLAC] [67C47DAF].mkv`;
}

export const PACK_EXTRA = `${PACK_FOLDER}/Azumanga Daioh - Creditless Ending [BD 1080p].mkv`;

export interface RetryDoublesOptions {
  season: RetrySeason;
  refuse?: boolean;
  delivery?: 'blocked' | 'automatic' | 'failed' | 'never';
  packFiles?: readonly string[];
  unreadable?: readonly string[];
  log?: string | Error;
  history?: readonly HistoryRecord[];
  failImport?: boolean;
  importMessage?: string;
  skipImportEffect?: boolean;
  failTorrentDelete?: boolean;
  releases?: readonly ReleaseResource[];
  files?: readonly EpisodeFileResource[];
  recycleBin?: string;
  titles?: readonly TitleResource[];
  extraEpisodes?: readonly EpisodeResource[];
}

export interface RetryDoubles {
  clients: RetryClients;
  runtime: RetryRuntime;
  calls: string[];
  grabs: ReleaseGrab[];
  imports: ManualImportFile[][];
  episodes: EpisodeResource[];
  clock: { now: number };
  history: HistoryRecord[];
}

export function createRetryDoubles(options: RetryDoublesOptions): RetryDoubles {
  const calls: string[] = [];
  const grabs: ReleaseGrab[] = [];
  const imports: ManualImportFile[][] = [];
  const clock = { now: NOW };
  const episodes = structuredClone([...options.season.episodes, ...(options.extraEpisodes ?? [])]);
  const history: HistoryRecord[] = structuredClone([...(options.history ?? [])]);
  const queue: QueueRecord[] = [];
  const delivery = options.delivery ?? 'blocked';
  const commands = new Map<number, ArrCommandResource>();
  let nextFileId = 900;

  const sonarr: RetryClients['sonarr'] = {
    listTitles: async () => [...(options.titles ?? [AZUMANGA])],
    getConfig: (async () => ({
      id: 1,
      recycleBin: options.recycleBin ?? '/data/media/.recycle',
    })) as never,
    listEpisodes: async (_seriesId, seasonNumber) =>
      structuredClone(
        episodes.filter((item) => seasonNumber === undefined || item.seasonNumber === seasonNumber),
      ),
    listEpisodeFiles: async () => [...(options.files ?? [])],
    searchReleases: async () => [...(options.releases ?? [])],
    grabRelease: async (grab) => {
      calls.push('sonarr.grabRelease');
      grabs.push(grab);
      if (options.refuse) {
        throw new HttpStatusError(
          'POST',
          'http://127.0.0.1:8989/api/v3/release',
          500,
          '{"message":"Failed to connect to qBittorrent, check your settings."}',
        );
      }
      history.unshift({
        id: 77,
        eventType: 'grabbed',
        downloadId: PACK_HASH,
        sourceTitle: 'grabbed release',
        seriesId: AZUMANGA.id,
      });
      if (delivery !== 'never') {
        queue.push({
          id: 31,
          seriesId: AZUMANGA.id,
          downloadId: PACK_HASH,
          outputPath: PACK_FOLDER,
          trackedDownloadState:
            delivery === 'automatic'
              ? 'importPending'
              : delivery === 'failed'
                ? 'failed'
                : 'importBlocked',
          statusMessages: delivery === 'failed' ? [{ messages: ['Download failed'] }] : [],
        });
      }
    },
    listHistory: async () => history.filter((record) => record.seriesId === AZUMANGA.id),
    listHistoryByDownloadId: async (downloadId) =>
      history.filter((record) => record.downloadId?.toLowerCase() === downloadId.toLowerCase()),
    listQueue: async () => queue,
    removeQueueItem: async (id, removal) => {
      calls.push(`sonarr.removeQueueItem:${id}:${JSON.stringify(removal)}`);
    },
    blocklistHistory: async (id) => {
      calls.push(`sonarr.blocklistHistory:${id}`);
    },
    manualImport: async (files) => {
      calls.push('sonarr.manualImport');
      imports.push([...files]);
      const command = { id: 40, status: 'queued' };
      commands.set(command.id, command);
      return command;
    },
    getCommand: async (id) => {
      calls.push(`sonarr.getCommand:${id}`);
      const files = imports.at(-1) ?? [];
      if (options.failImport) {
        return { id, status: 'failed', message: 'Import failed' };
      }
      if (!options.skipImportEffect) {
        for (const file of files) {
          const target = episodes.find((item) => item.id === file.episodeIds[0]);
          if (target) {
            nextFileId += 1;
            target.hasFile = true;
            target.episodeFileId = nextFileId;
          }
        }
      }
      return {
        id,
        status: 'completed',
        message: options.importMessage ?? `Manually imported ${files.length} files`,
      };
    },
  };

  const log = (): RetryLog => {
    if (options.log instanceof Error) {
      throw options.log;
    }
    return { text: options.log ?? '', modifiedAt: clock.now };
  };

  return {
    clients: {
      sonarr,
      decypharr: {
        deleteTorrent: async (infohash) => {
          calls.push(`decypharr.deleteTorrent:${infohash}`);
          if (options.failTorrentDelete) {
            throw new Error('DELETE /api/browse/torrents responded 500');
          }
          return true;
        },
      },
    },
    runtime: {
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      listVideoFiles: async () => [...(options.packFiles ?? [])],
      probe: async (path) => {
        calls.push(`probe:${path.slice(path.lastIndexOf('/') + 1)}`);
        if (options.unreadable?.includes(path)) {
          throw new Error('Invalid data found when processing input');
        }
      },
      readDecypharrLog: async () => log(),
      timeZone: 'UTC',
    },
    calls,
    grabs,
    imports,
    episodes,
    clock,
    history,
  };
}

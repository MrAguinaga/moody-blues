import type { HistoryRecord, SeerrMedia, TitleResource } from '@moody-blues/provisioner';

import type { RemoveArrClient, RemoveClients, RemoveKind } from './remove.types';

export interface RemoveDoublesOptions {
  movies?: readonly TitleResource[];
  series?: readonly TitleResource[];
  movieHistory?: readonly HistoryRecord[];
  seriesHistory?: readonly HistoryRecord[];
  torrents?: readonly string[];
  media?: readonly SeerrMedia[];
  failLibraryDelete?: boolean;
  failTorrents?: readonly string[];
  failSeerr?: boolean;
  failJellyfin?: boolean;
}

export interface RemoveDoubles {
  clients: RemoveClients;
  calls: string[];
  torrents: Set<string>;
  media: SeerrMedia[];
  library: Record<RemoveKind, TitleResource[]>;
}

export const NIGHT_HASH = 'c610ad37c610ad37c610ad37c610ad37c610ad37';
export const OTHER_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export const NIGHT_OF_THE_LIVING_DEAD: TitleResource = {
  id: 1,
  title: 'Night of the Living Dead',
  originalTitle: 'Night of the Living Dead',
  year: 1968,
  path: '/data/media/movies/Night of the Living Dead (1968)',
  tmdbId: 10331,
};

export const BIG_BUCK_BUNNY: TitleResource = {
  id: 2,
  title: 'Big Buck Bunny',
  year: 2008,
  path: '/data/media/movies/Big Buck Bunny (2008)',
  tmdbId: 10378,
};

export const CLASSIC_SERIES: TitleResource = {
  id: 7,
  title: 'Cosmos',
  year: 1980,
  path: '/data/media/tv/Cosmos (1980)',
  tmdbId: 1100,
  tvdbId: 72440,
};

export function grabbed(
  idField: 'movieId' | 'seriesId',
  titleId: number,
  downloadId: string,
  sourceTitle: string,
): HistoryRecord {
  return { eventType: 'grabbed', [idField]: titleId, downloadId, sourceTitle };
}

export function createRemoveDoubles(options: RemoveDoublesOptions = {}): RemoveDoubles {
  const calls: string[] = [];
  const torrents = new Set(options.torrents ?? []);
  const media = [...(options.media ?? [])];
  const library: Record<RemoveKind, TitleResource[]> = {
    movie: [...(options.movies ?? [])],
    series: [...(options.series ?? [])],
  };
  const histories: Record<RemoveKind, HistoryRecord[]> = {
    movie: [...(options.movieHistory ?? [])],
    series: [...(options.seriesHistory ?? [])],
  };
  const idField = { movie: 'movieId', series: 'seriesId' } as const;

  const arr = (kind: RemoveKind, app: string): RemoveArrClient => ({
    listTitles: async () => library[kind],
    listHistory: async (titleId) =>
      histories[kind].filter((record) => record[idField[kind]] === titleId),
    listHistoryByDownloadId: async (downloadId) =>
      histories[kind].filter((record) => record.downloadId === downloadId),
    deleteTitle: async (id) => {
      calls.push(`${app}.deleteTitle:${id}`);
      if (options.failLibraryDelete) {
        throw new Error(`DELETE /api/v3/${kind} responded 500: disk error`);
      }
      library[kind] = library[kind].filter((title) => title.id !== id);
    },
  });

  const clients: RemoveClients = {
    radarr: arr('movie', 'radarr'),
    sonarr: arr('series', 'sonarr'),
    decypharr: {
      deleteTorrent: async (infohash) => {
        calls.push(`decypharr.deleteTorrent:${infohash}`);
        if (options.failTorrents?.includes(infohash)) {
          throw new Error('DELETE /api/browse/torrents responded 500');
        }
        return torrents.delete(infohash);
      },
    },
    seerr: {
      findMedia: async ({ mediaType, tmdbId, tvdbId }) => {
        calls.push(`seerr.findMedia:${mediaType}`);
        if (options.failSeerr) {
          throw new Error('GET /api/v1/media responded 500');
        }
        return media.find(
          (candidate) =>
            candidate.mediaType === mediaType &&
            (candidate.tmdbId === tmdbId || (tvdbId !== undefined && candidate.tvdbId === tvdbId)),
        );
      },
      deleteMedia: async (id) => {
        calls.push(`seerr.deleteMedia:${id}`);
        const index = media.findIndex((candidate) => candidate.id === id);
        if (index >= 0) {
          media.splice(index, 1);
        }
        return index >= 0;
      },
    },
    jellyfin: {
      refreshLibrary: async () => {
        calls.push('jellyfin.refreshLibrary');
        if (options.failJellyfin) {
          throw new Error('POST /Library/Refresh responded 401');
        }
      },
    },
  };

  return { clients, calls, torrents, media, library };
}

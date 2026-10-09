import type { LibrarySpec } from './jellyfin.types';

export const JELLYFIN_CLIENT_NAME = 'moody-blues';
export const JELLYFIN_DEVICE_NAME = 'provisioner';
export const JELLYFIN_DEVICE_ID = 'moody-blues-provisioner';
export const JELLYFIN_CLIENT_VERSION = '1.0.0';

export const JELLYFIN_API_KEY_APP = 'moody-blues';

export const ADMIN_USERNAME_PATTERN = /^(?!\s)[\p{L}\p{Mn}\p{Nd}\p{Pc} \-'._@+]+(?<!\s)$/u;

export const JELLYFIN_LIBRARIES: readonly LibrarySpec[] = [
  { name: 'Películas', collectionType: 'movies', path: '/data/media/movies' },
  { name: 'Series', collectionType: 'tvshows', path: '/data/media/tv' },
];

export const JELLYFIN_SERVER_SETTINGS = {
  ServerName: 'Moody Blues',
  EnableLegacyAuthorization: false,
  EnableMetrics: false,
} as const;

export const ENCODING_SAFEGUARDS = {
  TranscodingTempPath: '/cache/transcodes',
  EnableSegmentDeletion: true,
  EnableThrottling: true,
  SegmentKeepSeconds: 300,
} as const;

export const VAAPI_DEVICE_PATH = '/dev/dri/renderD128';

export const METADATA_PROVIDER = 'TheMovieDb';

export const LIBRARY_ITEM_TYPES: Readonly<
  Record<LibrarySpec['collectionType'], readonly string[]>
> = {
  movies: ['Movie'],
  tvshows: ['Series', 'Season', 'Episode'],
};

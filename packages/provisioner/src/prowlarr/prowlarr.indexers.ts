import type { IndexerSpec } from './prowlarr.types';

export const MIN_SEEDERS = 1;

export const PROWLARR_INDEXERS: readonly IndexerSpec[] = [
  { definitionName: '1337x', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'thepiratebay', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'yts', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'eztv', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'nyaasi', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'Knaben', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'limetorrents', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'kickasstorrents-to', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'torrentdownloads', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'uindex', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'torrentcore', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'torrentbyte', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'internetarchive', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'showrss', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'SubsPlease', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'animetosho-xyz', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'bangumi-moe', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'nekobt', minimumSeeders: MIN_SEEDERS },
  { definitionName: 'shanaproject', minimumSeeders: MIN_SEEDERS },
];

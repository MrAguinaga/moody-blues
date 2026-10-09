import type { IndexerSpec } from './prowlarr.types';

export const MIN_SEEDERS = 1;

export const PROWLARR_INDEXERS: readonly IndexerSpec[] = [
  { definitionName: '1337x', flaresolverr: true, minimumSeeders: MIN_SEEDERS },
  { definitionName: 'thepiratebay', flaresolverr: false, minimumSeeders: MIN_SEEDERS },
  { definitionName: 'yts', flaresolverr: false, minimumSeeders: MIN_SEEDERS },
  { definitionName: 'eztv', flaresolverr: true, minimumSeeders: MIN_SEEDERS },
  { definitionName: 'nyaasi', flaresolverr: false, minimumSeeders: MIN_SEEDERS },
];

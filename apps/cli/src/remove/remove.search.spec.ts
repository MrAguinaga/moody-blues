import { describe, expect, it } from 'vitest';

import type { TitleResource } from '@moody-blues/provisioner';

import { findTitleByExternalId, findTitles, normalizeText } from './remove.search';
import { BIG_BUCK_BUNNY, CLASSIC_SERIES, NIGHT_OF_THE_LIVING_DEAD } from './remove.testing';
import type { RemoveLibrary } from './remove.types';

const library: RemoveLibrary = {
  movies: [
    NIGHT_OF_THE_LIVING_DEAD,
    BIG_BUCK_BUNNY,
    {
      id: 3,
      title: 'La Noche de los Muertos Vivientes',
      originalTitle: 'Night of the Living Dead',
      year: 1990,
      tmdbId: 10332,
    },
    {
      id: 4,
      title: 'Amélie',
      originalTitle: 'Le Fabuleux Destin d’Amélie Poulain',
      year: 2001,
      tmdbId: 194,
    },
  ],
  series: [CLASSIC_SERIES, { id: 8, title: 'Alien Earth', year: 2025, tmdbId: 1, tvdbId: 2 }],
};

const ids = (titles: { id: number; kind: string }[]) =>
  titles.map(({ kind, id }) => `${kind}:${id}`);

describe('normalizeText', () => {
  it('ignores case, accents and repeated spaces', () => {
    expect(normalizeText('  ÁMÉLIE   Poulain ')).toBe('amelie poulain');
  });
});

describe('findTitles', () => {
  it('matches without case or accents', () => {
    expect(ids(findTitles('amelie', library))).toEqual(['movie:4']);
    expect(ids(findTitles('COSMOS', library))).toEqual(['series:7']);
  });

  it('matches a fragment of the title in movies and series', () => {
    expect(ids(findTitles('big buck', library))).toEqual(['movie:2']);
    expect(ids(findTitles('alien', library))).toEqual(['series:8']);
  });

  it('matches the original title', () => {
    expect(ids(findTitles('fabuleux destin', library))).toEqual(['movie:4']);
  });

  it('keeps only the exact matches when there are some, ordered by title', () => {
    expect(ids(findTitles('night of the living dead', library))).toEqual(['movie:3', 'movie:1']);
  });

  it('lists every partial match when none is exact', () => {
    expect(ids(findTitles('living', library))).toEqual(['movie:3', 'movie:1']);
  });

  it('returns nothing for an unknown or blank query', () => {
    expect(findTitles('zzz', library)).toEqual([]);
    expect(findTitles('   ', library)).toEqual([]);
  });

  it('carries the identifiers and the folder of the title', () => {
    expect(findTitles('cosmos', library)).toEqual([
      {
        kind: 'series',
        id: 7,
        title: 'Cosmos',
        year: 1980,
        path: '/data/media/tv/Cosmos (1980)',
        tmdbId: 1100,
        tvdbId: 72440,
      },
    ]);
  });
});

describe('findTitleByExternalId', () => {
  it('finds a movie by tmdbId and a series by tvdbId', () => {
    expect(findTitleByExternalId('movie', 10378, library)?.id).toBe(2);
    expect(findTitleByExternalId('series', 72440, library)?.id).toBe(7);
  });

  it('does not mix the movie and series id spaces', () => {
    expect(findTitleByExternalId('series', 10378, library)).toBeUndefined();
    expect(findTitleByExternalId('movie', 72440, library)).toBeUndefined();
  });

  it('answers undefined for an unknown id', () => {
    const empty: RemoveLibrary = { movies: [] as TitleResource[], series: [] };
    expect(findTitleByExternalId('movie', 1, empty)).toBeUndefined();
  });
});

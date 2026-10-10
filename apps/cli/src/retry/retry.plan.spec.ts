import { describe, expect, it } from 'vitest';

import {
  buildRetryPlan,
  countActions,
  importableAssignments,
  isWorthSending,
  matchPackFiles,
  parseEpisodeNumber,
  releaseGroupOf,
  replacedQualities,
} from './retry.plan';
import {
  AZUMANGA,
  BLURAY_1080,
  candidateOf,
  DVD,
  episodeFile,
  PACK_EXTRA,
  packFile,
  RELEASE_KAA,
  RELEASE_MAN,
  seasonOf,
} from './retry.testing';

const TARGET = { kind: 'series' as const, id: AZUMANGA.id, title: AZUMANGA.title };

describe('parseEpisodeNumber', () => {
  it.each([
    ['[man] Azumanga Daioh - 01 [BD-DVDRip 1440x1080 x265 FLAC] [67C47DAF].mkv', 1],
    ['/data/downloads/sonarr/Show/Show - 12v2 [1080p].mkv', 12],
    ['Show S01E07 1080p.mkv', 7],
    ['Show.S02.E13.mkv', 13],
    ['Show Episode 05.mkv', 5],
    ['Show 026.mkv', 26],
  ])('reads the episode of %s', (name, expected) => {
    expect(parseEpisodeNumber(name)).toBe(expected);
  });

  it.each([
    'Azumanga Daioh - Creditless Ending [BD 1080p].mkv',
    'Show (2002) [1080p].mkv',
    'Show Season 1.mkv',
  ])('finds no episode in %s', (name) => {
    expect(parseEpisodeNumber(name)).toBeUndefined();
  });
});

describe('releaseGroupOf', () => {
  it('reads the leading group', () => {
    expect(releaseGroupOf(packFile(1))).toBe('man');
    expect(releaseGroupOf('/x/Show - 01.mkv')).toBeUndefined();
  });
});

describe('matchPackFiles', () => {
  const season = seasonOf(4);

  it('assigns each file to its episode by number and ignores the extras', () => {
    const match = matchPackFiles(
      [packFile(2), packFile(1), PACK_EXTRA, `${packFile(1)}.srt`],
      season.episodes,
    );

    expect(match.assignments.map(({ episode }) => episode.episodeNumber)).toEqual([1, 2]);
    expect(match.assignments[0]?.releaseGroup).toBe('man');
    expect(match.ignored).toEqual([PACK_EXTRA]);
  });

  it('ignores a number the season does not have', () => {
    expect(matchPackFiles([packFile(9)], season.episodes)).toMatchObject({
      assignments: [],
      ignored: [packFile(9)],
    });
  });

  it('leaves out both files that claim the same episode', () => {
    const twin = '/data/downloads/sonarr/Azumanga Daioh/Azumanga Daioh - 02 [Extended].mkv';

    const match = matchPackFiles([packFile(2), twin, packFile(3)], season.episodes);

    expect(match.assignments.map(({ episode }) => episode.episodeNumber)).toEqual([3]);
    expect(match.ambiguous).toEqual([packFile(2), twin]);
  });
});

describe('the plan against the files already in the library', () => {
  it('replaces the episodes whose file is worse than the pack and fills the missing ones', () => {
    const season = seasonOf(4, [1, 2]);
    const files = [episodeFile(501, DVD), episodeFile(502, DVD)];

    const plan = buildRetryPlan(TARGET, season, files, candidateOf(RELEASE_MAN));

    expect(countActions(plan)).toEqual({ fill: 2, replace: 2, keep: 0 });
    expect(replacedQualities(plan)).toEqual(['DVD']);
    expect(isWorthSending(plan)).toBe(true);
  });

  it('keeps the episodes whose file is as good as the pack (pack better than the loose ones)', () => {
    const season = seasonOf(4, [1]);

    const plan = buildRetryPlan(
      TARGET,
      season,
      [episodeFile(501, BLURAY_1080)],
      candidateOf(RELEASE_MAN),
    );

    expect(countActions(plan)).toEqual({ fill: 3, replace: 0, keep: 1 });
    expect(isWorthSending(plan)).toBe(true);
  });

  it('is not worth sending when every episode already has a better file', () => {
    const season = seasonOf(2, [1, 2]);
    const files = [episodeFile(501), episodeFile(502)];

    const plan = buildRetryPlan(TARGET, season, files, candidateOf(RELEASE_KAA, { rank: 4801 }));

    expect(countActions(plan)).toEqual({ fill: 0, replace: 0, keep: 2 });
    expect(isWorthSending(plan)).toBe(false);
  });

  it('treats a file without a known quality as replaceable', () => {
    const season = seasonOf(1, [1]);

    const plan = buildRetryPlan(
      TARGET,
      season,
      [{ id: 501, seriesId: 9, seasonNumber: 1 }],
      candidateOf(RELEASE_MAN),
    );

    expect(replacedQualities(plan)).toEqual(['Unknown']);
  });

  it('imports only the pack files of episodes that are filled or replaced', () => {
    const season = seasonOf(3, [1]);
    const plan = buildRetryPlan(TARGET, season, [episodeFile(501)], candidateOf(RELEASE_MAN));
    const match = matchPackFiles([packFile(1), packFile(2), packFile(3)], season.episodes);

    expect(importableAssignments(plan, match).map(({ episode }) => episode.episodeNumber)).toEqual([
      2, 3,
    ]);
  });
});

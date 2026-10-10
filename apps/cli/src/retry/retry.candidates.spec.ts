import { describe, expect, it } from 'vitest';

import { classifyReleases, namesOfSeries, qualityRank } from './retry.candidates';
import {
  AZUMANGA,
  release,
  RELEASE_BLOCKED,
  RELEASE_DUAL,
  RELEASE_KAA,
  RELEASE_LOOSE,
  RELEASE_MAN,
  RELEASE_OTHER,
} from './retry.testing';

const NAMES = namesOfSeries(AZUMANGA);

describe('qualityRank', () => {
  it('orders by resolution first and by source inside a resolution', () => {
    const names = [
      'Unknown',
      'SDTV',
      'DVD',
      'HDTV-720p',
      'Bluray-720p',
      'WEBDL-1080p',
      'Bluray-1080p',
      'Bluray-1080p Remux',
      'WEBDL-2160p',
    ];
    const ranks = names.map(qualityRank);

    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(new Set(ranks).size).toBe(names.length);
  });

  it('puts a DVD above nothing and below any high-definition quality', () => {
    expect(qualityRank(undefined)).toBe(0);
    expect(qualityRank('DVD')).toBeLessThan(qualityRank('HDTV-720p'));
  });
});

describe('namesOfSeries', () => {
  it('collects the title, the original title and the aliases without repeating them', () => {
    expect(namesOfSeries(AZUMANGA)).toEqual([
      'Azumanga Daioh',
      'あずまんが大王',
      'Azumanga Daioh The Animation',
    ]);
  });
});

describe('classifyReleases (real Azumanga Daioh search)', () => {
  const search = classifyReleases(
    [RELEASE_KAA, RELEASE_MAN, RELEASE_DUAL, RELEASE_LOOSE, RELEASE_OTHER, RELEASE_BLOCKED],
    NAMES,
  );

  it('offers the unparsed packs of the series and the recognized full season', () => {
    expect(search.candidates.map((candidate) => candidate.release.title)).toEqual([
      RELEASE_DUAL.title,
      RELEASE_MAN.title,
      RELEASE_KAA.title,
    ]);
  });

  it('marks which candidates Sonarr recognized', () => {
    expect(search.candidates.map((candidate) => candidate.recognized)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('numbers the candidates in the suggested order', () => {
    expect(search.candidates.map((candidate) => candidate.position)).toEqual([1, 2, 3]);
  });

  it('leaves out other series, loose episodes and releases rejected for another reason', () => {
    expect(search.excluded).toBe(3);
  });
});

describe('suggested order', () => {
  it('prefers quality, then custom format score, then seeders', () => {
    const lowQuality = release({
      title: 'Azumanga Daioh 720p',
      quality: { quality: { id: 4, name: 'HDTV-720p' } },
      rejections: ['Unknown Series'],
      customFormatScore: 9000,
      seeders: 900,
    });
    const highScore = release({
      title: 'Azumanga Daioh BD A',
      rejections: ['Unknown Series'],
      customFormatScore: 3000,
      seeders: 1,
    });
    const moreSeeders = release({
      title: 'Azumanga Daioh BD B',
      rejections: ['Unknown Series'],
      customFormatScore: 2000,
      seeders: 500,
    });
    const fewSeeders = release({
      title: 'Azumanga Daioh BD C',
      rejections: ['Unknown Series'],
      customFormatScore: 2000,
      seeders: 5,
    });

    const titles = classifyReleases(
      [fewSeeders, lowQuality, moreSeeders, highScore],
      NAMES,
    ).candidates.map((candidate) => candidate.release.title);

    expect(titles).toEqual([
      'Azumanga Daioh BD A',
      'Azumanga Daioh BD B',
      'Azumanga Daioh BD C',
      'Azumanga Daioh 720p',
    ]);
  });

  it('returns no candidate when nothing qualifies', () => {
    expect(classifyReleases([RELEASE_OTHER, RELEASE_LOOSE], NAMES)).toEqual({
      candidates: [],
      excluded: 2,
    });
  });

  it('matches the series name inside a dotted release name', () => {
    const dotted = release({
      title: 'Azumanga.Daioh.1080p.BluRay.x265',
      rejections: ['Unable to parse release'],
    });

    expect(classifyReleases([dotted], NAMES).candidates).toHaveLength(1);
  });

  it('treats a release already in the queue as recognized', () => {
    const queued = release({
      title: 'Azumanga Daioh S01 1080p',
      fullSeason: true,
      rejections: ['Release in queue already meets cutoff: Bluray-1080p v1'],
    });

    expect(classifyReleases([queued], NAMES).candidates[0]?.recognized).toBe(true);
  });
});

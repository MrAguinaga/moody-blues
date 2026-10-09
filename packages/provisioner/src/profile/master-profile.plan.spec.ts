import { describe, expect, it } from 'vitest';

import { ARR_KINDS, type ArrKind } from '../arr/arr.types';
import { createDefaultConfig } from '../config';
import { matchingFormats, type ReleaseSample, totalScore } from './cf-evaluator.testing';
import {
  BLOCKING_SCORE,
  buildCodecFormats,
  H264_SCORE,
  REPACK_SCORE,
} from './codec-formats.profile';
import {
  AUDIO_PRIORITY_SYMBOLS,
  buildLanguageFormats,
  CASTELLANO_RE,
  DUAL_MARKER_RE,
  LATINO_RE,
} from './language-formats.profile';
import { buildProfilePlan, MASTER_PROFILE_NAME, tierProfileName } from './master-profile.plan';
import {
  type ProfilePlan,
  UnsupportedAudioPriorityError,
  UnsupportedTierError,
} from './profile.types';
import { CUTOFF_GROUP_NAME } from './quality-layers.profile';

const { tiers, languages } = createDefaultConfig();
const [hd] = tiers;
const DEFAULT_PRIORITY = languages.audioPriority;

const WEB_DL: Record<ArrKind, string> = { radarr: 'WEBDL', sonarr: 'Web' };
const WEB_RIP: Record<ArrKind, string> = { radarr: 'WEBRIP', sonarr: 'WebRip' };

function planFor(kind: ArrKind, audioPriority: string[] = DEFAULT_PRIORITY): ProfilePlan {
  return buildProfilePlan(hd!, { audioPriority }, kind);
}

function layerNames(plan: ProfilePlan): string[] {
  return plan.layers.map((layer) => layer.groupName ?? layer.qualityNames.join('+'));
}

function scoreOf(plan: ProfilePlan, name: string): number | undefined {
  return plan.formats.find(({ format }) => format.name === name)?.score;
}

describe('buildProfilePlan', () => {
  it('orders the Radarr qualities from worst to best following ADR-005', () => {
    expect(layerNames(planFor('radarr'))).toEqual([
      'Unknown',
      'WORKPRINT',
      'CAM',
      'TELESYNC',
      'TELECINE',
      'REGIONAL',
      'DVDSCR',
      'SDTV',
      'DVD',
      'DVD-R',
      'WEB 480p',
      'Bluray-480p',
      'Bluray-576p',
      'HDTV-720p',
      'WEB 720p',
      'Bluray-720p',
      'HDTV-1080p',
      'Remux-1080p',
      'HD 1080p',
      'HDTV-2160p',
      'WEB 2160p',
      'Bluray-2160p',
      'Remux-2160p',
      'BR-DISK',
      'Raw-HD',
    ]);
  });

  it('orders the Sonarr qualities from worst to best following ADR-005', () => {
    expect(layerNames(planFor('sonarr'))).toEqual([
      'Unknown',
      'SDTV',
      'WEB 480p',
      'DVD',
      'Bluray-480p',
      'Bluray-576p',
      'HDTV-720p',
      'WEB 720p',
      'Bluray-720p',
      'HDTV-1080p',
      'Bluray-1080p Remux',
      'HD 1080p',
      'HDTV-2160p',
      'WEB 2160p',
      'Bluray-2160p',
      'Bluray-2160p Remux',
      'Raw-HD',
    ]);
  });

  it.each(ARR_KINDS)('puts the Remux below the 1080p encode group in %s', (kind) => {
    const names = layerNames(planFor(kind));
    const remux = names.findIndex((name) => /Remux-?1080p|1080p Remux/.test(name));

    expect(remux).toBeGreaterThan(-1);
    expect(remux).toBeLessThan(names.indexOf(CUTOFF_GROUP_NAME));
  });

  it.each(ARR_KINDS)('uses the HD 1080p group as an allowed cutoff in %s', (kind) => {
    const plan = planFor(kind);
    const cutoff = plan.layers.find((layer) => layer.groupName === plan.cutoffGroupName);

    expect(plan.cutoffGroupName).toBe('HD 1080p');
    expect(cutoff).toMatchObject({
      allowed: true,
      qualityNames: ['WEBRip-1080p', 'WEBDL-1080p', 'Bluray-1080p'],
    });
  });

  it.each(ARR_KINDS)('excludes 2160p, BR-DISK, Raw-HD, Workprint and Unknown in %s', (kind) => {
    const disabled = planFor(kind)
      .layers.filter((layer) => !layer.allowed)
      .flatMap((layer) => layer.qualityNames);

    expect(disabled).toEqual(
      expect.arrayContaining([
        'Unknown',
        'HDTV-2160p',
        'WEBDL-2160p',
        'WEBRip-2160p',
        'Bluray-2160p',
        'Raw-HD',
      ]),
    );
    if (kind === 'radarr') {
      expect(disabled).toEqual(expect.arrayContaining(['WORKPRINT', 'BR-DISK', 'Remux-2160p']));
    }
    expect(disabled).not.toContain('Bluray-1080p');
    expect(disabled).not.toContain('SDTV');
  });

  it('allows the lowest tiers that ADR-005 does not exclude', () => {
    const allowed = planFor('radarr')
      .layers.filter((layer) => layer.allowed)
      .flatMap((layer) => layer.qualityNames);

    expect(allowed).toEqual(
      expect.arrayContaining(['CAM', 'DVDSCR', 'DVD-R', 'REGIONAL', 'Bluray-576p']),
    );
  });

  it('assigns the profile numbers of the design', () => {
    expect(planFor('sonarr')).toMatchObject({
      name: 'Moody Blues',
      upgradeAllowed: true,
      minFormatScore: 0,
      cutoffFormatScore: 4000,
      minUpgradeFormatScore: 50,
    });
  });

  it('sets the Any language only for Radarr', () => {
    expect(planFor('radarr').languageName).toBe('Any');
    expect(planFor('sonarr').languageName).toBeUndefined();
  });

  it('derives the cutoff format score from the first audio priority', () => {
    expect(planFor('radarr', ['es-419', 'es-ES']).cutoffFormatScore).toBe(2000);
    expect(planFor('radarr', []).cutoffFormatScore).toBe(0);
  });
});

describe('tiers', () => {
  it('names the profile of the 1080p tier', () => {
    expect(tierProfileName(hd!)).toBe(MASTER_PROFILE_NAME);
    expect(MASTER_PROFILE_NAME).toBe('Moody Blues');
  });

  it.each(ARR_KINDS)('rejects a 2160p tier in %s', (kind) => {
    const tier = { id: 'uhd', label: '4K', maxResolution: '2160p' };

    expect(() => buildProfilePlan(tier, { audioPriority: DEFAULT_PRIORITY }, kind)).toThrow(
      UnsupportedTierError,
    );
    expect(() => tierProfileName(tier)).toThrow(/2160p/);
  });
});

describe('scores', () => {
  it('maps the default audio priority to steps of 1000', () => {
    const plan = planFor('radarr');

    expect(
      ['Dual Latino', 'Latino', 'Original', 'Castellano'].map((name) => scoreOf(plan, name)),
    ).toEqual([4000, 3000, 2000, 1000]);
    expect(scoreOf(plan, 'H.264')).toBe(150);
    expect(scoreOf(plan, 'Repack/Proper')).toBe(5);
    expect(scoreOf(plan, 'DV sin fallback HDR10')).toBe(-10000);
    expect(scoreOf(plan, 'AV1')).toBe(-10000);
  });

  it('does not score HEVC', () => {
    expect(planFor('radarr').formats.map(({ format }) => format.name)).not.toContain('HEVC');
  });

  it.each(ARR_KINDS)('gives a negative score only to DV and AV1 in %s', (kind) => {
    const negative = planFor(kind)
      .formats.filter(({ score }) => score < 0)
      .map(({ format }) => format.name);

    expect(negative.sort()).toEqual(['AV1', 'DV sin fallback HDR10']);
  });

  it('keeps the highest reachable positive score far below the blocking score', () => {
    const plan = planFor('sonarr');
    const best = Math.max(...plan.formats.map(({ score }) => score));

    expect(best + H264_SCORE + REPACK_SCORE).toBe(4155);
    expect(best + H264_SCORE + REPACK_SCORE).toBeLessThan(Math.abs(BLOCKING_SCORE));
  });

  it('scores strictly decreasing for every permutation of the audio priority', () => {
    const permutations = (items: readonly string[]): string[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, index) =>
            permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
              item,
              ...rest,
            ]),
          );

    const orders = permutations(AUDIO_PRIORITY_SYMBOLS);

    expect(orders).toHaveLength(24);
    for (const order of orders) {
      const scores = buildLanguageFormats(order).map(({ score }) => score);

      expect(scores).toEqual([4000, 3000, 2000, 1000]);
    }
  });

  it('names the formats after the priority order they were given', () => {
    const names = buildLanguageFormats(['es-ES', 'original']).map(({ format }) => format.name);

    expect(names).toEqual(['Castellano', 'Original']);
  });

  it('leaves out the formats of absent audio priorities', () => {
    const scored = buildLanguageFormats(['es-419']);

    expect(scored.map(({ format, score }) => [format.name, score])).toEqual([['Latino', 1000]]);
  });

  it('rejects unknown and repeated audio priorities', () => {
    expect(() => buildLanguageFormats(['es-419', 'fr-FR'])).toThrow(UnsupportedAudioPriorityError);
    expect(() => buildLanguageFormats(['original', 'original'])).toThrow(/more than once/);
  });

  it('keeps the textual brand in file names for the language formats that have one', () => {
    const included = planFor('radarr')
      .formats.filter(({ format }) => format.includeCustomFormatWhenRenaming)
      .map(({ format }) => format.name);

    expect(included).toEqual(['Dual Latino', 'Latino', 'Castellano']);
  });
});

describe('regular expressions', () => {
  it('compile as JavaScript patterns', () => {
    for (const pattern of [LATINO_RE, DUAL_MARKER_RE, CASTELLANO_RE]) {
      expect(() => new RegExp(pattern, 'i')).not.toThrow();
    }
  });
});

interface TitleCase {
  title: string;
  source?: 'web-dl' | 'web-rip';
  languages?: string[];
  expected: string[];
}

const TITLE_TABLE: TitleCase[] = [
  {
    title: 'Pelicula.2024.1080p.WEB-DL.DUAL.Latino.English.x264-GRP',
    expected: ['Dual Latino', 'H.264'],
  },
  { title: 'Movie.2024.1080p.BluRay.Lat-Eng.x265-GRP', expected: ['Dual Latino'] },
  { title: 'Movie.2024.1080p.WEB-DL.Latino.x264-GRP', expected: ['Latino', 'H.264'] },
  {
    title: 'Pelicula.2024.1080p.WEB-DL.Español.Latino.x264-GRP',
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Pelicula.2024.1080p.BluRay.Castellano.x264-GRP',
    languages: ['Spanish'],
    expected: ['Castellano', 'H.264'],
  },
  { title: 'Movie.2024.1080p.WEB-DL.x264-GRP', expected: ['Original', 'H.264'] },
  {
    title: 'Movie.2024.1080p.WEB-DL.DV.x265-GRP',
    source: 'web-dl',
    expected: ['Original', 'DV sin fallback HDR10'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.DV.x265-Flights',
    source: 'web-dl',
    expected: ['Original'],
  },
  {
    title: 'Movie.2024.1080p.WEBRip.Dolby.Vision.x265-GRP',
    source: 'web-rip',
    expected: ['Original', 'DV sin fallback HDR10'],
  },
  { title: 'Movie.2024.1080p.BluRay.DV.x265-GRP', expected: ['Original'] },
  { title: 'Movie.2024.1080p.WEB-DL.DV.HDR10.x265-GRP', source: 'web-dl', expected: ['Original'] },
  { title: 'Movie.2024.1080p.WEB-DL.AV1-GRP', expected: ['Original', 'AV1'] },
  {
    title: 'Movie.2024.1080p.WEB-DL.REPACK.x264-GRP',
    expected: ['Original', 'H.264', 'Repack/Proper'],
  },
  { title: 'Movie.2024.1080p.WEB-DL.REPACK2.x264-GRP', expected: ['Original', 'H.264'] },
  {
    title: 'The.English.Patient.1996.1080p.BluRay.Latino.x264-GRP',
    languages: ['Spanish (Latino)'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Original.Sin.S01E01.1080p.WEB-DL.Latino.x264-GRP',
    languages: ['Spanish (Latino)'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Dual.2022.1080p.WEB-DL.Latino.x264-GRP',
    languages: ['Spanish (Latino)'],
    expected: ['Latino', 'H.264'],
  },
  { title: 'Cast.Away.2000.1080p.BluRay.x264-GRP', expected: ['Original', 'H.264'] },
  {
    title: 'The.Spanish.Princess.S01E01.1080p.WEB-DL.x264-GRP',
    expected: ['Original', 'H.264'],
  },
  { title: 'Spa.Night.2016.1080p.WEB-DL.x264-GRP', expected: ['Original', 'H.264'] },
  {
    title: 'Pelicula.Latino.2024.1080p.WEB-DL.x264-GRP',
    expected: ['Original', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.Latino.English.Subs.x264-GRP',
    languages: ['English', 'Spanish (Latino)'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.English.Subs.Latino.x264-GRP',
    languages: ['English', 'Spanish (Latino)'],
    expected: ['Original', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.Latino.Subs.English.x264-GRP',
    languages: ['English', 'Spanish (Latino)'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.x264-GRP.Subs.Esp',
    expected: ['Original', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.CAST.x264-GRP',
    expected: ['Original', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.Castellano.English.x264-GRP',
    languages: ['English', 'Spanish'],
    expected: ['Original', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.SPA.x264-GRP',
    languages: ['Spanish'],
    expected: ['Castellano', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.Lat.x264-GRP',
    languages: ['Latvian'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.ES-419.x264-GRP',
    languages: ['Spanish'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.ES.LA.x264-GRP',
    languages: ['Spanish'],
    expected: ['Latino', 'H.264'],
  },
  {
    title: 'Serie.S01E01.1080p.WEB-DL.MULTi.Latino.x264-GRP',
    languages: ['Spanish (Latino)'],
    expected: ['Dual Latino', 'H.264'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.Esp.Lat.x264-GRP',
    languages: ['Latvian'],
    expected: ['Dual Latino', 'H.264'],
  },
  { title: 'Movie.2024.1080p.WEB-DL.DUAL.x264-GRP', expected: ['Original', 'H.264'] },
  {
    title: 'Serie.S01E01.720p.HDTV.Latino.x264-GRP',
    languages: ['Spanish (Latino)'],
    expected: ['Latino', 'H.264'],
  },
  { title: 'Movie.2024.1080p.BluRay.AVC-GRP', expected: ['Original', 'H.264'] },
  { title: 'Movie.2024.1080p.WEB-DL.H.264-GRP', expected: ['Original', 'H.264'] },
  { title: 'Movie.2024.1080p.WEB-DL.x265.HEVC-GRP', expected: ['Original'] },
  { title: 'Movie.2024.1080p.WEB-DL.DV.HDR.x265-GRP', source: 'web-dl', expected: ['Original'] },
  {
    title: 'Movie.2024.1080p.WEB-DL.Dolby.Vision.x265-GRP',
    source: 'web-dl',
    expected: ['Original', 'DV sin fallback HDR10'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.Latino.AV1-GRP',
    languages: ['Spanish (Latino)'],
    expected: ['Latino', 'AV1'],
  },
  {
    title: 'Movie.2024.1080p.WEB-DL.REAL.PROPER.x264-GRP',
    expected: ['Original', 'H.264'],
  },
];

describe.each(ARR_KINDS)('title table (%s)', (kind) => {
  const plan = planFor(kind);
  const sources = { 'web-dl': WEB_DL[kind], 'web-rip': WEB_RIP[kind] };
  const languageNames = buildLanguageFormats(DEFAULT_PRIORITY).map(({ format }) => format.name);

  it.each(TITLE_TABLE)('matches $expected for $title', ({ title, source, languages, expected }) => {
    const release: ReleaseSample = {
      title,
      languages,
      source: source ? sources[source] : undefined,
    };

    expect(matchingFormats(plan.formats, release)).toEqual(expected);
  });

  it('lets exactly one language format match when the release carries the original language', () => {
    for (const { title, languages } of TITLE_TABLE) {
      const matched = matchingFormats(plan.formats, { title, languages }).filter((name) =>
        languageNames.includes(name),
      );

      expect(matched, title).toHaveLength(1);
    }
  });

  it('ranks Dual Latino above Latino above Original above Castellano by score alone', () => {
    const score = (title: string, languages?: string[]) =>
      totalScore(plan.formats, { title, languages });

    expect(score('Movie.2024.1080p.WEB-DL.DUAL.Latino.x264-GRP')).toBeGreaterThan(
      score('Movie.2024.1080p.WEB-DL.Latino.x264-GRP'),
    );
    expect(score('Movie.2024.1080p.WEB-DL.Latino.x264-GRP')).toBeGreaterThan(
      score('Movie.2024.1080p.WEB-DL.x264-GRP'),
    );
    expect(score('Movie.2024.1080p.WEB-DL.x264-GRP')).toBeGreaterThan(
      score('Movie.2024.1080p.WEB-DL.Castellano.x264-GRP', ['Spanish']),
    );
  });

  it('prefers the language over the codec', () => {
    const score = (title: string) => totalScore(plan.formats, { title });

    expect(score('Movie.2024.1080p.WEB-DL.Latino.x265-GRP')).toBeGreaterThan(
      score('Movie.2024.1080p.WEB-DL.x264-GRP'),
    );
  });

  it('lets a blocked release score below the rejection floor', () => {
    expect(
      totalScore(plan.formats, { title: 'Movie.2024.1080p.WEB-DL.DUAL.Latino.AV1-GRP' }),
    ).toBeLessThan(plan.minFormatScore);
  });

  it('declares eight formats with unique names', () => {
    const names = plan.formats.map(({ format }) => format.name);

    expect(new Set(names).size).toBe(8);
    expect(buildCodecFormats(kind)).toHaveLength(4);
  });
});

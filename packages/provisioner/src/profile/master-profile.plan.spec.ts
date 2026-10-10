import { describe, expect, it } from 'vitest';

import { ARR_KINDS, type ArrKind } from '../arr/arr.types';
import { createDefaultConfig } from '../config';
import { matchingFormats, type ReleaseSample, totalScore } from './cf-evaluator.testing';
import {
  BLOCKING_SCORE,
  buildCodecFormats,
  FOREIGN_SUBTITLES_RE,
  H264_SCORE,
  REMUX_SCORE,
  REPACK_SCORE,
  RESOLUTION_1080P_SCORE,
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
const LANGUAGE_STEP = 1000;

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
  it('orders the Radarr qualities from worst to best following ADR-018', () => {
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
      'HD',
      'HDTV-2160p',
      'WEB 2160p',
      'Bluray-2160p',
      'Remux-2160p',
      'BR-DISK',
      'Raw-HD',
    ]);
  });

  it('orders the Sonarr qualities from worst to best following ADR-018', () => {
    expect(layerNames(planFor('sonarr'))).toEqual([
      'Unknown',
      'SDTV',
      'WEB 480p',
      'DVD',
      'Bluray-480p',
      'Bluray-576p',
      'HD',
      'HDTV-2160p',
      'WEB 2160p',
      'Bluray-2160p',
      'Bluray-2160p Remux',
      'Raw-HD',
    ]);
  });

  const HD_MEMBERS: Record<ArrKind, string[]> = {
    radarr: [
      'HDTV-720p',
      'WEBDL-720p',
      'WEBRip-720p',
      'Bluray-720p',
      'HDTV-1080p',
      'Remux-1080p',
      'WEBRip-1080p',
      'WEBDL-1080p',
      'Bluray-1080p',
    ],
    sonarr: [
      'HDTV-720p',
      'WEBRip-720p',
      'WEBDL-720p',
      'Bluray-720p',
      'HDTV-1080p',
      'Bluray-1080p Remux',
      'WEBRip-1080p',
      'WEBDL-1080p',
      'Bluray-1080p',
    ],
  };

  it.each(ARR_KINDS)(
    'merges the 720p and 1080p qualities and the Remux into the HD group in %s',
    (kind) => {
      const plan = planFor(kind);
      const cutoff = plan.layers.find((layer) => layer.groupName === plan.cutoffGroupName);

      expect(plan.cutoffGroupName).toBe(CUTOFF_GROUP_NAME);
      expect(CUTOFF_GROUP_NAME).toBe('HD');
      expect(cutoff).toMatchObject({ allowed: true, qualityNames: HD_MEMBERS[kind] });
    },
  );

  it.each(ARR_KINDS)('keeps the SD qualities below the HD group and enabled in %s', (kind) => {
    const plan = planFor(kind);
    const names = layerNames(plan);
    const sd = ['SDTV', 'DVD', 'WEB 480p', 'Bluray-480p', 'Bluray-576p'];

    for (const quality of sd) {
      expect(names.indexOf(quality), quality).toBeGreaterThan(-1);
      expect(names.indexOf(quality), quality).toBeLessThan(names.indexOf(CUTOFF_GROUP_NAME));
    }
    expect(
      plan.layers.filter((layer) => sd.includes(layer.groupName ?? layer.qualityNames[0]!)),
    ).toSatisfy((layers: ProfilePlan['layers']) => layers.every((layer) => layer.allowed));
  });

  it.each(ARR_KINDS)('lists no quality twice and no group but HD above 720p in %s', (kind) => {
    const names = planFor(kind).layers.flatMap((layer) => layer.qualityNames);

    expect(new Set(names).size).toBe(names.length);
    expect(
      planFor(kind)
        .layers.filter((layer) => layer.groupName !== undefined)
        .map((l) => l.groupName),
    ).toEqual(['WEB 480p', 'HD', 'WEB 2160p']);
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
    expect(disabled).not.toContain('HDTV-720p');
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
      cutoffFormatScore: 4400,
      minUpgradeFormatScore: 50,
    });
  });

  it('sets the Any language only for Radarr', () => {
    expect(planFor('radarr').languageName).toBe('Any');
    expect(planFor('sonarr').languageName).toBeUndefined();
  });

  it('derives the cutoff format score from the first audio priority', () => {
    expect(planFor('radarr', ['es-419', 'es-ES']).cutoffFormatScore).toBe(2400);
    expect(planFor('radarr', []).cutoffFormatScore).toBe(400);
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
    expect(scoreOf(plan, '1080p')).toBe(400);
    expect(scoreOf(plan, 'Remux')).toBe(-300);
    expect(scoreOf(plan, 'Subtítulos ajenos')).toBe(-1500);
    expect(scoreOf(plan, 'H.264')).toBe(150);
    expect(scoreOf(plan, 'Repack/Proper')).toBe(5);
    expect(scoreOf(plan, 'DV sin fallback HDR10')).toBe(-10000);
    expect(scoreOf(plan, 'AV1')).toBe(-10000);
  });

  it('does not score HEVC', () => {
    expect(planFor('radarr').formats.map(({ format }) => format.name)).not.toContain('HEVC');
  });

  it.each(ARR_KINDS)(
    'gives a negative score only to Remux, foreign subtitles, DV and AV1 in %s',
    (kind) => {
      const negative = planFor(kind)
        .formats.filter(({ score }) => score < 0)
        .map(({ format }) => format.name);

      expect(negative.sort()).toEqual([
        'AV1',
        'DV sin fallback HDR10',
        'Remux',
        'Subtítulos ajenos',
      ]);
    },
  );

  it('keeps the highest reachable positive score far below the blocking score', () => {
    const plan = planFor('sonarr');
    const best = Math.max(...plan.formats.map(({ score }) => score));

    expect(best + RESOLUTION_1080P_SCORE + H264_SCORE + REPACK_SCORE).toBe(4555);
    expect(best + RESOLUTION_1080P_SCORE + H264_SCORE + REPACK_SCORE).toBeLessThan(
      Math.abs(BLOCKING_SCORE),
    );
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
    for (const pattern of [LATINO_RE, DUAL_MARKER_RE, CASTELLANO_RE, FOREIGN_SUBTITLES_RE]) {
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

const RESOLUTION_AND_SUBTITLE_FORMATS = ['1080p', 'Remux', 'Subtítulos ajenos'];

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

    expect(
      matchingFormats(plan.formats, release).filter(
        (name) => !RESOLUTION_AND_SUBTITLE_FORMATS.includes(name),
      ),
    ).toEqual(expected);
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

  it('declares eleven formats with unique names', () => {
    const names = plan.formats.map(({ format }) => format.name);

    expect(new Set(names).size).toBe(11);
    expect(buildCodecFormats(kind)).toHaveLength(7);
  });
});

describe.each(ARR_KINDS)('language-first scores (%s)', (kind) => {
  const plan = planFor(kind);
  const remux: ReleaseSample =
    kind === 'radarr'
      ? { title: 'Serie.S01E01.1080p.BluRay.REMUX.x264-GRP', qualityModifier: 'REMUX' }
      : { title: 'Serie.S01E01.1080p.BluRay.REMUX.x264-GRP', source: 'BlurayRaw' };

  const SCORE_TABLE: { label: string; release: ReleaseSample; expected: number }[] = [
    {
      label: 'Dual Latino, WEB-DL 1080p, H.264',
      release: { title: 'Serie.S01E01.1080p.WEB-DL.DUAL.Latino.x264-GRP', source: WEB_DL[kind] },
      expected: 4550,
    },
    {
      label: 'Dual Latino, WEB-DL 720p, H.264',
      release: { title: 'Serie.S01E01.720p.WEB-DL.DUAL.Latino.x264-GRP', source: WEB_DL[kind] },
      expected: 4150,
    },
    {
      label: 'Latino, Bluray-1080p, HEVC',
      release: { title: 'Serie.S01E01.1080p.BluRay.Latino.x265-GRP' },
      expected: 3400,
    },
    {
      label: 'Original, Bluray-1080p, H.264',
      release: { title: 'Serie.S01E01.1080p.BluRay.x264-GRP' },
      expected: 2550,
    },
    { label: 'Original, Remux 1080p, H.264', release: remux, expected: 2250 },
    {
      label: 'Original, Bluray-1080p HEVC, subITA',
      release: { title: 'Serie.S01E01.1080p.BluRay.x265.subITA-GRP' },
      expected: 900,
    },
    {
      label: 'Castellano, WEB-DL 1080p, H.264',
      release: {
        title: 'Serie.S01E01.1080p.WEB-DL.Castellano.x264-GRP',
        languages: ['Spanish'],
        source: WEB_DL[kind],
      },
      expected: 1550,
    },
  ];

  it.each(SCORE_TABLE)('scores $label as $expected', ({ release, expected }) => {
    expect(totalScore(plan.formats, release)).toBe(expected);
  });

  it('reaches the cutoff score exactly with a Dual Latino 1080p release', () => {
    const release = { title: 'Serie.S01E01.1080p.WEB-DL.DUAL.Latino-GRP', source: WEB_DL[kind] };

    expect(totalScore(plan.formats, release)).toBe(plan.cutoffFormatScore);
  });

  it('ranks every language above any combination of the other positive formats', () => {
    const languageNames = buildLanguageFormats(DEFAULT_PRIORITY).map(({ format }) => format.name);
    const otherPositives = plan.formats
      .filter(({ format, score }) => !languageNames.includes(format.name) && score > 0)
      .reduce((sum, { score }) => sum + score, 0);

    expect(otherPositives).toBe(555);
    expect(otherPositives).toBeLessThan(LANGUAGE_STEP);
  });

  it('puts a Latino 720p release above an Original 1080p one', () => {
    const latino720 = totalScore(plan.formats, { title: 'Serie.S01E01.720p.HDTV.Latino.x264-GRP' });
    const original1080 = totalScore(plan.formats, { title: 'Serie.S01E01.1080p.BluRay.x264-GRP' });

    expect(latino720).toBeGreaterThan(original1080);
  });

  it('still prefers the 1080p release of the same language and codec by more than the minimum upgrade', () => {
    const p720 = totalScore(plan.formats, { title: 'Serie.S01E01.720p.WEB-DL.x264-GRP' });
    const p1080 = totalScore(plan.formats, { title: 'Serie.S01E01.1080p.WEB-DL.x264-GRP' });

    expect(p1080 - p720).toBe(RESOLUTION_1080P_SCORE);
    expect(p1080 - p720).toBeGreaterThan(plan.minUpgradeFormatScore);
  });

  it('puts the Remux below the 1080p encode of the same language and codec', () => {
    const encode = totalScore(plan.formats, { title: 'Serie.S01E01.1080p.BluRay.x264-GRP' });

    expect(totalScore(plan.formats, remux)).toBe(encode + REMUX_SCORE);
  });

  it('detects the Remux only through the condition of each application', () => {
    const [remuxFormat] = plan.formats.filter(({ format }) => format.name === 'Remux');

    expect(remuxFormat?.format.specifications).toHaveLength(1);
    expect(remuxFormat?.format.specifications[0]).toMatchObject(
      kind === 'radarr'
        ? { implementation: 'QualityModifierSpecification', fields: { value: { option: 'REMUX' } } }
        : { implementation: 'SourceSpecification', fields: { value: { option: 'BlurayRaw' } } },
    );
    expect(
      matchingFormats(plan.formats, { title: 'Serie.S01E01.1080p.BluRay.x264-GRP' }),
    ).not.toContain('Remux');
    expect(matchingFormats(plan.formats, remux)).toContain('Remux');
  });

  it('keeps a release with foreign subtitles acceptable but below every clean language release', () => {
    const withSubs = totalScore(plan.formats, {
      title: 'Serie.S01E01.1080p.BluRay.x264.subITA-GRP',
    });
    const clean = totalScore(plan.formats, {
      title: 'Serie.S01E01.720p.WEB-DL.Castellano.x264-GRP',
      languages: ['Spanish'],
    });

    expect(withSubs).toBeGreaterThanOrEqual(500);
    expect(withSubs).toBeLessThan(
      totalScore(plan.formats, { title: 'Serie.S01E01.1080p.BluRay.x264-GRP' }),
    );
    expect(clean).toBeGreaterThan(0);
  });

  const PENALIZED = [
    'Serie.S01E01.1080p.BluRay.x264.subITA-GRP',
    'Serie.S01E01.1080p.BluRay.x264.ITA.sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.ITA.Subs-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Sub.Ita-GRP',
    'Serie.S01E01.1080p.BluRay.x264.VOSTFR-GRP',
    'Serie.S01E01.1080p.BluRay.x264.VOSTA-GRP',
    'Serie.S01E01.1080p.BluRay.x264.GERSub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.GER.Sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.RUS.sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Subs.Rus.Eng-GRP',
    'Serie.S01E01.1080p.BluRay.x264.FRENCH.SUBS-GRP',
    'Serie.S01E01.1080p.BluRay.x264.PT-BR.Subs-GRP',
    'Serie.S01E01.1080p.BluRay.x264.ARA.Sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.CHS.Sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.HardSubITA-GRP',
    'Show.2002.1080p.BluRay.x264.ITA.SUB-GRP',
    '[GattoNero] Azumanga Daioh - 01 [BD][HEVC 10bit FLAC][subITA]',
    '[Grupo] Serie - 05v2 [BD][subITA]',
    'JoJos.Bizarre.Adventure.S06E04.1080p.WEB-DL.H264.subITA-GROUP',
  ];

  const CLEAN = [
    'Serie.S01E01.1080p.BluRay.x264.MultiSub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Multi-Subs-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Multi.Subs-GRP',
    'Serie.S01E01.1080p.BluRay.x264.English.Subs-GRP',
    'Serie.S01E01.1080p.BluRay.x264.ENG.sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Subs.Esp-GRP',
    'Serie.S01E01.1080p.BluRay.x264.SPA.Sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Subs.Latino-GRP',
    'Serie.S01E01.1080p.BluRay.x264.JPN.Sub-GRP',
    'Serie.S01E01.1080p.BluRay.x264.Subs.Japanese-GRP',
    'Serie.S01E01.1080p.BluRay.ENG.LATINO.HINDI.ITA.GER.x264-GRP',
    'Serie.S01E01.1080p.BluRay.MULTi.ITA.x264-GRP',
    'Serie.S01E01.1080p.BluRay.x264.ITA-GRP',
    'Serie.S01E01.1080p.BluRay.x264-GRP',
    'Sub.Ita.2020.1080p.BluRay.x264-GRP',
    'Subs.German.S01E01.1080p.BluRay.x264-GRP',
    'JoJo no Kimyou na Bouken - Steel Ball Run - 04 [1080p NF WEB-DL AVC AAC][MultiSub][CE60799F] [Erai-raws]',
    'JoJos Bizarre Adventure 2012 S06E04 1080p NF WEB-DL AAC2 0 H 264 DUAL-BiOMA',
    'Spider-Man - Into the Spider-Verse 2018 1080p BluRay x264.ITA-GRP',
    'Sub-Zero - Ita Chronicles 1080p BluRay x264-GRP',
  ];

  it.each(PENALIZED)('penalizes the foreign subtitles mark in %s', (title) => {
    expect(matchingFormats(plan.formats, { title })).toContain('Subtítulos ajenos');
  });

  it.each(CLEAN)('leaves %s without the foreign subtitles penalty', (title) => {
    expect(matchingFormats(plan.formats, { title })).not.toContain('Subtítulos ajenos');
  });

  it('detects Latino in anime names that reference the episode by absolute number', () => {
    expect(
      matchingFormats(plan.formats, { title: '[Grupo] Serie - 05 [1080p][LATINO]' }),
    ).toContain('Latino');
    expect(
      matchingFormats(plan.formats, {
        title: '[Grupo] Serie - 05 [BD][LATINO]',
        languages: ['Spanish (Latino)'],
      }),
    ).toContain('Latino');
  });

  it('does not mark JoJo releases as Latino and ignores hyphens without a number in the title', () => {
    for (const title of [
      'JoJos Bizarre Adventure 2012 S06E04 1080p NF WEB-DL AAC2 0 H 264 DUAL-BiOMA',
      'Latino - Into the Spider-Verse 2018 1080p BluRay x264-GRP',
    ]) {
      const names = matchingFormats(plan.formats, { title });
      expect(names, title).not.toContain('Latino');
    }
    expect(
      matchingFormats(plan.formats, { title: 'Latino - Into the Spider-Verse 2018 1080p BluRay' }),
    ).toContain('Original');
  });

  it('matches 1080p by resolution and not by the 720p or 2160p releases', () => {
    const matches = (title: string) => matchingFormats(plan.formats, { title }).includes('1080p');

    expect(matches('Serie.S01E01.1080p.WEB-DL.x264-GRP')).toBe(true);
    expect(matches('Serie.S01E01.720p.WEB-DL.x264-GRP')).toBe(false);
    expect(matches('Serie.S01E01.2160p.WEB-DL.x264-GRP')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { classifyReleases, namesOfSeries } from '../retry/retry.candidates';
import {
  AZUMANGA,
  DVD,
  episodeFile,
  planOf,
  RELEASE_DUAL,
  RELEASE_KAA,
  RELEASE_MAN,
  seasonOf,
} from '../retry/retry.testing';
import {
  describeCandidate,
  describeSeason,
  describeSeries,
  formatRetryCandidates,
  formatRetryPlan,
  formatRetryStep,
  formatRetrySummary,
  toRetryJson,
  toRetryNothingJson,
  toRetryRefusedJson,
} from './retry-output.utils';

const TARGET = {
  kind: 'series' as const,
  id: 9,
  title: 'Azumanga Daioh',
  year: 2002,
  tvdbId: 79040,
};
const { candidates } = classifyReleases(
  [RELEASE_KAA, RELEASE_MAN, RELEASE_DUAL],
  namesOfSeries(AZUMANGA),
);

describe('retry output', () => {
  it('names the series and the missing episodes of the season', () => {
    const season = seasonOf(26, [1]);

    expect(describeSeries(TARGET)).toBe('Azumanga Daioh (2002)');
    expect(describeSeason(TARGET, season)).toBe(
      'Azumanga Daioh (2002) — season 1, 25 of 26 episodes missing',
    );
  });

  it('prints the candidates as an aligned table', () => {
    const lines = formatRetryCandidates(candidates);

    expect(lines).toEqual([
      '   #  Release                                                  Quality       Score  Seeds  Parsed',
      '   1  Azumanga Daioh + Extras (Dual Audio) 1080p BD x265 Opus  Bluray-1080p   2400    221  no',
      '   2  [man] Azumanga Daioh [BD 1080p HEVC FLAC]                Bluray-1080p   2400    100  no',
      '   3  [KAA] Azumanga Daioh 01-26 DVD (Complete)                DVD            2000     67  yes',
    ]);
  });

  it('describes a candidate on one line for the selection', () => {
    expect(describeCandidate(candidates[2]!)).toBe(
      '3. [KAA] Azumanga Daioh 01-26 DVD (Complete) — DVD, score 2000, 67 seeds, parsed by Sonarr',
    );
  });

  it('truncates a very long release name in the table', () => {
    const long = { ...candidates[0]!, release: { ...RELEASE_DUAL, title: 'A'.repeat(90) } };

    expect(formatRetryCandidates([long])[1]).toContain(`${'A'.repeat(55)}…`);
  });

  describe('the plan', () => {
    it('states what is replaced and how long the recycle bin keeps it', () => {
      const season = seasonOf(3, [1, 2, 3]);
      const plan = planOf(season, RELEASE_MAN, [
        episodeFile(501, DVD),
        episodeFile(502, DVD),
        episodeFile(503, DVD),
      ]);

      expect(formatRetryPlan(plan)).toEqual([
        'Series: Azumanga Daioh (2002)',
        '  Release   1. [man] Azumanga Daioh [BD 1080p HEVC FLAC]',
        '  Assign    season 1, 3 episodes (0 new, 3 replaced, 0 kept)',
        '  Replace   3 episodes in DVD; the recycle bin keeps the old files 7 days',
        '  Verify    every file is read through the mount first; if one fails nothing is replaced',
      ]);
    });

    it('states the episodes that keep their file', () => {
      const plan = planOf(seasonOf(3, [1]), RELEASE_MAN, [episodeFile(501)]);

      expect(formatRetryPlan(plan)).toContain(
        '  Keep      1 episode already have a file of equal or better quality',
      );
    });
  });

  describe('steps', () => {
    it('marks each step and lists its details', () => {
      expect(
        formatRetryStep({
          id: 'decypharr',
          status: 'ok',
          message: 'release 2 delivered (29 files)',
        }),
      ).toEqual(['✔ Decypharr    release 2 delivered (29 files)']);
      expect(
        formatRetryStep({
          id: 'rollback',
          status: 'failed',
          message: 'The rollback is incomplete',
          details: ['torrent abc: boom'],
          hint: 'Run doctor --fix',
        }),
      ).toEqual([
        '✖ Rollback     The rollback is incomplete',
        '   ↳ torrent abc: boom',
        '   ↳ Run doctor --fix',
      ]);
    });

    it('summarizes each failed outcome and nothing for a success', () => {
      const plan = planOf(seasonOf(2));
      const result = (outcome: Parameters<typeof formatRetrySummary>[0]['outcome']) =>
        formatRetrySummary({
          plan,
          steps: [],
          outcome,
          imported: 0,
          success: outcome === 'imported',
        });

      expect(result('imported')).toEqual([]);
      expect(result('rejected')[0]).toContain('rejected');
      expect(result('unverified')[0]).toContain('library was not touched');
      expect(result('failed')[0]).toContain('Sonarr');
    });
  });

  describe('JSON', () => {
    it('reports candidates, plan and result', () => {
      const season = seasonOf(2);
      const plan = planOf(season, RELEASE_MAN);

      const report = toRetryJson({
        target: TARGET,
        season,
        candidates,
        excluded: 3,
        plan,
        result: {
          plan,
          steps: [{ id: 'sonarr', status: 'ok', message: '2 episodes imported' }],
          outcome: 'imported',
          imported: 2,
          success: true,
        },
      });

      expect(report).toMatchObject({
        success: true,
        executed: true,
        target: { id: 9, title: 'Azumanga Daioh', year: 2002, tvdbId: 79040 },
        season: { number: 1, episodes: 2, missing: 2 },
        excluded: 3,
        plan: { release: 1, fill: 2, replace: 0, keep: 0, recycleBinDays: 7 },
        result: { outcome: 'imported', imported: 2 },
      });
      expect((report.candidates as unknown[])[2]).toMatchObject({
        position: 3,
        quality: 'DVD',
        recognized: true,
        indexer: 'Nyaa',
      });
    });

    it('marks a plan that was not sent', () => {
      const season = seasonOf(2);

      expect(
        toRetryJson({ target: TARGET, season, candidates, excluded: 0, message: 'Pass --yes' }),
      ).toMatchObject({
        success: false,
        executed: false,
        error: 'Pass --yes',
        plan: null,
        result: null,
      });
    });

    it('describes nothing to retry and refusals', () => {
      expect(toRetryNothingJson(TARGET)).toMatchObject({ success: true, nothingToRetry: true });
      expect(toRetryRefusedJson('no', [1, 2])).toEqual({
        success: false,
        executed: false,
        error: 'no',
        seasons: [1, 2],
      });
    });
  });
});

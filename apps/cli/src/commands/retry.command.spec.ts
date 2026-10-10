import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AZUMANGA,
  createRetryDoubles,
  DVD,
  episode,
  episodeFile,
  PACK_EXTRA,
  packFile,
  RELEASE_DUAL,
  RELEASE_KAA,
  RELEASE_LOOSE,
  RELEASE_MAN,
  RELEASE_OTHER,
  type RetryDoublesOptions,
  seasonOf,
} from '../retry/retry.testing';
import { createRetryCommand, executeRetry, parsePositiveInteger } from './retry.command';

vi.mock('../utils/command.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/command.utils')>()),
  abortOnInterrupt: () => new AbortController(),
}));

const RELEASES = [RELEASE_KAA, RELEASE_MAN, RELEASE_DUAL, RELEASE_LOOSE, RELEASE_OTHER];

describe('retry command', () => {
  let output: string[];
  let errors: string[];

  beforeEach(() => {
    output = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      output.push(message);
    });
    vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  const doubles = (options: Partial<RetryDoublesOptions> = {}) =>
    createRetryDoubles({
      season: seasonOf(4, [1]),
      releases: RELEASES,
      files: [episodeFile(501)],
      packFiles: [1, 2, 3, 4].map(packFile).concat(PACK_EXTRA),
      ...options,
    });

  const settings = (
    fake: ReturnType<typeof doubles>,
    patch: Partial<Parameters<typeof executeRetry>[0]> = {},
  ): Parameters<typeof executeRetry>[0] => ({
    query: 'azumanga',
    yes: false,
    mode: 'json',
    version: '0.1.0',
    context: { clients: fake.clients, runtime: fake.runtime },
    ...patch,
  });

  const json = (): Record<string, any> => JSON.parse(output.join('\n'));

  it('declares the documented arguments and options', () => {
    const command = createRetryCommand('0.0.0');

    expect(command.registeredArguments.map((argument) => argument.name())).toEqual(['query']);
    expect(command.registeredArguments[0]?.required).toBe(false);
    expect(command.options.map((option) => option.long)).toEqual([
      '--series',
      '--season',
      '--pick',
      '--home',
    ]);
  });

  it.each(['1', '79040', ' 3 '])('accepts the number %j', (value) => {
    expect(parsePositiveInteger(value)).toBe(Number(value.trim()));
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('rejects the number %j', (value) => {
    expect(() => parsePositiveInteger(value)).toThrow(/positive whole number/);
  });

  describe('without --yes (the read-only check)', () => {
    it('lists the candidates and the plan as JSON, sends nothing and exits with 1', async () => {
      const fake = doubles();

      await executeRetry(settings(fake));

      expect(process.exitCode).toBe(1);
      expect(fake.calls).toEqual([]);
      const report = json();
      expect(report).toMatchObject({
        success: false,
        executed: false,
        error: 'Pass --pick <n> and --yes to send the release.',
        target: { title: 'Azumanga Daioh', tvdbId: 79040 },
        season: { number: 1, episodes: 4, missing: 3 },
        excluded: 2,
      });
      expect(report.candidates.map((candidate: { title: string }) => candidate.title)).toEqual([
        RELEASE_DUAL.title,
        RELEASE_MAN.title,
        RELEASE_KAA.title,
      ]);
      expect(report.plan).toMatchObject({ release: 1, fill: 3, replace: 0, keep: 1 });
    });

    it('prints the candidate table and the plan in headless mode and exits with 1', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { mode: 'headless' }));

      expect(process.exitCode).toBe(1);
      expect(fake.calls).toEqual([]);
      expect(output[0]).toBe('Moody Blues CLI v0.1.0 — Retry (Headless)');
      expect(output[1]).toMatch(/^Searching Sonarr for season 1\./);
      expect(output[2]).toBe('Series: Azumanga Daioh (2002) — season 1, 3 of 4 episodes missing');
      expect(output[3]).toMatch(/#\s+Release\s+Quality\s+Score\s+Seeds\s+Parsed/);
      expect(output.join('\n')).toContain(
        'Azumanga Daioh + Extras (Dual Audio) 1080p BD x265 Opus',
      );
      expect(output.join('\n')).toContain('3 new, 0 replaced, 1 kept');
      expect(errors).toEqual([
        '✖ Nothing was sent. Pass --pick <n> and --yes to send the release non-interactively.',
      ]);
    });

    it('uses the selected release in the plan', async () => {
      const fake = doubles({ files: [episodeFile(501, DVD)], season: seasonOf(4, [1]) });

      await executeRetry(settings(fake, { pick: 2 }));

      expect(json().plan).toMatchObject({
        release: 2,
        title: RELEASE_MAN.title,
        replace: 1,
        keep: 0,
      });
    });
  });

  describe('with --pick and --yes', () => {
    it('sends the release, imports the pack and exits with 0', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { pick: 2, yes: true }));

      expect(process.exitCode ?? 0).toBe(0);
      expect(fake.grabs).toHaveLength(1);
      expect(fake.grabs[0]?.guid).toBe(RELEASE_MAN.guid);
      expect(fake.imports[0]).toHaveLength(3);
      expect(json()).toMatchObject({
        success: true,
        executed: true,
        result: { outcome: 'imported', imported: 3 },
      });
    });

    it('prints the steps as they finish in headless mode', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { mode: 'headless', pick: 2, yes: true }));

      expect(output.filter((line) => /^[✔✖]/.test(line))).toEqual([
        '✔ Decypharr    release 2 delivered (5 files)',
        '✔ Verify       3 episodes readable through the mount, no re-insertions',
        '✔ Sonarr       3 episodes imported, 1 file skipped',
      ]);
      expect(process.exitCode ?? 0).toBe(0);
    });

    it('exits with 2 when Decypharr rejects the release', async () => {
      const fake = doubles({ refuse: true });

      await executeRetry(settings(fake, { mode: 'headless', pick: 1, yes: true }));

      expect(process.exitCode).toBe(2);
      expect(output.join('\n')).toContain('✖ Decypharr    release 1 rejected');
      expect(errors).toContain('✖ Decypharr rejected the release; the library was not touched.');
    });

    it('exits with 2 and reports the rollback when the verification fails', async () => {
      const fake = doubles({ unreadable: [packFile(3)] });

      await executeRetry(settings(fake, { pick: 2, yes: true }));

      expect(process.exitCode).toBe(2);
      expect(json()).toMatchObject({ success: false, result: { outcome: 'unverified' } });
      expect(fake.imports).toEqual([]);
    });

    it('refuses --yes without --pick instead of choosing for the administrator', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { yes: true }));

      expect(process.exitCode).toBe(1);
      expect(fake.calls).toEqual([]);
      expect(json().error).toBe('Pass --pick <n> to choose the release.');
    });

    it('refuses a --pick that is not in the list', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { pick: 9, yes: true }));

      expect(process.exitCode).toBe(1);
      expect(json().error).toBe('--pick 9 is not one of the releases (1, 2, 3).');
      expect(fake.calls).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('refuses a pack that cannot improve any episode', async () => {
      const fake = doubles({
        season: seasonOf(2, [1, 2]),
        files: [episodeFile(501), episodeFile(502)],
      });

      await executeRetry(settings(fake, { season: 1, pick: 3, yes: true }));

      expect(process.exitCode).toBe(1);
      expect(json().error).toContain('equal or better quality');
      expect(fake.calls).toEqual([]);
    });

    it('refuses to replace files when Sonarr has no recycle bin', async () => {
      const fake = doubles({
        season: seasonOf(2, [1]),
        files: [episodeFile(501, DVD)],
        recycleBin: '',
      });

      await executeRetry(settings(fake, { pick: 2, yes: true }));

      expect(process.exitCode).toBe(1);
      expect(json().error).toContain('no recycle bin');
      expect(fake.calls).toEqual([]);
    });

    it('still shows the plan, with the warning, when the read-only check finds no recycle bin', async () => {
      const fake = doubles({
        season: seasonOf(2, [1]),
        files: [episodeFile(501, DVD)],
        recycleBin: '',
      });

      await executeRetry(settings(fake));

      expect(process.exitCode).toBe(1);
      expect(json().plan).toMatchObject({ replace: 1 });
      expect(json().error).toBe(
        'Pass --pick <n> and --yes to send the release. Sonarr has no recycle bin, so replaced files would be deleted. Run "moody-blues setup" again to provision it.',
      );
    });

    it('fills the missing episodes without a recycle bin when nothing is replaced', async () => {
      const fake = doubles({ recycleBin: '' });

      await executeRetry(settings(fake, { pick: 2, yes: true }));

      expect(process.exitCode ?? 0).toBe(0);
    });

    it('exits with 1 when no release qualifies', async () => {
      const fake = doubles({ releases: [RELEASE_OTHER, RELEASE_LOOSE] });

      await executeRetry(settings(fake));

      expect(process.exitCode).toBe(1);
      expect(json().error).toBe('No usable release for season 1 (2 rejected by Sonarr).');
    });

    it('exits with 1 when no series matches', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { query: 'nothing' }));

      expect(process.exitCode).toBe(1);
      expect(json().error).toBe('No series in Sonarr matches "nothing".');
    });

    it('lists the matching series when the query is ambiguous', async () => {
      const fake = doubles({
        titles: [
          AZUMANGA,
          { ...AZUMANGA, id: 10, year: 2010, tvdbId: 5, title: 'Azumanga Reboot' },
        ],
      });

      await executeRetry(settings(fake, { mode: 'headless', query: 'azumanga' }));

      expect(process.exitCode).toBe(1);
      expect(errors[0]).toBe('✖ Several series match "azumanga".');
      expect(errors.join('\n')).toContain('--series 79040');
      expect(errors.join('\n')).toContain('--series 5');
    });

    it('selects a series by its TVDB id', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { query: undefined, series: 79040 }));

      expect(json().target.id).toBe(AZUMANGA.id);
    });

    it('requires exactly one selector', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { query: undefined }));
      expect(process.exitCode).toBe(1);
      expect(json().error).toBe('Provide exactly one of <query> or --series <tvdbId>.');

      output.length = 0;
      await executeRetry(settings(fake, { series: 79040 }));
      expect(json().error).toBe('Provide exactly one of <query> or --series <tvdbId>.');
    });

    it('refuses several incomplete seasons in non-interactive mode and names them', async () => {
      const fake = doubles({
        extraEpisodes: [episode(1, { id: 201, seasonNumber: 2 })],
      });

      await executeRetry(settings(fake, { mode: 'headless' }));

      expect(process.exitCode).toBe(1);
      expect(errors[0]).toBe(
        '✖ Several seasons are incomplete (1, 2); repeat the command with --season <n>.',
      );
    });

    it('works on the requested season only', async () => {
      const fake = doubles({
        extraEpisodes: [episode(1, { id: 201, seasonNumber: 2 })],
      });

      await executeRetry(settings(fake, { season: 1 }));

      expect(json().season.number).toBe(1);
    });

    it('exits with 1 for a season the series does not have', async () => {
      const fake = doubles();

      await executeRetry(settings(fake, { season: 7 }));

      expect(process.exitCode).toBe(1);
      expect(json().error).toContain('has no monitored season 7');
    });
  });

  describe('when there is nothing to retry', () => {
    it('exits with 0 as JSON', async () => {
      const fake = doubles({ season: seasonOf(2, [1, 2]) });

      await executeRetry(settings(fake));

      expect(process.exitCode ?? 0).toBe(0);
      expect(json()).toMatchObject({ success: true, nothingToRetry: true });
      expect(fake.calls).toEqual([]);
    });

    it('says so in headless mode', async () => {
      const fake = doubles({ season: seasonOf(2, [1, 2]) });

      await executeRetry(settings(fake, { mode: 'headless' }));

      expect(output).toEqual([
        'Nothing to retry: Azumanga Daioh has every aired, monitored episode.',
      ]);
    });
  });

  it('reports an unexpected failure as JSON with exit code 1', async () => {
    const fake = doubles();
    fake.clients.sonarr.listTitles = async () => {
      throw new Error('GET /api/v3/series responded 500');
    };

    await executeRetry(settings(fake));

    expect(process.exitCode).toBe(1);
    expect(json()).toMatchObject({ success: false, error: 'GET /api/v3/series responded 500' });
  });

  it('reports an unexpected failure as text in headless mode', async () => {
    const fake = doubles();
    fake.clients.sonarr.listTitles = async () => {
      throw new Error('boom');
    };

    await executeRetry(settings(fake, { mode: 'headless' }));

    expect(process.exitCode).toBe(1);
    expect(errors).toEqual(['✖ boom']);
  });
});

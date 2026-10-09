import { describe, expect, it } from 'vitest';

import { detectDockerCpus } from './docker-cpus.utils';

const answer =
  (stdout: string, exitCode = 0) =>
  async () => ({ stdout, stderr: '', exitCode });

describe('detectDockerCpus', () => {
  it('asks the Docker daemon for its core count', async () => {
    const calls: [string, string[]][] = [];

    const cpus = await detectDockerCpus(async (file, args) => {
      calls.push([file, args]);
      return { stdout: '8', stderr: '', exitCode: 0 };
    });

    expect(cpus).toBe(8);
    expect(calls).toEqual([['docker', ['info', '--format', '{{.NCPU}}']]]);
  });

  it.each([
    ['a failing command', answer('8', 1)],
    ['an empty answer', answer('')],
    ['a zero count', answer('0')],
    ['a non-numeric answer', answer('<no value>')],
    ['a fractional answer', answer('2.5')],
  ])('returns undefined for %s', async (_label, run) => {
    expect(await detectDockerCpus(run)).toBeUndefined();
  });
});

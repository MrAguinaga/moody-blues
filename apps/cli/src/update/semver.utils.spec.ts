import { describe, expect, it } from 'vitest';

import { compareSemver, normalizeVersion, parseSemver } from './semver.utils';

function compare(left: string, right: string): number {
  return compareSemver(parseSemver(left) as never, parseSemver(right) as never);
}

describe('semver utils', () => {
  it('parses plain, v-prefixed and prerelease versions', () => {
    expect(parseSemver('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] });
    expect(parseSemver('v1.20.3')).toEqual({ major: 1, minor: 20, patch: 3, prerelease: [] });
    expect(parseSemver('v2.0.0-rc.1+build.5')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: ['rc', '1'],
    });
  });

  it('rejects text that is not a version', () => {
    for (const text of ['', 'latest', '1.2', 'v1.2.x', '1.2.3.4', 'release-1.2.3']) {
      expect(parseSemver(text)).toBeUndefined();
    }
  });

  it('normalizes a tag into a version', () => {
    expect(normalizeVersion('v0.1.0')).toBe('0.1.0');
    expect(normalizeVersion('v1.0.0-beta.2')).toBe('1.0.0-beta.2');
    expect(normalizeVersion('nightly')).toBeUndefined();
  });

  it('orders versions numerically, not lexically', () => {
    expect(compare('0.10.0', '0.9.0')).toBe(1);
    expect(compare('1.0.0', '2.0.0')).toBe(-1);
    expect(compare('1.2.3', '1.2.4')).toBe(-1);
    expect(compare('v1.2.3', '1.2.3')).toBe(0);
  });

  it('orders prereleases below their release and among themselves', () => {
    expect(compare('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compare('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compare('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compare('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compare('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compare('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
  });
});

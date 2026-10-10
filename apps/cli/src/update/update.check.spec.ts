import { describe, expect, it, vi } from 'vitest';

import {
  cacheFromRelease,
  isCacheFresh,
  releaseFromCache,
  UPDATE_CACHE_TTL_MS,
} from './update.cache';
import { checkForUpdate, isNewer } from './update.check';
import type { ReleaseInfo } from './update.types';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const RELEASE: ReleaseInfo = {
  tag: 'v0.2.0',
  version: '0.2.0',
  url: 'https://example.test/v0.2.0',
  body: '- Notes',
};

describe('update cache', () => {
  it('is fresh for less than one hour', () => {
    const cache = cacheFromRelease(RELEASE, NOW);

    expect(isCacheFresh(cache, new Date(NOW.getTime() + UPDATE_CACHE_TTL_MS - 1))).toBe(true);
    expect(isCacheFresh(cache, new Date(NOW.getTime() + UPDATE_CACHE_TTL_MS))).toBe(false);
    expect(isCacheFresh(cache, new Date(NOW.getTime() - 1000))).toBe(false);
  });

  it('round-trips a release and drops a cached tag that is not a version', () => {
    expect(releaseFromCache(cacheFromRelease(RELEASE, NOW))).toEqual(RELEASE);
    expect(releaseFromCache({ ...cacheFromRelease(RELEASE, NOW), tag: 'nightly' })).toBeUndefined();
  });
});

describe('isNewer', () => {
  it('compares by version, not by text', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('queries GitHub and reports an available update', async () => {
    const fetchRelease = vi.fn(async () => RELEASE);

    const check = await checkForUpdate({
      currentVersion: '0.1.0',
      useCache: true,
      now: NOW,
      fetchRelease,
    });

    expect(check).toEqual({
      current: '0.1.0',
      latest: RELEASE,
      updateAvailable: true,
      source: 'github',
      checkedAt: NOW.toISOString(),
    });
  });

  it('reports up to date at the same version and when ahead of the release', async () => {
    const same = await checkForUpdate({
      currentVersion: '0.2.0',
      useCache: false,
      now: NOW,
      fetchRelease: async () => RELEASE,
    });
    const ahead = await checkForUpdate({
      currentVersion: '0.3.0-dev.1',
      useCache: false,
      now: NOW,
      fetchRelease: async () => RELEASE,
    });

    expect(same.updateAvailable).toBe(false);
    expect(ahead.updateAvailable).toBe(false);
  });

  it('reports up to date when there is no release', async () => {
    const check = await checkForUpdate({
      currentVersion: '0.1.0',
      useCache: true,
      now: NOW,
      fetchRelease: async () => undefined,
    });

    expect(check).toMatchObject({ updateAvailable: false, source: 'github' });
    expect(check.latest).toBeUndefined();
  });

  it('answers from a fresh cache without calling GitHub', async () => {
    const fetchRelease = vi.fn(async () => RELEASE);
    const cache = cacheFromRelease(RELEASE, new Date(NOW.getTime() - 10 * 60 * 1000));

    const check = await checkForUpdate({
      currentVersion: '0.1.0',
      cache,
      useCache: true,
      now: NOW,
      fetchRelease,
    });

    expect(fetchRelease).not.toHaveBeenCalled();
    expect(check).toMatchObject({
      source: 'cache',
      updateAvailable: true,
      checkedAt: cache.checkedAt,
    });
  });

  it('queries GitHub again when the cache is stale, unwanted or unusable', async () => {
    const fetchRelease = vi.fn(async () => RELEASE);
    const fresh = cacheFromRelease(RELEASE, NOW);
    const stale = cacheFromRelease(RELEASE, new Date(NOW.getTime() - 2 * UPDATE_CACHE_TTL_MS));

    await checkForUpdate({
      currentVersion: '0.1.0',
      cache: stale,
      useCache: true,
      now: NOW,
      fetchRelease,
    });
    await checkForUpdate({
      currentVersion: '0.1.0',
      cache: fresh,
      useCache: false,
      now: NOW,
      fetchRelease,
    });
    await checkForUpdate({
      currentVersion: '0.1.0',
      cache: { ...fresh, tag: 'nightly' },
      useCache: true,
      now: NOW,
      fetchRelease,
    });

    expect(fetchRelease).toHaveBeenCalledTimes(3);
  });

  it('propagates GitHub errors', async () => {
    await expect(
      checkForUpdate({
        currentVersion: '0.1.0',
        useCache: true,
        now: NOW,
        fetchRelease: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow('offline');
  });

  it('rejects a CLI version that is not valid', async () => {
    await expect(
      checkForUpdate({
        currentVersion: 'dev',
        useCache: true,
        now: NOW,
        fetchRelease: async () => RELEASE,
      }),
    ).rejects.toThrow('"dev" is not a valid version');
  });
});

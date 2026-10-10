import type { UpdateCheckCache } from '@moody-blues/provisioner';

import { compareSemver, normalizeVersion, parseSemver } from './semver.utils';
import { isCacheFresh, releaseFromCache } from './update.cache';
import type { ReleaseInfo, UpdateCheck } from './update.types';

export interface CheckForUpdateOptions {
  currentVersion: string;
  cache?: UpdateCheckCache;
  useCache: boolean;
  now: Date;
  fetchRelease: () => Promise<ReleaseInfo | undefined>;
}

export function isNewer(latestVersion: string, currentVersion: string): boolean {
  const latest = parseSemver(latestVersion);
  const current = parseSemver(currentVersion);
  if (!latest || !current) {
    throw new Error(`Cannot compare the versions "${latestVersion}" and "${currentVersion}".`);
  }
  return compareSemver(latest, current) > 0;
}

function describeCheck(
  currentVersion: string,
  latest: ReleaseInfo | undefined,
  source: UpdateCheck['source'],
  checkedAt: string,
): UpdateCheck {
  return {
    current: currentVersion,
    ...(latest ? { latest } : {}),
    updateAvailable: latest ? isNewer(latest.version, currentVersion) : false,
    source,
    checkedAt,
  };
}

export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheck> {
  const { cache, now } = options;
  const current = normalizeVersion(options.currentVersion);
  if (!current) {
    throw new Error(`The CLI version "${options.currentVersion}" is not a valid version.`);
  }

  if (options.useCache && cache && isCacheFresh(cache, now)) {
    const cached = releaseFromCache(cache);
    if (cached) {
      return describeCheck(current, cached, 'cache', cache.checkedAt);
    }
  }

  const latest = await options.fetchRelease();
  return describeCheck(current, latest, 'github', now.toISOString());
}

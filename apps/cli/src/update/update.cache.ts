import {
  type MbHomeLayout,
  type MoodyBluesConfig,
  readState,
  type UpdateCheckCache,
  writeState,
} from '@moody-blues/provisioner';

import { normalizeVersion } from './semver.utils';
import type { ReleaseInfo } from './update.types';

export const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;

export function isCacheFresh(cache: UpdateCheckCache, now: Date): boolean {
  const age = now.getTime() - Date.parse(cache.checkedAt);
  return age >= 0 && age < UPDATE_CACHE_TTL_MS;
}

export function releaseFromCache(cache: UpdateCheckCache): ReleaseInfo | undefined {
  const version = normalizeVersion(cache.tag);
  return version ? { tag: cache.tag, version, url: cache.url, body: cache.body } : undefined;
}

export function cacheFromRelease(release: ReleaseInfo, now: Date): UpdateCheckCache {
  return { checkedAt: now.toISOString(), tag: release.tag, url: release.url, body: release.body };
}

export function readInstalledState(layout: MbHomeLayout): MoodyBluesConfig | undefined {
  try {
    return readState(layout.stateFile);
  } catch {
    return undefined;
  }
}

export function storeUpdateCache(
  layout: MbHomeLayout,
  state: MoodyBluesConfig,
  cache: UpdateCheckCache,
): boolean {
  try {
    writeState(layout.stateFile, { ...state, updateCheck: cache }, { identity: state.host });
    return true;
  } catch {
    return false;
  }
}

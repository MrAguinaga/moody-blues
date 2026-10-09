import type { HostIdentity, MoodyBluesConfig } from '../config/config.types';
import type { MbHomeLayout } from '../home/home.paths';

const SAFE_CPU_LIMIT = '1';
const CPU_LIMIT_PATTERN = /^[1-9]\d*$/;

export function resolveJellyfinCpuLimit(
  dockerCpus: number | undefined,
  current: string | undefined,
): string {
  if (dockerCpus !== undefined && Number.isInteger(dockerCpus) && dockerCpus >= 1) {
    return String(Math.max(1, dockerCpus - 1));
  }
  return current !== undefined && CPU_LIMIT_PATTERN.test(current) ? current : SAFE_CPU_LIMIT;
}

export function buildHostEnv(
  config: MoodyBluesConfig,
  layout: MbHomeLayout,
  identity: HostIdentity = config.host,
  jellyfinCpuLimit: string = SAFE_CPU_LIMIT,
): Record<string, string> {
  return {
    MB_HOME: layout.root,
    MB_DOMAIN: config.domain,
    PUID: String(identity.puid),
    PGID: String(identity.pgid),
    TZ: config.timezone,
    COMPOSE_PROFILES: config.storage.enabled ? 'storage' : '',
    MNT_PROPAGATION: config.storage.enabled ? 'rslave' : 'rprivate',
    JELLYFIN_CPU_LIMIT: jellyfinCpuLimit,
  };
}

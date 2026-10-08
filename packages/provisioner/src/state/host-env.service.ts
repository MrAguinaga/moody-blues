import type { HostIdentity, MoodyBluesConfig } from '../config/config.types';
import type { MbHomeLayout } from '../home/home.paths';

export function buildHostEnv(
  config: MoodyBluesConfig,
  layout: MbHomeLayout,
  identity: HostIdentity = config.host,
): Record<string, string> {
  return {
    MB_HOME: layout.root,
    MB_DOMAIN: config.domain,
    PUID: String(identity.puid),
    PGID: String(identity.pgid),
    TZ: config.timezone,
    COMPOSE_PROFILES: config.storage.enabled ? 'storage' : '',
    MNT_PROPAGATION: config.storage.enabled ? 'rslave' : 'rprivate',
  };
}

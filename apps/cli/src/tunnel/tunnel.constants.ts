import { SERVICE_CATALOG, type ServiceId } from '@moody-blues/provisioner';

import type { TunnelService } from './tunnel.types';

const TUNNEL_SERVICE_IDS: readonly ServiceId[] = [
  'sonarr',
  'radarr',
  'prowlarr',
  'bazarr',
  'decypharr',
];

export const TUNNEL_SERVICES: readonly TunnelService[] = TUNNEL_SERVICE_IDS.map((id) => ({
  id,
  port: SERVICE_CATALOG[id].port,
}));

export const MB_SSH_TARGET_ENV = 'MB_SSH_TARGET';
export const LOOPBACK_HOST = '127.0.0.1';
export const SSH_TARGET_PATTERN = /^[A-Za-z0-9._@:%[\]-]+$/;

export const PROBE_INTERVAL_MS = 500;
export const PORT_CONNECT_TIMEOUT_MS = 1_000;
export const HTTP_PROBE_TIMEOUT_MS = 3_000;
export const SSH_EXIT_GRACE_MS = 100;

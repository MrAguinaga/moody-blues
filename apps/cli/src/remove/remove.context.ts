import {
  createArrClient,
  createDecypharrClient,
  createJellyfinClient,
  createSeerrClient,
  loadServiceKeys,
  SERVICE_CATALOG,
} from '@moody-blues/provisioner';

import { loadInstallation } from '../installation';
import type { RemoveClients } from './remove.types';

const REQUEST_TIMEOUT_MS = 30_000;
const MISSING_JELLYFIN_KEY =
  'JELLYFIN_API_KEY is missing from the Moody Blues .env; run "moody-blues setup" again to issue it';

export interface CreateRemoveClientsOptions {
  home?: string;
  signal: AbortSignal;
}

export function createRemoveClients({ home, signal }: CreateRemoveClientsOptions): RemoveClients {
  const { layout, env } = loadInstallation({ home });
  const keys = loadServiceKeys(layout);
  const transport = { timeoutMs: REQUEST_TIMEOUT_MS, retry: { attempts: 2 }, signal };

  const jellyfin = createJellyfinClient({
    baseUrl: SERVICE_CATALOG.jellyfin.hostUrl,
    ...transport,
  });
  const jellyfinKey = env.JELLYFIN_API_KEY;
  if (jellyfinKey) {
    jellyfin.useToken(jellyfinKey);
  }

  return {
    radarr: createArrClient({
      kind: 'radarr',
      baseUrl: SERVICE_CATALOG.radarr.hostUrl,
      apiKey: keys.radarrApiKey,
      ...transport,
    }),
    sonarr: createArrClient({
      kind: 'sonarr',
      baseUrl: SERVICE_CATALOG.sonarr.hostUrl,
      apiKey: keys.sonarrApiKey,
      ...transport,
    }),
    decypharr: createDecypharrClient({
      baseUrl: SERVICE_CATALOG.decypharr.hostUrl,
      apiToken: keys.decypharrApiToken,
      ...transport,
    }),
    seerr: createSeerrClient({
      baseUrl: SERVICE_CATALOG.seerr.hostUrl,
      apiKey: keys.seerrApiKey,
      ...transport,
    }),
    jellyfin: jellyfinKey
      ? jellyfin
      : { refreshLibrary: () => Promise.reject(new Error(MISSING_JELLYFIN_KEY)) },
  };
}

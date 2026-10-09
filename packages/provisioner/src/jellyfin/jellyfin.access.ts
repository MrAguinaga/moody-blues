import { HttpStatusError } from '../http/http.errors';
import type { ProvisionContext } from '../pipeline/pipeline.types';
import {
  type IssuedKeyEnvKey,
  persistIssuedKey,
  readIssuedKey,
} from '../state/issued-keys.service';
import type { JellyfinClient } from './jellyfin.client';
import { JELLYFIN_API_KEY_APP } from './jellyfin.constants';
import type { ApiKeyResource, JellyfinAccess } from './jellyfin.types';

const ISSUED_KEY_ENV: IssuedKeyEnvKey = 'JELLYFIN_API_KEY';
export const RESET_HINT =
  'If the Jellyfin data does not belong to this installation, run "moody-blues reset --fresh" to start over';

const REJECTED_CREDENTIAL_STATUSES: readonly number[] = [401, 403];

export function isRejectedCredential(error: unknown): boolean {
  return error instanceof HttpStatusError && REJECTED_CREDENTIAL_STATUSES.includes(error.status);
}

async function acceptsKey(client: JellyfinClient, key: string): Promise<boolean> {
  client.useToken(key);
  try {
    await client.listApiKeys();
    return true;
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 401) {
      return false;
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const activeKey = (keys: readonly ApiKeyResource[]): ApiKeyResource | undefined =>
  keys.find((key) => key.AppName === JELLYFIN_API_KEY_APP && !key.DateRevoked);

export async function ensureJellyfinAccess(
  ctx: ProvisionContext,
  client: JellyfinClient,
): Promise<JellyfinAccess> {
  const { envFile } = ctx.layout;
  const stored = readIssuedKey(envFile, ISSUED_KEY_ENV);
  if (stored && (await acceptsKey(client, stored))) {
    return { apiKey: stored, created: false, persisted: false, warnings: [] };
  }

  try {
    await client.authenticate({
      username: ctx.secrets.adminUsername,
      password: ctx.secrets.adminPassword,
    });
  } catch (error) {
    if (isRejectedCredential(error)) {
      throw new Error(`Jellyfin rejected the administrator credentials. ${RESET_HINT}`);
    }
    throw error;
  }

  let created = false;
  let key = activeKey(await client.listApiKeys());
  if (!key) {
    await client.createApiKey(JELLYFIN_API_KEY_APP);
    created = true;
    key = activeKey(await client.listApiKeys());
  }
  if (!key) {
    throw new Error(
      `Jellyfin did not list the "${JELLYFIN_API_KEY_APP}" API key after creating it`,
    );
  }

  const persisted = persistIssuedKey(envFile, ISSUED_KEY_ENV, key.AccessToken, {
    identity: ctx.identity,
  });
  const warnings: string[] = [];
  try {
    await client.logout();
  } catch (error) {
    warnings.push(`the provisioner session could not be closed: ${errorMessage(error)}`);
  }
  client.useToken(key.AccessToken);
  return { apiKey: key.AccessToken, created, persisted, warnings };
}

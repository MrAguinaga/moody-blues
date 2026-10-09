import type { HttpClient } from '../http/http.types';
import { valuesEqual } from '../http/provider-fields';

export type ServarrApiPrefix = '/api/v1' | '/api/v3';

export interface ServarrAdminCredentials {
  username: string;
  password: string;
  rotate: boolean;
}

export interface ServarrHostResource {
  id: number;
  authenticationMethod: string;
  authenticationRequired: string;
  analyticsEnabled: boolean;
  logLevel: string;
  username: string;
  password: string;
  passwordConfirmation: string;
  [key: string]: unknown;
}

export function buildHostSettings(): Record<string, unknown> {
  return {
    authenticationMethod: 'forms',
    authenticationRequired: 'enabled',
    analyticsEnabled: false,
    logLevel: 'info',
  };
}

export async function ensureServarrAdminUser(
  http: HttpClient,
  apiPrefix: ServarrApiPrefix,
  credentials: ServarrAdminCredentials,
): Promise<boolean> {
  const { username, password, rotate } = credentials;
  const host = await http.get<ServarrHostResource>(`${apiPrefix}/config/host`);
  const desired = buildHostSettings();

  const credentialsStale =
    rotate || host.authenticationMethod !== 'forms' || host.username !== username.toLowerCase();
  const settingsDrifted = Object.entries(desired).some(
    ([key, value]) => !valuesEqual(host[key], value),
  );
  if (!credentialsStale && !settingsDrifted) {
    return false;
  }

  await http.put(`${apiPrefix}/config/host/${host.id}`, {
    ...host,
    ...desired,
    ...(credentialsStale ? { username, password, passwordConfirmation: password } : {}),
  });
  return true;
}

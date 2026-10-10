import { randomBytes } from 'node:crypto';

import type { Result } from '../result.types';
import {
  type OptionalSecretEnvKey,
  SERVICE_KEY_ENV_KEYS,
  USER_SECRET_ENV_KEYS,
} from './env-keys.constants';

export interface UserSecrets {
  rdApiToken: string;
  adminUsername: string;
  adminPassword: string;
  opensubtitlesUsername?: string;
  opensubtitlesPassword?: string;
  clearedSecrets?: readonly OptionalSecretEnvKey[];
}

export interface ServiceKeys {
  sonarrApiKey: string;
  radarrApiKey: string;
  prowlarrApiKey: string;
  bazarrApiKey: string;
  decypharrApiToken: string;
  seerrApiKey: string;
}

export interface ParsedUserSecrets {
  secrets: UserSecrets;
  unknownKeys: string[];
}

const SERVICE_KEY_ENV_MAP: Record<keyof ServiceKeys, (typeof SERVICE_KEY_ENV_KEYS)[number]> = {
  sonarrApiKey: 'SONARR_API_KEY',
  radarrApiKey: 'RADARR_API_KEY',
  prowlarrApiKey: 'PROWLARR_API_KEY',
  bazarrApiKey: 'BAZARR_API_KEY',
  decypharrApiToken: 'DECYPHARR_API_TOKEN',
  seerrApiKey: 'SEERR_API_KEY',
};

const SERVICE_KEY_FIELDS = Object.keys(SERVICE_KEY_ENV_MAP) as (keyof ServiceKeys)[];

export function generateApiKey(): string {
  return randomBytes(16).toString('hex');
}

export function parseUserSecrets(record: Record<string, string>): Result<ParsedUserSecrets> {
  const errors: string[] = [];
  const required = (key: string): string => {
    const value = record[key]?.trim();
    if (!value) {
      errors.push(`${key} is required and must not be empty`);
      return '';
    }
    return value;
  };
  const optional = (key: string): string | undefined => record[key]?.trim() || undefined;

  const secrets: UserSecrets = {
    rdApiToken: required('RD_API_TOKEN'),
    adminUsername: required('ADMIN_USERNAME'),
    adminPassword: required('ADMIN_PASSWORD'),
  };
  const opensubtitlesUsername = optional('OPENSUBTITLES_USERNAME');
  const opensubtitlesPassword = optional('OPENSUBTITLES_PASSWORD');
  if (opensubtitlesUsername) secrets.opensubtitlesUsername = opensubtitlesUsername;
  if (opensubtitlesPassword) secrets.opensubtitlesPassword = opensubtitlesPassword;

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }

  const known: readonly string[] = USER_SECRET_ENV_KEYS;
  const unknownKeys = Object.keys(record).filter((key) => !known.includes(key));
  return { ok: true, value: { secrets, unknownKeys } };
}

export function ensureServiceKeys(
  existing: Partial<ServiceKeys>,
  generate: () => string = generateApiKey,
): ServiceKeys {
  const keys = {} as ServiceKeys;
  for (const field of SERVICE_KEY_FIELDS) {
    keys[field] = existing[field] || generate();
  }
  return keys;
}

export function userSecretsToEnv(secrets: UserSecrets): Record<string, string> {
  const env: Record<string, string> = {
    RD_API_TOKEN: secrets.rdApiToken,
    ADMIN_USERNAME: secrets.adminUsername,
    ADMIN_PASSWORD: secrets.adminPassword,
  };
  if (secrets.opensubtitlesUsername) env.OPENSUBTITLES_USERNAME = secrets.opensubtitlesUsername;
  if (secrets.opensubtitlesPassword) env.OPENSUBTITLES_PASSWORD = secrets.opensubtitlesPassword;
  return env;
}

export function serviceKeysToEnv(keys: ServiceKeys): Record<string, string> {
  const env: Record<string, string> = {};
  for (const field of SERVICE_KEY_FIELDS) {
    env[SERVICE_KEY_ENV_MAP[field]] = keys[field];
  }
  return env;
}

export function serviceKeysFromEnv(record: Record<string, string>): Partial<ServiceKeys> {
  const keys: Partial<ServiceKeys> = {};
  for (const field of SERVICE_KEY_FIELDS) {
    const value = record[SERVICE_KEY_ENV_MAP[field]];
    if (value) keys[field] = value;
  }
  return keys;
}

import {
  ISSUED_KEY_ENV_KEYS,
  SERVICE_KEY_ENV_KEYS,
  USER_SECRET_ENV_KEYS,
} from '@moody-blues/provisioner';

export const MIN_SECRET_LENGTH = 4;
export const REDACTED = '***';

export function normalizeSecrets(values: readonly (string | undefined)[]): string[] {
  const unique = new Set(
    values.filter(
      (value): value is string => value !== undefined && value.length >= MIN_SECRET_LENGTH,
    ),
  );
  return [...unique].sort((a, b) => b.length - a.length);
}

export function collectSecretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  return normalizeSecrets(
    [...USER_SECRET_ENV_KEYS, ...SERVICE_KEY_ENV_KEYS, ...ISSUED_KEY_ENV_KEYS].map(
      (key) => env[key],
    ),
  );
}

export function maskSecrets(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH)
    .reduce((current, secret) => current.split(secret).join(REDACTED), text);
}

import type { OwnershipOptions } from '../home/host-identity.utils';
import type { ISSUED_KEY_ENV_KEYS } from './env-keys.constants';
import { readEnv, writeEnv } from './env-store.service';

export type IssuedKeyEnvKey = (typeof ISSUED_KEY_ENV_KEYS)[number];

export function readIssuedKey(envFile: string, key: IssuedKeyEnvKey): string | undefined {
  return readEnv(envFile)[key] || undefined;
}

export function persistIssuedKey(
  envFile: string,
  key: IssuedKeyEnvKey,
  value: string,
  ownership: OwnershipOptions = {},
): boolean {
  const current = readEnv(envFile);
  if (current[key] === value) {
    return false;
  }
  writeEnv(envFile, { ...current, [key]: value }, ownership);
  return true;
}

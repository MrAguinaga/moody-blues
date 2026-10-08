import { USER_SECRET_ENV_KEYS } from '@moody-blues/provisioner';

import type { SetupValues } from './setup.types';

export const SETUP_VALUE_ENV_KEYS = {
  mode: 'MB_MODE',
  domain: 'MB_DOMAIN',
  acmeEmail: 'MB_ACME_EMAIL',
  transcoding: 'MB_TRANSCODING',
  rdApiToken: 'RD_API_TOKEN',
  adminUsername: 'ADMIN_USERNAME',
  adminPassword: 'ADMIN_PASSWORD',
  opensubtitlesUsername: 'OPENSUBTITLES_USERNAME',
  opensubtitlesPassword: 'OPENSUBTITLES_PASSWORD',
} as const satisfies Partial<Record<keyof SetupValues, string>>;

export type EnvBackedSetupKey = keyof typeof SETUP_VALUE_ENV_KEYS;

export const ENV_FILE_CONFIG_KEYS = ['MB_MODE', 'MB_DOMAIN', 'MB_ACME_EMAIL', 'MB_TRANSCODING'];

export const ENV_FILE_ACCEPTED_KEYS: readonly string[] = [
  ...ENV_FILE_CONFIG_KEYS,
  ...USER_SECRET_ENV_KEYS,
];

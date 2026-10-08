import type { MbHomeLayout } from '../home';
import { readEnv, SERVICE_KEY_ENV_KEYS, type ServiceKeys, serviceKeysFromEnv } from '../state';

export function loadServiceKeys(layout: MbHomeLayout): ServiceKeys {
  const env = readEnv(layout.envFile);
  const missing = SERVICE_KEY_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing service keys in ${layout.envFile}: ${missing.join(', ')}. ` +
        'The environment file must be written before the configuration is seeded.',
    );
  }
  return serviceKeysFromEnv(env) as ServiceKeys;
}

import {
  buildHostEnv,
  ensureServiceKeys,
  readEnv,
  resolveJellyfinCpuLimit,
  serializeEnvFile,
  serviceKeysFromEnv,
  serviceKeysToEnv,
  userSecretsToEnv,
  writeEnv,
} from '../../state';
import type { ProvisionStep } from '../pipeline.types';

const MAX_LISTED_KEYS = 5;

export const ensureEnvStep: ProvisionStep = {
  id: 'ensure-env',
  title: 'Write environment file',
  scopes: ['setup', 'reset', 'config'],
  run: async ({ config, secrets, layout, identity, dockerCpus }) => {
    const current = readEnv(layout.envFile);
    const next: Record<string, string> = {
      ...current,
      ...userSecretsToEnv(secrets),
      ...buildHostEnv(
        config,
        layout,
        identity,
        resolveJellyfinCpuLimit(dockerCpus, current.JELLYFIN_CPU_LIMIT),
      ),
      ...serviceKeysToEnv(ensureServiceKeys(serviceKeysFromEnv(current))),
    };
    const removed = (secrets.clearedSecrets ?? []).filter((key) => key in next);
    for (const key of removed) {
      delete next[key];
    }

    if (serializeEnvFile(current) === serializeEnvFile(next)) {
      return { status: 'unchanged' };
    }

    const touched = Object.keys(next).filter((key) => current[key] !== next[key]);
    writeEnv(layout.envFile, next, { identity });
    const parts = [
      touched.length > MAX_LISTED_KEYS
        ? `${touched.length} keys written`
        : touched.length > 0
          ? `updated ${touched.sort().join(', ')}`
          : '',
      removed.length > 0 ? `removed ${[...removed].sort().join(', ')}` : '',
    ];
    const detail = parts.filter(Boolean).join('; ');
    return { status: 'changed', detail };
  },
};

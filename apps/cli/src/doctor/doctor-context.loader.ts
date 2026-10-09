import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createArrClient,
  createBazarrClient,
  createDecypharrClient,
  createJellyfinClient,
  createProwlarrClient,
  createSeerrClient,
  loadServiceKeys,
  parseUserSecrets,
  type ProvisionContext,
  SERVICE_CATALOG,
} from '@moody-blues/provisioner';

import { loadCheckContext } from '../checks';
import { createComposeRunner } from '../docker';
import { loadInstallation } from '../installation';
import { collectSecretValues } from '../utils/redact.utils';
import { REQUEST_TIMEOUT_MS, STACK_QUERY_TIMEOUT_MS } from './doctor.constants';
import type { DoctorClients, DoctorContext } from './doctor.types';
import { readLogTail } from './doctor-log.utils';
import { redactSecrets } from './doctor-redact.utils';

export interface CreateDoctorContextOptions {
  home?: string;
  version: string;
  stuckAfterMs: number;
  signal: AbortSignal;
}

const READ_ONLY_RUNTIME: ProvisionContext['runtime'] = {
  up: () => Promise.reject(new Error('doctor does not manage containers')),
  waitHealthy: () => Promise.reject(new Error('doctor does not manage containers')),
  reloadGateway: () => Promise.reject(new Error('doctor does not manage containers')),
};

function readDirectoryWithin(path: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`no answer within ${timeoutMs / 1000} s`), { code: 'ETIMEDOUT' }),
      );
    }, timeoutMs);
    readdir(path).then(
      (entries) => {
        clearTimeout(timer);
        resolve(entries);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createClients(
  keys: ReturnType<typeof loadServiceKeys>,
  signal: AbortSignal,
): DoctorClients {
  const transport = { timeoutMs: REQUEST_TIMEOUT_MS, retry: { attempts: 1 }, signal };
  return {
    sonarr: createArrClient({
      kind: 'sonarr',
      baseUrl: SERVICE_CATALOG.sonarr.hostUrl,
      apiKey: keys.sonarrApiKey,
      ...transport,
    }),
    radarr: createArrClient({
      kind: 'radarr',
      baseUrl: SERVICE_CATALOG.radarr.hostUrl,
      apiKey: keys.radarrApiKey,
      ...transport,
    }),
    prowlarr: createProwlarrClient({
      baseUrl: SERVICE_CATALOG.prowlarr.hostUrl,
      apiKey: keys.prowlarrApiKey,
      ...transport,
    }),
    bazarr: createBazarrClient({
      baseUrl: SERVICE_CATALOG.bazarr.hostUrl,
      apiKey: keys.bazarrApiKey,
      ...transport,
    }),
    jellyfin: createJellyfinClient({ baseUrl: SERVICE_CATALOG.jellyfin.hostUrl, ...transport }),
    seerr: createSeerrClient({
      baseUrl: SERVICE_CATALOG.seerr.hostUrl,
      apiKey: keys.seerrApiKey,
      ...transport,
    }),
    decypharr: createDecypharrClient({
      baseUrl: SERVICE_CATALOG.decypharr.hostUrl,
      apiToken: keys.decypharrApiToken,
      ...transport,
    }),
  };
}

export function createDoctorContext(options: CreateDoctorContextOptions): DoctorContext {
  const { signal } = options;
  const installation = loadInstallation({ home: options.home });
  const { layout, config, env } = installation;

  const secrets = parseUserSecrets(env);
  if (!secrets.ok) {
    throw new Error(
      `The saved secrets in ${layout.envFile} are incomplete:\n- ${secrets.error.join('\n- ')}\n` +
        'Run "moody-blues setup" to provide them again.',
    );
  }
  const keys = loadServiceKeys(layout);
  const knownSecrets = collectSecretValues(env);

  const runner = createComposeRunner(installation, { requireHardware: false });
  const memos = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, factory: () => Promise<T>): Promise<T> => {
    if (!memos.has(key)) {
      memos.set(key, factory());
    }
    return memos.get(key) as Promise<T>;
  };

  return {
    installation,
    provision: {
      config,
      secrets: secrets.value.secrets,
      layout,
      identity: config.host,
      runtime: READ_ONLY_RUNTIME,
      flags: new Map(),
      cliVersion: options.version,
    },
    checkContext: loadCheckContext(layout.root),
    clients: createClients(keys, signal),
    signal,
    stuckAfterMs: options.stuckAfterMs,
    decypharrLogPath: join(layout.configFor('decypharr'), 'logs', 'decypharr.log'),
    timeZone: env.TZ,
    stack: () =>
      memo('stack', () =>
        runner.ps({
          signal: AbortSignal.any([signal, AbortSignal.timeout(STACK_QUERY_TIMEOUT_MS)]),
        }),
      ),
    memo,
    forget: (key) => {
      memos.delete(key);
    },
    now: () => Date.now(),
    readLogTail,
    readDirectory: readDirectoryWithin,
    redact: (text) => redactSecrets(text, knownSecrets),
  };
}

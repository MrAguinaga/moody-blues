import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  abortableSleep,
  createArrClient,
  createDecypharrClient,
  loadServiceKeys,
  SERVICE_CATALOG,
} from '@moody-blues/provisioner';

import { ComposeCommandError, createComposeRunner } from '../docker';
import { LOG_TAIL_BYTES } from '../doctor/doctor.constants';
import { readLogTail } from '../doctor/doctor-log.utils';
import { loadInstallation } from '../installation';
import { isVideoFile } from './retry.plan';
import type { RetryClients, RetryRuntime } from './retry.types';

const REQUEST_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 30_000;
const CONTAINER_DATA_ROOT = '/data';
const MAX_DEPTH = 3;
const PROBE_SERVICE = 'jellyfin';
const FFPROBE = '/usr/lib/jellyfin-ffmpeg/ffprobe';

export interface CreateRetryContextOptions {
  home?: string;
  signal: AbortSignal;
}

export interface RetryContext {
  clients: RetryClients;
  runtime: RetryRuntime;
}

export function toHostPath(dataDir: string, containerPath: string): string {
  if (
    containerPath !== CONTAINER_DATA_ROOT &&
    !containerPath.startsWith(`${CONTAINER_DATA_ROOT}/`)
  ) {
    throw new Error(
      `${containerPath} is outside ${CONTAINER_DATA_ROOT}, so it cannot be read from the host`,
    );
  }
  return join(dataDir, containerPath.slice(CONTAINER_DATA_ROOT.length));
}

export async function listPackFiles(
  hostDirectory: string,
  containerDirectory: string,
  depth = 0,
): Promise<string[]> {
  const entries = await readdir(hostDirectory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const hostPath = join(hostDirectory, entry.name);
    const containerPath = `${containerDirectory}/${entry.name}`;
    if (entry.isDirectory() && depth < MAX_DEPTH) {
      found.push(...(await listPackFiles(hostPath, containerPath, depth + 1)));
    } else if (!entry.isDirectory()) {
      found.push(containerPath);
    }
  }
  return found;
}

export function createRetryContext({ home, signal }: CreateRetryContextOptions): RetryContext {
  const installation = loadInstallation({ home });
  const { layout, env } = installation;
  const keys = loadServiceKeys(layout);
  const transport = { timeoutMs: REQUEST_TIMEOUT_MS, retry: { attempts: 2 }, signal };
  const runner = createComposeRunner(installation, { requireHardware: false });
  const decypharrLog = join(layout.configFor('decypharr'), 'logs', 'decypharr.log');

  return {
    clients: {
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
    },
    runtime: {
      now: () => Date.now(),
      sleep: (ms) => abortableSleep(ms, signal),
      listVideoFiles: async (directory) =>
        (await listPackFiles(toHostPath(layout.dataDir, directory), directory))
          .filter(isVideoFile)
          .sort(),
      probe: async (path) => {
        try {
          const { stdout } = await runner.exec(
            PROBE_SERVICE,
            [FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
            { signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]) },
          );
          if (!(Number.parseFloat(stdout) > 0)) {
            throw new Error('ffprobe reported no duration');
          }
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          if (error instanceof ComposeCommandError) {
            throw new Error(error.stderr || `ffprobe exited with code ${error.exitCode}`);
          }
          throw error instanceof Error && error.name === 'TimeoutError'
            ? new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000} s`)
            : error;
        }
      },
      readDecypharrLog: () => readLogTail(decypharrLog, LOG_TAIL_BYTES),
      timeZone: env.TZ,
    },
  };
}

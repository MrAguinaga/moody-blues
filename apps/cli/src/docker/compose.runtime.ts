import type { ContainerRuntime } from '@moody-blues/provisioner';

import { loadInstallation } from '../installation';
import { createComposeRunner } from './compose.runner';
import type { ComposeRunner, StackStatus } from './compose.types';
import { isServiceHealthy } from './compose-ps.parser';
import { waitForHealthy } from './health.waiter';

const MINUTE_MS = 60_000;
export const DEFAULT_UP_TIMEOUT_MS = 30 * MINUTE_MS;
export const DEFAULT_HEALTH_TIMEOUT_MS = 10 * MINUTE_MS;
export const DEFAULT_HEALTH_POLL_INTERVAL_MS = 3000;

export interface ComposeRuntimeOptions {
  home: string;
  upTimeoutMs?: number;
  healthTimeoutMs?: number;
  pollIntervalMs?: number;
  createRunner?: (home: string) => ComposeRunner;
}

function formatDuration(ms: number): string {
  return ms >= MINUTE_MS
    ? `${Math.round(ms / MINUTE_MS)} minutes`
    : `${Math.round(ms / 1000)} seconds`;
}

function describeProgress(status: StackStatus): string {
  const pending = status.services.filter((service) => !isServiceHealthy(service));
  const healthy = status.services.length - pending.length;
  const suffix =
    pending.length > 0 ? `, waiting for ${pending.map((s) => s.service).join(', ')}` : '';
  return `${healthy} of ${status.services.length} services healthy${suffix}`;
}

export function createComposeRuntime(options: ComposeRuntimeOptions): ContainerRuntime {
  const {
    home,
    upTimeoutMs = DEFAULT_UP_TIMEOUT_MS,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_HEALTH_POLL_INTERVAL_MS,
    createRunner = (root) => createComposeRunner(loadInstallation({ home: root })),
  } = options;

  let runner: ComposeRunner | undefined;
  const getRunner = (): ComposeRunner => (runner ??= createRunner(home));

  return {
    up: async ({ signal }) => {
      const timeout = AbortSignal.timeout(upTimeoutMs);
      try {
        await getRunner().up({ signal: AbortSignal.any([signal, timeout]) });
      } catch (error) {
        if (timeout.aborted && !signal.aborted) {
          throw new Error(`docker compose up did not finish within ${formatDuration(upTimeoutMs)}`);
        }
        throw error;
      }
    },
    waitHealthy: async ({ signal, onProgress }) => {
      let lastMessage: string | undefined;
      const notes: string[] = [];
      await waitForHealthy(getRunner(), {
        timeoutMs: healthTimeoutMs,
        intervalMs: pollIntervalMs,
        signal,
        onNotice: (message) => {
          notes.push(message);
          onProgress?.(message);
        },
        onUpdate: (status) => {
          const message = describeProgress(status);
          if (message !== lastMessage) {
            lastMessage = message;
            onProgress?.(message);
          }
        },
      });
      return { notes };
    },
    reloadGateway: ({ signal }) => getRunner().reloadGateway({ signal }),
  };
}

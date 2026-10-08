import { delay } from '../utils/async.utils';
import type { ComposeRunner, ServiceStatus, StackStatus } from './compose.types';
import { isServiceHealthy } from './compose-ps.parser';

export type HealthWaitFailure = 'timeout' | 'unhealthy' | 'exited' | 'aborted';

export class HealthWaitError extends Error {
  constructor(
    readonly reason: HealthWaitFailure,
    message: string,
    readonly status?: StackStatus,
    readonly failedServices: string[] = [],
  ) {
    super(message);
    this.name = 'HealthWaitError';
  }
}

export interface WaitForHealthyOptions {
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
  onUpdate?: (status: StackStatus) => void;
}

const UNHEALTHY_CONFIRMATION_POLLS = 2;

function names(services: ServiceStatus[]): string[] {
  return services.map((service) => service.service);
}

export async function waitForHealthy(
  runner: Pick<ComposeRunner, 'ps'>,
  options: WaitForHealthyOptions,
): Promise<StackStatus> {
  const { timeoutMs, intervalMs, signal, onUpdate } = options;
  const startedAt = Date.now();
  const unhealthyStreaks = new Map<string, number>();
  let lastStatus: StackStatus | undefined;

  const aborted = () => new HealthWaitError('aborted', 'Wait interrupted', lastStatus);

  for (;;) {
    if (signal?.aborted) {
      throw aborted();
    }

    try {
      lastStatus = await runner.ps({ signal });
    } catch (error) {
      if (signal?.aborted) {
        throw aborted();
      }
      throw error;
    }
    const status = lastStatus;
    onUpdate?.(status);

    if (status.allHealthy) {
      return status;
    }

    const exited = status.services.filter((service) => service.state === 'exited');
    if (exited.length > 0) {
      throw new HealthWaitError(
        'exited',
        `Services exited unexpectedly: ${exited
          .map((service) => `${service.service} (exit code ${service.exitCode})`)
          .join(', ')}`,
        status,
        names(exited),
      );
    }

    const unhealthy = status.services.filter((service) => service.health === 'unhealthy');
    const current = new Set(names(unhealthy));
    for (const service of unhealthyStreaks.keys()) {
      if (!current.has(service)) {
        unhealthyStreaks.delete(service);
      }
    }
    for (const service of current) {
      unhealthyStreaks.set(service, (unhealthyStreaks.get(service) ?? 0) + 1);
    }
    const confirmed = names(unhealthy).filter(
      (service) => (unhealthyStreaks.get(service) ?? 0) >= UNHEALTHY_CONFIRMATION_POLLS,
    );
    if (confirmed.length > 0) {
      throw new HealthWaitError(
        'unhealthy',
        `Services reported unhealthy: ${confirmed.join(', ')}`,
        status,
        confirmed,
      );
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      const pending = names(status.services.filter((service) => !isServiceHealthy(service)));
      throw new HealthWaitError(
        'timeout',
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${pending.join(', ')}`,
        status,
        pending,
      );
    }

    await delay(Math.min(intervalMs, remainingMs), signal);
  }
}

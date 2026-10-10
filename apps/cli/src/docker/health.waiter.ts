import { delay } from '../utils/async.utils';
import {
  type ComposeRunner,
  OPTIONAL_SERVICES,
  type ServiceStatus,
  type StackStatus,
} from './compose.types';
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
  optionalServices?: readonly string[];
  optionalGraceMs?: number;
  onNotice?: (message: string) => void;
}

export const DEFAULT_OPTIONAL_GRACE_MS = 90_000;

const UNHEALTHY_CONFIRMATION_POLLS = 2;

function names(services: ServiceStatus[]): string[] {
  return services.map((service) => service.service);
}

function isBroken(service: ServiceStatus): boolean {
  return service.state === 'exited' || service.health === 'unhealthy';
}

export async function waitForHealthy(
  runner: Pick<ComposeRunner, 'ps'> & Partial<Pick<ComposeRunner, 'restart'>>,
  options: WaitForHealthyOptions,
): Promise<StackStatus> {
  const {
    timeoutMs,
    intervalMs,
    signal,
    onUpdate,
    onNotice,
    optionalServices = OPTIONAL_SERVICES,
    optionalGraceMs = DEFAULT_OPTIONAL_GRACE_MS,
  } = options;
  const startedAt = Date.now();
  const unhealthyStreaks = new Map<string, number>();
  const brokenStreaks = new Map<string, number>();
  const restarted = new Set<string>();
  const abandoned = new Set<string>();
  let lastStatus: StackStatus | undefined;
  let lastRestartAt = 0;
  let requiredHealthyAt: number | undefined;

  const aborted = () => new HealthWaitError('aborted', 'Wait interrupted', lastStatus);

  async function healOptional(service: ServiceStatus): Promise<void> {
    const name = service.service;
    if (abandoned.has(name)) {
      return;
    }
    const streak = isBroken(service) ? (brokenStreaks.get(name) ?? 0) + 1 : 0;
    brokenStreaks.set(name, streak);
    if (streak < UNHEALTHY_CONFIRMATION_POLLS) {
      return;
    }
    const condition = service.state === 'exited' ? 'stopped' : 'unhealthy';
    if (restarted.has(name) || !runner.restart) {
      abandoned.add(name);
      onNotice?.(`${name} is still ${condition}; continuing without it`);
      return;
    }
    await runner.restart([name], { signal });
    restarted.add(name);
    brokenStreaks.set(name, 0);
    lastRestartAt = Date.now();
    onNotice?.(`Restarted ${name} because it was ${condition}`);
  }

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

    const optional = new Set(optionalServices);
    const required = status.services.filter((service) => !optional.has(service.service));
    const optionalStatuses = status.services.filter((service) => optional.has(service.service));

    for (const service of optionalStatuses) {
      try {
        await healOptional(service);
      } catch (error) {
        if (signal?.aborted) {
          throw aborted();
        }
        abandoned.add(service.service);
        onNotice?.(
          `Could not restart ${service.service}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const requiredHealthy = status.services.length > 0 && required.every(isServiceHealthy);
    if (requiredHealthy) {
      const waitingFor = optionalStatuses.filter(
        (service) => !isServiceHealthy(service) && !abandoned.has(service.service),
      );
      if (waitingFor.length === 0) {
        return status;
      }
      requiredHealthyAt ??= Date.now();
      const optionalElapsed = Date.now() - Math.max(requiredHealthyAt, lastRestartAt);
      if (optionalElapsed >= optionalGraceMs || Date.now() - startedAt >= timeoutMs) {
        onNotice?.(`${names(waitingFor).join(', ')} not healthy yet; continuing without it`);
        return status;
      }
      await delay(Math.min(intervalMs, optionalGraceMs - optionalElapsed), signal);
      continue;
    }

    const exited = required.filter((service) => service.state === 'exited');
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

    const unhealthy = required.filter((service) => service.health === 'unhealthy');
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
      const pending = names(required.filter((service) => !isServiceHealthy(service)));
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

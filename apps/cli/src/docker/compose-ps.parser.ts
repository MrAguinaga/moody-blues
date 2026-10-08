import type { ServiceHealth, ServiceState, ServiceStatus, StackStatus } from './compose.types';

type JsonRecord = Record<string, unknown>;

const STATE_BY_COMPOSE_STATE: Record<string, ServiceState> = {
  running: 'running',
  restarting: 'restarting',
  exited: 'exited',
  dead: 'exited',
  removing: 'exited',
  created: 'created',
  paused: 'paused',
};

const HEALTH_BY_COMPOSE_HEALTH: Record<string, ServiceHealth> = {
  healthy: 'healthy',
  unhealthy: 'unhealthy',
  starting: 'starting',
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseContainers(stdout: string): JsonRecord[] {
  const text = stdout.trim();
  if (text === '') {
    return [];
  }

  try {
    const parsed: unknown = text.startsWith('[')
      ? JSON.parse(text)
      : text
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line): unknown => JSON.parse(line));
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord);
  } catch {
    throw new Error('Unexpected output from "docker compose ps": it is neither JSON nor NDJSON');
  }
}

function parsePublishedPorts(publishers: unknown): string[] {
  if (!Array.isArray(publishers)) {
    return [];
  }

  const ports = new Map<string, number>();
  for (const publisher of publishers.filter(isRecord)) {
    const published = publisher.PublishedPort;
    if (typeof published !== 'number' || published <= 0) {
      continue;
    }
    const protocol = typeof publisher.Protocol === 'string' ? publisher.Protocol : 'tcp';
    ports.set(`${published}/${protocol}`, published);
  }

  return [...ports.entries()]
    .sort(([keyA, a], [keyB, b]) => a - b || keyA.localeCompare(keyB))
    .map(([port]) => port);
}

function toServiceStatus(service: string, container: JsonRecord | undefined): ServiceStatus {
  if (!container) {
    return { service, state: 'missing', health: 'none', exitCode: 0, publishedPorts: [] };
  }

  const state = typeof container.State === 'string' ? container.State.toLowerCase() : '';
  const health = typeof container.Health === 'string' ? container.Health.toLowerCase() : '';

  return {
    service,
    state: STATE_BY_COMPOSE_STATE[state] ?? 'created',
    health: HEALTH_BY_COMPOSE_HEALTH[health] ?? 'none',
    exitCode: typeof container.ExitCode === 'number' ? container.ExitCode : 0,
    publishedPorts: parsePublishedPorts(container.Publishers),
  };
}

export function parseComposePs(stdout: string, expected: readonly string[]): ServiceStatus[] {
  const containers = new Map<string, JsonRecord>();
  for (const container of parseContainers(stdout)) {
    const service = container.Service;
    if (typeof service === 'string' && !containers.has(service)) {
      containers.set(service, container);
    }
  }

  return expected.map((service) => toServiceStatus(service, containers.get(service)));
}

export function isServiceHealthy(service: ServiceStatus): boolean {
  return service.state === 'running' && (service.health === 'healthy' || service.health === 'none');
}

export function buildStackStatus(
  project: string,
  services: ServiceStatus[],
  timestamp: string = new Date().toISOString(),
): StackStatus {
  return {
    project,
    timestamp,
    allHealthy: services.length > 0 && services.every(isServiceHealthy),
    services,
  };
}

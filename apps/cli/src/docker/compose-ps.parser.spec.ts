import { describe, expect, it } from 'vitest';

import type { ServiceStatus } from './compose.types';
import { buildStackStatus, parseComposePs } from './compose-ps.parser';

const caddy = {
  Service: 'caddy',
  State: 'running',
  Health: 'healthy',
  ExitCode: 0,
  Publishers: [
    { URL: '0.0.0.0', TargetPort: 443, PublishedPort: 443, Protocol: 'tcp' },
    { URL: '::', TargetPort: 443, PublishedPort: 443, Protocol: 'tcp' },
    { URL: '0.0.0.0', TargetPort: 80, PublishedPort: 80, Protocol: 'tcp' },
    { URL: '0.0.0.0', TargetPort: 443, PublishedPort: 443, Protocol: 'udp' },
  ],
};
const sonarr = {
  Service: 'sonarr',
  State: 'running',
  Health: 'starting',
  ExitCode: 0,
  Publishers: [{ URL: '127.0.0.1', TargetPort: 8989, PublishedPort: 8989, Protocol: 'tcp' }],
};
const flaresolverr = {
  Service: 'flaresolverr',
  State: 'exited',
  Health: '',
  ExitCode: 137,
  Publishers: [{ URL: '', TargetPort: 8191, PublishedPort: 0, Protocol: 'tcp' }],
};

describe('parseComposePs', () => {
  it('parses a JSON array', () => {
    const services = parseComposePs(JSON.stringify([caddy, sonarr]), ['caddy', 'sonarr']);

    expect(services).toEqual([
      {
        service: 'caddy',
        state: 'running',
        health: 'healthy',
        exitCode: 0,
        publishedPorts: ['80/tcp', '443/tcp', '443/udp'],
      },
      {
        service: 'sonarr',
        state: 'running',
        health: 'starting',
        exitCode: 0,
        publishedPorts: ['8989/tcp'],
      },
    ]);
  });

  it('parses NDJSON', () => {
    const stdout = `${JSON.stringify(caddy)}\n${JSON.stringify(sonarr)}\n`;

    const services = parseComposePs(stdout, ['caddy', 'sonarr']);

    expect(services.map((s) => s.service)).toEqual(['caddy', 'sonarr']);
    expect(services[1]?.health).toBe('starting');
  });

  it('reports services without a container as missing, in the expected order', () => {
    const services = parseComposePs(JSON.stringify([sonarr]), ['caddy', 'sonarr', 'bazarr']);

    expect(services.map((s) => [s.service, s.state, s.health])).toEqual([
      ['caddy', 'missing', 'none'],
      ['sonarr', 'running', 'starting'],
      ['bazarr', 'missing', 'none'],
    ]);
  });

  it('treats empty output as no containers', () => {
    const services = parseComposePs('  \n', ['caddy']);

    expect(services).toEqual([
      { service: 'caddy', state: 'missing', health: 'none', exitCode: 0, publishedPorts: [] },
    ]);
  });

  it('keeps exit codes, ignores unpublished ports and maps dead containers to exited', () => {
    const dead = { ...flaresolverr, State: 'dead' };

    const [service] = parseComposePs(JSON.stringify([dead]), ['flaresolverr']);

    expect(service).toMatchObject({ state: 'exited', health: 'none', exitCode: 137 });
    expect(service?.publishedPorts).toEqual([]);
  });

  it('ignores containers of services that are not expected', () => {
    const services = parseComposePs(JSON.stringify([caddy, sonarr]), ['caddy']);

    expect(services.map((s) => s.service)).toEqual(['caddy']);
  });

  it('rejects output that is not JSON', () => {
    expect(() => parseComposePs('not json', ['caddy'])).toThrow(/neither JSON nor NDJSON/);
  });
});

describe('buildStackStatus', () => {
  const healthy: Omit<ServiceStatus, 'service'> = {
    state: 'running',
    health: 'healthy',
    exitCode: 0,
    publishedPorts: [],
  };

  it('is healthy when every service is running and healthy or has no healthcheck', () => {
    const status = buildStackStatus('moody-blues', [
      { service: 'caddy', ...healthy },
      { service: 'flaresolverr', ...healthy, health: 'none' },
    ]);

    expect(status.allHealthy).toBe(true);
    expect(status.project).toBe('moody-blues');
  });

  it.each([
    ['starting', { state: 'running', health: 'starting' }],
    ['unhealthy', { state: 'running', health: 'unhealthy' }],
    ['exited', { state: 'exited', health: 'none' }],
    ['missing', { state: 'missing', health: 'none' }],
    ['restarting', { state: 'restarting', health: 'none' }],
  ] as const)('is not healthy when a service is %s', (_name, override) => {
    const status = buildStackStatus('moody-blues', [
      { service: 'caddy', ...healthy },
      { service: 'sonarr', ...healthy, ...override },
    ]);

    expect(status.allHealthy).toBe(false);
  });

  it('is not healthy when there are no services', () => {
    expect(buildStackStatus('moody-blues', []).allHealthy).toBe(false);
  });
});

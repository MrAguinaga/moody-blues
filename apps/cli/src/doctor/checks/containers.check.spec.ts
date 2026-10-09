import { describe, expect, it } from 'vitest';

import { buildStackStatus } from '../../docker';
import { createTestContext, runningService } from '../doctor-context.testing';
import { containersCheck, evaluateContainers } from './containers.check';

const stack = (...services: ReturnType<typeof runningService>[]) =>
  buildStackStatus('moody-blues', services);

describe('evaluateContainers', () => {
  it('is ok when every service is running and healthy or has no healthcheck', () => {
    const result = evaluateContainers(
      stack(runningService('sonarr'), runningService('caddy', { health: 'none' })),
    );

    expect(result).toEqual({ status: 'ok', message: '2 of 2 services are healthy' });
  });

  it('warns when a service is still starting and none failed', () => {
    const result = evaluateContainers(
      stack(runningService('sonarr'), runningService('jellyfin', { health: 'starting' })),
    );

    expect(result.status).toBe('warning');
    expect(result.message).toBe('1 of 2 services are healthy');
    expect(result.details).toEqual(['jellyfin: running (starting)']);
  });

  it.each([
    ['missing', { state: 'missing', health: 'none' }, 'bazarr: missing'],
    ['exited', { state: 'exited', health: 'none', exitCode: 137 }, 'bazarr: exited, exit code 137'],
    ['created', { state: 'created', health: 'none' }, 'bazarr: created'],
    ['paused', { state: 'paused', health: 'none' }, 'bazarr: paused'],
    ['restarting', { state: 'restarting', health: 'none' }, 'bazarr: restarting'],
    ['unhealthy', { health: 'unhealthy' }, 'bazarr: running (unhealthy)'],
  ] as const)('fails when a service is %s', (_name, patch, line) => {
    const result = evaluateContainers(
      stack(runningService('sonarr'), runningService('bazarr', patch)),
    );

    expect(result.status).toBe('error');
    expect(result.message).toBe('1 of 2 services are healthy');
    expect(result.details).toEqual([line]);
    expect(result.suggestion).toContain('moody-blues logs bazarr');
  });

  it('fails over a starting service when another one has failed', () => {
    const result = evaluateContainers(
      stack(
        runningService('jellyfin', { health: 'starting' }),
        runningService('bazarr', { state: 'exited', health: 'none' }),
      ),
    );

    expect(result.status).toBe('error');
    expect(result.details).toHaveLength(1);
  });

  it('fails when Compose reports no services', () => {
    expect(evaluateContainers(stack()).status).toBe('error');
  });
});

describe('containersCheck', () => {
  it('fails when Docker does not report the stack', async () => {
    const { ctx } = createTestContext({ stack: new Error('docker compose ps failed') });

    const result = await containersCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details).toEqual(['docker compose ps failed']);
  });

  it('does not require Decypharr when the storage profile is off', async () => {
    const { ctx } = createTestContext({ storage: false });

    const result = await containersCheck.run(ctx);

    expect(result).toEqual({ status: 'ok', message: '8 of 8 services are healthy' });
  });

  it('requires Decypharr when the storage profile is on', async () => {
    const { ctx } = createTestContext({
      storage: true,
      services: { decypharr: { state: 'exited', health: 'none' } },
    });

    const result = await containersCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe('8 of 9 services are healthy');
  });
});

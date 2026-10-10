import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import { ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import { runPipeline } from '../pipeline/pipeline.runner';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { createFakeProwlarr, type FakeProwlarr } from '../testing/fake-prowlarr';
import { createProwlarrClient } from './prowlarr.client';
import { PROWLARR_INDEXERS } from './prowlarr.indexers';
import { provisionProwlarr, type ProvisionProwlarrOptions } from './prowlarr.provision';
import { createProwlarrProvisionStep } from './prowlarr-provision.step';

const identity = { puid: 1000, pgid: 1000 };
const secrets = { rdApiToken: 'rd-token', adminUsername: 'Admin', adminPassword: 'p@ss word' };
const API_KEY = 'prowlarr-key';
const noSleep = async () => undefined;

function createContext(overrides: Partial<ProvisionContext> = {}): ProvisionContext {
  return {
    config: createDefaultConfig({ host: identity }),
    secrets,
    layout: createLayout('/unused'),
    identity,
    runtime: {} as ContainerRuntime,
    flags: new Map(),
    cliVersion: '9.9.9',
    ...overrides,
  };
}

function run(
  server: FakeProwlarr,
  ctx: ProvisionContext = createContext(),
  overrides: Partial<ProvisionProwlarrOptions> = {},
) {
  const client = createProwlarrClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    fetch: server.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return provisionProwlarr(ctx, {
    client,
    apiKeys: { sonarr: 'sonarr-key', radarr: 'radarr-key' },
    signal: new AbortController().signal,
    ready: { sleep: noSleep },
    definitions: { sleep: noSleep },
    sync: { sleep: noSleep },
    ...overrides,
  });
}

function indexerNames(server: FakeProwlarr): unknown[] {
  return server.state.indexers.map((indexer) => indexer.definitionName);
}

describe('provisionProwlarr', () => {
  let server: FakeProwlarr;

  beforeEach(() => {
    server = createFakeProwlarr({ apiKey: API_KEY });
  });

  it('provisions a fresh instance and reports what changed', async () => {
    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toBe(
      'administrator account, FlareSolverr proxy, Sonarr application, Radarr application, ' +
        'Standard profile minimum seeders, ' +
        `created indexers ${PROWLARR_INDEXERS.map((entry) => entry.definitionName).join(', ')}`,
    );
    expect(server.canLogin('admin', 'p@ss word')).toBe(true);
    expect(server.state.tags.map((tag) => tag.label)).toEqual(['flaresolverr']);
    expect(server.state.proxies.map((proxy) => proxy.name)).toEqual(['FlareSolverr']);
    expect(server.state.applications.map((application) => application.name)).toEqual([
      'Sonarr',
      'Radarr',
    ]);
    expect(indexerNames(server)).toEqual(PROWLARR_INDEXERS.map((entry) => entry.definitionName));
  });

  it('links the applications before it adds any indexer', async () => {
    await run(server);

    const writes = server.writes().map((request) => request.path);
    const lastApplication = writes.lastIndexOf('/api/v1/applications');
    const firstIndexer = writes.indexOf('/api/v1/indexer');
    expect(lastApplication).toBeGreaterThanOrEqual(0);
    expect(lastApplication).toBeLessThan(firstIndexer);
  });

  it('forces one full application sync when something was created', async () => {
    await run(server);

    expect(server.state.commands).toHaveLength(1);
    expect(server.state.commands[0]).toMatchObject({ name: 'ApplicationIndexerSync' });
    expect(server.state.commands[0]?.body).toMatchObject({ forceSync: true });
  });

  it('emits no write and no sync on the second run', async () => {
    await run(server);
    const writesAfterFirst = server.writes().length;

    const outcome = await run(server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(writesAfterFirst);
    expect(server.state.commands).toHaveLength(1);
    expect(server.requests.slice(-1)[0]?.method).toBe('GET');
  });

  it('syncs again when a later run has to repair an indexer', async () => {
    await run(server);
    server.state.indexers[0] = { ...server.state.indexers[0], enable: false };

    const outcome = await run(server);

    expect(outcome).toEqual({ status: 'changed', detail: 'updated indexers 1337x' });
    expect(server.state.commands).toHaveLength(2);
  });

  it('waits for the Cardigann definitions that appear after a few polls', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, schemaDelayCalls: 3 });
    let slept = 0;

    const outcome = await run(server, createContext(), {
      definitions: {
        sleep: async () => {
          slept += 1;
        },
      },
    });

    expect(outcome.status).toBe('changed');
    expect(server.count('GET', '/api/v1/indexer/schema')).toBe(4);
    expect(slept).toBe(3);
    expect(indexerNames(server)).toHaveLength(PROWLARR_INDEXERS.length);
  });

  it('fails with a network hint when the definitions never arrive', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, schemaDelayCalls: 1_000_000 });
    let elapsed = 0;

    const error = await run(server, createContext(), {
      definitions: {
        timeoutMs: 90_000,
        intervalMs: 3_000,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
        },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toContain('1337x, thepiratebay, yts, eztv, nyaasi, Knaben');
    expect(message).toContain('90 s');
    expect(message).toContain('outbound HTTPS');
    expect(server.state.indexers).toHaveLength(0);
  });

  it('skips an indexer that answers 400 and still finishes', async () => {
    server = createFakeProwlarr({
      apiKey: API_KEY,
      failingIndexers: { '1337x': 'Unable to connect to indexer. Name does not resolve' },
    });

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toContain('created indexers thepiratebay, yts, eztv, nyaasi, Knaben');
    expect(outcome.detail).toContain('skipped indexers 1337x (Unable to connect to indexer)');
    expect(indexerNames(server)).not.toContain('1337x');
  });

  it('does not wait when a retired definition is absent and the others are loaded', async () => {
    const definitions = PROWLARR_INDEXERS.map((entry) => entry.definitionName).filter(
      (name) => name !== 'yts',
    );
    server = createFakeProwlarr({ apiKey: API_KEY, definitions });
    let slept = 0;

    const outcome = await run(server, createContext(), {
      definitions: {
        sleep: async () => {
          slept += 1;
        },
      },
    });

    expect(slept).toBe(0);
    expect(server.count('GET', '/api/v1/indexer/schema')).toBe(1);
    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toContain('skipped indexers yts (definition not available)');
    expect(indexerNames(server)).not.toContain('yts');
    expect(indexerNames(server)).toHaveLength(PROWLARR_INDEXERS.length - 1);
  });

  it('continues with the available definitions once the wait runs out', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, definitions: ['yts', 'other'] });

    const outcome = await run(server);

    expect(outcome.detail).toContain('created indexers yts');
    expect(outcome.detail).toContain('1337x (definition not available)');
    expect(indexerNames(server)).toEqual(['yts']);
  });

  it('fails without waiting when other definitions load but none of the list does', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, definitions: ['other'] });

    const error = await run(server).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain('outbound HTTPS');
    expect(server.count('GET', '/api/v1/indexer/schema')).toBe(1);
    expect(server.state.indexers).toHaveLength(0);
  });

  it('keeps a long rejection to its first sentence and 80 characters', async () => {
    server = createFakeProwlarr({
      apiKey: API_KEY,
      failingIndexers: {
        thepiratebay:
          'Unable to connect to indexer, check the log above the ValidationFailure for more details. Extra',
        yts: 'Short reason. Second sentence',
      },
    });

    const outcome = await run(server);

    const expectedCut = `${'Unable to connect to indexer, check the log above the ValidationFailure for more details'.slice(0, 79)}…`;
    expect(expectedCut).toHaveLength(80);
    expect(outcome.detail).toContain(`thepiratebay (${expectedCut})`);
    expect(outcome.detail).toContain('yts (Short reason)');
    expect(outcome.detail).not.toContain('Second sentence');
  });

  it('issues no writes on a second run when nothing is skipped', async () => {
    await run(server);
    const writes = server.writes().length;

    const second = await run(server);

    expect(second).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(writes);
  });

  it('retries a skipped indexer on every run and registers it once it answers', async () => {
    server.setIndexerFailure('yts', 'Unable to connect to indexer');
    await run(server);

    const stillDown = await run(server);
    server.setIndexerFailure('yts', undefined);
    const recovered = await run(server);

    expect(stillDown).toEqual({
      status: 'unchanged',
      detail: 'skipped indexers yts (Unable to connect to indexer)',
    });
    expect(recovered).toEqual({ status: 'changed', detail: 'created indexers yts' });
    expect(indexerNames(server)).toContain('yts');
    expect(server.state.commands).toHaveLength(2);
  });

  it('fails when no indexer can be registered', async () => {
    server = createFakeProwlarr({
      apiKey: API_KEY,
      failingIndexers: Object.fromEntries(
        PROWLARR_INDEXERS.map((entry) => [entry.definitionName, 'blocked by the network']),
      ),
    });

    await expect(run(server)).rejects.toThrow(
      'Prowlarr registered none of the indexers: 1337x (blocked by the network)',
    );
    expect(server.state.commands).toHaveLength(0);
  });

  it('fails when an application cannot be linked and adds no indexer', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, unreachableApplications: ['radarr'] });

    await expect(run(server)).rejects.toThrow('cannot connect to Radarr');
    expect(server.state.indexers).toHaveLength(0);
  });

  it('keeps going and reports a note when FlareSolverr is unreachable', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, flaresolverrReachable: false });

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toContain('FlareSolverr proxy test failed: Unable to connect to proxy');
    expect(server.state.proxies).toHaveLength(1);
    expect(server.state.applications).toHaveLength(2);
  });

  it('tests the proxy on every run so that Prowlarr clears a stale failure', async () => {
    await run(server);
    await run(server);

    expect(server.count('POST', '/api/v1/indexerproxy/test')).toBe(2);
  });

  it('refreshes the health checks when the proxy recovers from a recorded failure', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, proxyFailing: true });

    const outcome = await run(server);

    expect(server.state.commands.map((command) => command.name)).toEqual([
      'ApplicationIndexerSync',
      'CheckHealth',
    ]);
    expect(outcome.detail).not.toContain('health:');
  });

  it('does not refresh the health checks when the proxy test fails', async () => {
    server = createFakeProwlarr({
      apiKey: API_KEY,
      flaresolverrReachable: false,
      proxyFailing: true,
    });

    const outcome = await run(server);

    expect(server.state.commands.map((command) => command.name)).toEqual([
      'ApplicationIndexerSync',
    ]);
    expect(outcome.detail).toContain('health: All indexer proxies are unavailable');
  });

  it('keeps a note instead of failing when the health refresh fails', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, proxyFailing: true });
    const client = createProwlarrClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      fetch: server.fetch,
      sleep: noSleep,
      random: () => 0.5,
    });
    client.refreshHealth = async () => {
      throw new Error('Prowlarr health check failed');
    };

    const outcome = await run(server, createContext(), { client });

    expect(outcome.detail).toContain('health check refresh failed: Prowlarr health check failed');
  });

  it('does not run the health refresh when the proxy is healthy', async () => {
    await run(server);

    expect(server.state.commands.map((command) => command.name)).toEqual([
      'ApplicationIndexerSync',
    ]);
  });

  it('lowers the minimum seeders of the Standard profile and leaves the indexers to inherit it', async () => {
    await run(server);

    const puts = server.requests.filter((request) => request.path === '/api/v1/appprofile/1');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toMatchObject({ minimumSeeders: 0 });
    for (const indexer of server.state.indexers) {
      const field = (indexer.fields as { name: string; value: unknown }[]).find(
        (entry) => entry.name === 'torrentBaseSettings.appMinimumSeeders',
      );
      expect(field?.value).toBeNull();
    }
  });

  it('fails when the application sync command fails', async () => {
    server = createFakeProwlarr({ apiKey: API_KEY, commandOutcome: 'failed' });

    await expect(run(server)).rejects.toThrow('application sync failed');
  });

  it('reports blocked indexers and health issues without failing', async () => {
    server = createFakeProwlarr({
      apiKey: API_KEY,
      blockedIndexers: ['eztv'],
      health: [{ source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable' }],
    });

    const outcome = await run(server);

    expect(outcome.status).toBe('changed');
    expect(outcome.detail).toContain('blocked indexers EZTV');
    expect(outcome.detail).toContain('health: Indexers unavailable');
  });

  it('rewrites the administrator on credential rotation', async () => {
    await run(server);
    const flags = new Map([[ROTATE_CREDENTIALS_FLAG, true]]);

    const outcome = await run(server, createContext({ flags }));

    expect(outcome).toEqual({ status: 'changed', detail: 'administrator account' });
  });

  it('reports progress for every section', async () => {
    const messages: string[] = [];

    await run(server, createContext({ reportProgress: (message) => messages.push(message) }));

    expect(messages[0]).toBe('Waiting for Prowlarr');
    expect(messages).toContain('Linking Sonarr');
    expect(messages).toContain('Linking Radarr');
    expect(messages).toContain('Configuring indexer eztv');
    expect(messages.at(-1)).toBe('Verifying status');
  });

  it('only registers the indexers it is given', async () => {
    const [first] = PROWLARR_INDEXERS;

    await run(server, createContext(), { indexers: first ? [first] : [] });

    expect(indexerNames(server)).toEqual(['1337x']);
  });
});

describe('prowlarr-provision step', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-prowlarr-'));
    layout = createLayout(join(sandbox, 'home'));
    mkdirSync(layout.root, { recursive: true });
    writeFileSync(
      layout.envFile,
      [
        'SONARR_API_KEY=sonarr-key',
        'RADARR_API_KEY=radarr-key',
        `PROWLARR_API_KEY=${API_KEY}`,
        'BAZARR_API_KEY=bazarr-key',
        'DECYPHARR_API_TOKEN=decypharr-token',
        'SEERR_API_KEY=seerr-key',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('runs in every scope that starts services', () => {
    const step = createProwlarrProvisionStep();

    expect(step.id).toBe('prowlarr-provision');
    expect(step.scopes).toEqual(['setup', 'reset', 'config', 'update']);
  });

  it('provisions through the host url with the seeded keys and stays quiet the second time', async () => {
    const server = createFakeProwlarr({ apiKey: API_KEY });
    const step = createProwlarrProvisionStep({ fetch: server.fetch, sleep: noSleep });
    const ctx = createContext({ layout });

    const first = await runPipeline([step], ctx, { scope: 'setup' });
    const writes = server.writes().length;
    const second = await runPipeline([step], ctx, { scope: 'setup' });

    expect(first.steps[0]).toMatchObject({ id: 'prowlarr-provision', status: 'changed' });
    expect(second.steps[0]).toMatchObject({ id: 'prowlarr-provision', status: 'unchanged' });
    expect(server.writes()).toHaveLength(writes);
    expect(
      server.requests.every((request) => request.url.startsWith('http://127.0.0.1:9696')),
    ).toBe(true);
    const applicationKeys = server.state.applications.map(
      (application) =>
        (application.fields as { name: string; value: unknown }[]).find(
          (entry) => entry.name === 'apiKey',
        )?.value,
    );
    expect(applicationKeys).toEqual(['sonarr-key', 'radarr-key']);
  });

  it('fails the pipeline when the environment file lacks the service keys', async () => {
    writeFileSync(layout.envFile, 'PROWLARR_API_KEY=prowlarr-key\n');
    const step = createProwlarrProvisionStep({ sleep: noSleep });

    const report = await runPipeline([step], createContext({ layout }), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Missing service keys');
  });

  it('fails with a readiness error when Prowlarr never answers', async () => {
    const server = createFakeProwlarr({ apiKey: API_KEY, pingFailures: 99 });
    let elapsed = 0;
    const step = createProwlarrProvisionStep({
      fetch: server.fetch,
      ready: {
        timeoutMs: 3000,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
        },
      },
    });

    const report = await runPipeline([step], createContext({ layout }), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Prowlarr was not ready');
  });
});

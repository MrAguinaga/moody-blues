import { describe, expect, it } from 'vitest';

import { HttpStatusError } from '../http/http.errors';
import { UnknownProviderFieldError } from '../http/provider-fields';
import { createFakeProwlarr, type FakeProwlarrOptions } from '../testing/fake-prowlarr';
import {
  createProwlarrClient,
  MIN_SEEDERS_FIELD,
  type ProwlarrClient,
  type ProwlarrClientOptions,
} from './prowlarr.client';
import { MIN_SEEDERS, PROWLARR_INDEXERS } from './prowlarr.indexers';
import type { IndexerResource, IndexerSpec } from './prowlarr.types';

const API_KEY = 'prowlarr-key';
const noSleep = async () => undefined;
const URLS = {
  sonarr: { prowlarrUrl: 'http://prowlarr:9696', baseUrl: 'http://sonarr:8989' },
  radarr: { prowlarrUrl: 'http://prowlarr:9696', baseUrl: 'http://radarr:7878' },
};

function setup(
  options: Partial<FakeProwlarrOptions> = {},
  clientOptions: Partial<ProwlarrClientOptions> = {},
) {
  const fake = createFakeProwlarr({ apiKey: API_KEY, ...options });
  const client: ProwlarrClient = createProwlarrClient({
    baseUrl: fake.baseUrl,
    apiKey: API_KEY,
    fetch: fake.fetch,
    sleep: noSleep,
    random: () => 0.5,
    ...clientOptions,
  });
  return { fake, client };
}

async function indexerContext(client: ProwlarrClient, existing: IndexerResource[] = []) {
  const tag = await client.ensureTag('flaresolverr');
  return {
    schema: await client.listIndexerSchema(),
    context: {
      appProfileId: (await client.ensureStandardAppProfile(MIN_SEEDERS)).id,
      flaresolverrTagId: tag.id,
      existing,
    },
  };
}

function spec(definitionName: string): IndexerSpec {
  return PROWLARR_INDEXERS.find((entry) => entry.definitionName === definitionName) as IndexerSpec;
}

function schemaFor(schema: IndexerResource[], definitionName: string): IndexerResource {
  return schema.find((item) => item.definitionName === definitionName) as IndexerResource;
}

function fieldValue(resource: IndexerResource, name: string): unknown {
  return resource.fields.find((entry) => entry.name === name)?.value;
}

describe('createProwlarrClient', () => {
  it('authenticates every request with the X-Api-Key header', async () => {
    const { fake, client } = setup();

    await client.getSystemStatus();
    await client.ensureStandardAppProfile(MIN_SEEDERS);
    await client.listIndexers();

    expect(fake.requests.length).toBeGreaterThanOrEqual(3);
    expect(fake.requests.every((request) => request.headers['x-api-key'] === API_KEY)).toBe(true);
  });

  it('waits for the ping before verifying the key', async () => {
    const { fake, client } = setup({ pingFailures: 2 });

    await client.waitReady({ sleep: noSleep });

    expect(fake.count('GET', '/ping')).toBe(3);
    expect(fake.count('GET', '/api/v1/system/status')).toBe(1);
  });

  it('rejects a wrong api key', async () => {
    const { client } = setup({}, { apiKey: 'wrong-key' });

    await expect(client.waitReady({ sleep: noSleep, timeoutMs: 1 })).rejects.toThrow();
  });
});

describe('ensureTag', () => {
  it('creates the tag in lower case once and reuses it afterwards', async () => {
    const { fake, client } = setup();

    const created = await client.ensureTag('FlareSolverr');
    const reused = await client.ensureTag('flaresolverr');

    expect(created).toEqual({ id: 1, label: 'flaresolverr' });
    expect(reused).toEqual(created);
    expect(fake.count('POST', '/api/v1/tag')).toBe(1);
    expect(fake.requests.find((request) => request.method === 'POST')?.body).toEqual({
      label: 'flaresolverr',
    });
  });
});

describe('ensureFlaresolverrProxy', () => {
  it('creates the proxy bound to the tag with the internal address', async () => {
    const { fake, client } = setup();

    const changed = await client.ensureFlaresolverrProxy(7);

    expect(changed).toBe(true);
    expect(fake.state.proxies[0]).toMatchObject({
      name: 'FlareSolverr',
      implementation: 'FlareSolverr',
      configContract: 'FlareSolverrSettings',
      onHealthIssue: false,
      tags: [7],
    });
    expect(
      (fake.state.proxies[0]?.fields as { name: string; value: unknown }[]).map((entry) => [
        entry.name,
        entry.value,
      ]),
    ).toEqual([
      ['host', 'http://flaresolverr:8191/'],
      ['requestTimeout', 60],
    ]);
  });

  it('does not write when the proxy already matches', async () => {
    const { fake, client } = setup();
    await client.ensureFlaresolverrProxy(1);
    const writes = fake.writes().length;

    await expect(client.ensureFlaresolverrProxy(1)).resolves.toBe(false);

    expect(fake.writes()).toHaveLength(writes);
  });

  it('repairs a drifted proxy with forceSave', async () => {
    const { fake, client } = setup();
    await client.ensureFlaresolverrProxy(1);
    fake.state.proxies[0] = { ...fake.state.proxies[0], tags: [] };

    await expect(client.ensureFlaresolverrProxy(1)).resolves.toBe(true);

    const put = fake.requests.find((request) => request.method === 'PUT');
    expect(put).toMatchObject({ path: '/api/v1/indexerproxy/1', query: { forceSave: 'true' } });
    expect(fake.state.proxies[0]?.tags).toEqual([1]);
  });

  it('leaves an indexer untagged when its schema item lacks info_flaresolverr', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);
    const eztv = schemaFor(schema, 'eztv');
    const stripped = {
      ...eztv,
      fields: eztv.fields.filter((entry) => entry.name !== 'info_flaresolverr'),
    };

    await client.ensureIndexer(spec('eztv'), stripped, context);

    expect(fake.state.indexers[0]?.tags).toEqual([]);
  });

  it('does not send forceSave when the server accepts the proxy', async () => {
    const { fake, client } = setup();

    await client.ensureFlaresolverrProxy(1);

    const posts = fake.requests.filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.query).toEqual({});
  });

  it('saves the proxy with forceSave when FlareSolverr is unreachable', async () => {
    const { fake, client } = setup({ flaresolverrReachable: false });

    await expect(client.ensureFlaresolverrProxy(1)).resolves.toBe(true);

    const posts = fake.requests.filter((request) => request.method === 'POST');
    expect(posts.map((request) => request.query)).toEqual([{}, { forceSave: 'true' }]);
    expect(fake.state.proxies).toHaveLength(1);
  });

  it('does not hide errors other than a rejected validation', async () => {
    const { client } = setup({}, { apiKey: 'wrong-key' });

    await expect(client.ensureFlaresolverrProxy(1)).rejects.toBeInstanceOf(HttpStatusError);
  });
});

describe('testFlaresolverrProxy', () => {
  it('posts the stored proxy to the test endpoint', async () => {
    const { fake, client } = setup();
    await client.ensureFlaresolverrProxy(1);

    await expect(client.testFlaresolverrProxy()).resolves.toEqual({ ok: true });

    const test = fake.requests.find((request) => request.path === '/api/v1/indexerproxy/test');
    expect(test).toMatchObject({ method: 'POST' });
    expect(test?.body).toMatchObject({ id: 1, name: 'FlareSolverr', tags: [1] });
  });

  it('reports the reason when the proxy cannot reach FlareSolverr', async () => {
    const { client } = setup({ flaresolverrReachable: false });
    await client.ensureFlaresolverrProxy(1);

    const result = await client.testFlaresolverrProxy();

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('Unable to connect to proxy');
  });

  it('fails when the proxy does not exist', async () => {
    const { client } = setup();

    await expect(client.testFlaresolverrProxy()).rejects.toThrow('no FlareSolverr indexer proxy');
  });
});

describe('ensureStandardAppProfile', () => {
  it('lowers the minimum seeders of the Standard profile once', async () => {
    const { fake, client } = setup();

    await expect(client.ensureStandardAppProfile(MIN_SEEDERS)).resolves.toEqual({
      id: 1,
      changed: true,
    });
    await expect(client.ensureStandardAppProfile(MIN_SEEDERS)).resolves.toEqual({
      id: 1,
      changed: false,
    });

    const puts = fake.requests.filter((request) => request.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ path: '/api/v1/appprofile/1' });
    expect(puts[0]?.body).toMatchObject({ name: 'Standard', minimumSeeders: 0 });
  });
});

describe('ensureApplication', () => {
  it('links Sonarr with prowlarrUrl and baseUrl on the right sides in fullSync', async () => {
    const { fake, client } = setup();

    await client.ensureApplication('sonarr', URLS.sonarr, 'sonarr-key');

    const [application] = fake.state.applications;
    expect(application).toMatchObject({
      name: 'Sonarr',
      implementation: 'Sonarr',
      configContract: 'SonarrSettings',
      syncLevel: 'fullSync',
      tags: [],
    });
    const values = Object.fromEntries(
      (application?.fields as { name: string; value: unknown }[]).map((entry) => [
        entry.name,
        entry.value,
      ]),
    );
    expect(values).toMatchObject({
      prowlarrUrl: 'http://prowlarr:9696',
      baseUrl: 'http://sonarr:8989',
      apiKey: 'sonarr-key',
      syncCategories: [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
      animeSyncCategories: [5070],
    });
  });

  it('links Radarr with the categories of its schema', async () => {
    const { fake, client } = setup();

    await client.ensureApplication('radarr', URLS.radarr, 'radarr-key');

    const [application] = fake.state.applications;
    expect(application).toMatchObject({ name: 'Radarr', configContract: 'RadarrSettings' });
    const categories = (application?.fields as { name: string; value: unknown }[]).find(
      (entry) => entry.name === 'syncCategories',
    )?.value as number[];
    expect(categories.length).toBeGreaterThan(0);
  });

  it('is rejected by the server when the two addresses are swapped', async () => {
    const { client } = setup();

    await expect(
      client.ensureApplication(
        'sonarr',
        { prowlarrUrl: 'http://sonarr:8989', baseUrl: 'http://prowlarr:9696' },
        'sonarr-key',
      ),
    ).rejects.toThrow('API Key is invalid');
  });

  it('does not write when the application matches, although the api key comes back masked', async () => {
    const { fake, client } = setup();
    await client.ensureApplication('sonarr', URLS.sonarr, 'sonarr-key');
    const writes = fake.writes().length;

    await expect(client.ensureApplication('sonarr', URLS.sonarr, 'sonarr-key')).resolves.toBe(
      false,
    );

    expect(fake.writes()).toHaveLength(writes);
  });

  it('repairs a drifted application with forceSave and the real api key', async () => {
    const { fake, client } = setup();
    await client.ensureApplication('sonarr', URLS.sonarr, 'sonarr-key');
    fake.state.applications[0] = { ...fake.state.applications[0], syncLevel: 'addOnly' };

    await expect(client.ensureApplication('sonarr', URLS.sonarr, 'sonarr-key')).resolves.toBe(true);

    const put = fake.requests.find((request) => request.method === 'PUT');
    expect(put).toMatchObject({ path: '/api/v1/applications/1', query: { forceSave: 'true' } });
    expect(put?.body).toMatchObject({ syncLevel: 'fullSync' });
    const sentKey = (put?.body as { fields: { name: string; value: unknown }[] }).fields.find(
      (entry) => entry.name === 'apiKey',
    )?.value;
    expect(sentKey).toBe('sonarr-key');
  });

  it('never sends forceSave when creating', async () => {
    const { fake, client } = setup();

    await client.ensureApplication('radarr', URLS.radarr, 'radarr-key');

    expect(fake.requests.find((request) => request.method === 'POST')?.query).toEqual({});
  });

  it('reports the validation message when the application cannot be reached', async () => {
    const { client } = setup({ unreachableApplications: ['radarr'] });

    await expect(client.ensureApplication('radarr', URLS.radarr, 'radarr-key')).rejects.toThrow(
      'cannot connect to Radarr',
    );
  });
});

describe('ensureIndexer', () => {
  it('leaves the minimum seeders to the Standard profile through torrentBaseSettings.appMinimumSeeders', () => {
    expect(MIN_SEEDERS_FIELD).toBe('torrentBaseSettings.appMinimumSeeders');
  });

  it('creates the indexer from its schema item with the Standard profile and no top-level seeders', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);

    const change = await client.ensureIndexer(spec('yts'), schemaFor(schema, 'yts'), context);

    expect(change).toEqual({ result: 'created', definitionName: 'yts' });
    const [stored] = fake.state.indexers;
    expect(stored).toMatchObject({
      name: 'YTS',
      enable: true,
      appProfileId: 1,
      priority: 25,
      tags: [],
    });
    expect(stored).not.toHaveProperty('minimumSeeders');
    expect(fieldValue(stored as unknown as IndexerResource, MIN_SEEDERS_FIELD)).toBeNull();
    expect(fieldValue(stored as unknown as IndexerResource, 'apiurl')).toBe('movies-api.accel.li');
  });

  it('tags only the indexers whose definition declares info_flaresolverr', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);

    for (const entry of PROWLARR_INDEXERS) {
      await client.ensureIndexer(entry, schemaFor(schema, entry.definitionName), context);
    }

    const tagged = fake.state.indexers
      .filter((indexer) => (indexer.tags as number[]).length > 0)
      .map((indexer) => indexer.definitionName);
    expect(tagged).toEqual(['1337x', 'eztv']);
    expect(fake.state.indexers.find((indexer) => indexer.definitionName === 'eztv')?.tags).toEqual([
      context.flaresolverrTagId,
    ]);
  });

  it('never sends forceSave when creating', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);

    await client.ensureIndexer(spec('eztv'), schemaFor(schema, 'eztv'), context);

    expect(fake.requests.find((request) => request.method === 'POST')?.query).toEqual({});
  });

  it('leaves an indexer that already matches untouched', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);
    await client.ensureIndexer(spec('nyaasi'), schemaFor(schema, 'nyaasi'), context);
    const writes = fake.writes().length;
    const existing = await client.listIndexers();

    const change = await client.ensureIndexer(spec('nyaasi'), schemaFor(schema, 'nyaasi'), {
      ...context,
      existing,
    });

    expect(change).toEqual({ result: 'unchanged', definitionName: 'nyaasi' });
    expect(fake.writes()).toHaveLength(writes);
  });

  it('updates a drifted indexer with forceSave and without touching the rest of its fields', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);
    await client.ensureIndexer(spec('1337x'), schemaFor(schema, '1337x'), context);
    const stored = fake.state.indexers[0] as Record<string, unknown>;
    fake.state.indexers[0] = {
      ...stored,
      enable: false,
      tags: [],
      fields: (stored.fields as { name: string; value: unknown }[]).map((entry) =>
        entry.name === MIN_SEEDERS_FIELD ? { ...entry, value: 5 } : entry,
      ),
    };
    const existing = await client.listIndexers();

    const change = await client.ensureIndexer(spec('1337x'), schemaFor(schema, '1337x'), {
      ...context,
      existing,
    });

    expect(change).toEqual({ result: 'updated', definitionName: '1337x' });
    const put = fake.requests.find((request) => request.path === '/api/v1/indexer/1');
    expect(put).toMatchObject({ path: '/api/v1/indexer/1', query: { forceSave: 'true' } });
    expect(fake.state.indexers[0]).toMatchObject({
      enable: true,
      tags: [context.flaresolverrTagId],
    });
    expect(
      fieldValue(fake.state.indexers[0] as unknown as IndexerResource, MIN_SEEDERS_FIELD),
    ).toBeNull();
    expect(fieldValue(fake.state.indexers[0] as unknown as IndexerResource, 'sort')).toBe(2);
  });

  it('skips an indexer the server rejects and keeps the reason', async () => {
    const { fake, client } = setup({
      failingIndexers: { yts: 'Unable to connect to indexer. Name does not resolve (yts.example)' },
    });
    const { schema, context } = await indexerContext(client);

    const change = await client.ensureIndexer(spec('yts'), schemaFor(schema, 'yts'), context);

    expect(change).toEqual({
      result: 'skipped',
      definitionName: 'yts',
      reason: 'Unable to connect to indexer. Name does not resolve (yts.example)',
    });
    expect(fake.state.indexers).toHaveLength(0);
  });

  it('fails on a field name the schema does not declare', async () => {
    const { client } = setup();
    const { schema, context } = await indexerContext(client);
    const withoutSeeders = {
      ...schemaFor(schema, 'yts'),
      fields: schemaFor(schema, 'yts').fields.filter((entry) => entry.name !== MIN_SEEDERS_FIELD),
    };

    await expect(client.ensureIndexer(spec('yts'), withoutSeeders, context)).rejects.toBeInstanceOf(
      UnknownProviderFieldError,
    );
  });

  it('is rejected by the server when it receives a field it does not know', async () => {
    const { fake, client } = setup();
    const { schema, context } = await indexerContext(client);
    const item = schemaFor(schema, 'yts');
    const withUnknown = { ...item, fields: [...item.fields, { name: 'minimumSeeders', value: 1 }] };

    await expect(client.ensureIndexer(spec('yts'), withUnknown, context)).rejects.toMatchObject({
      status: 500,
    });
    expect(fake.state.indexers).toHaveLength(0);
  });
});

describe('forceApplicationSync', () => {
  it('posts the sync command and polls it until it completes', async () => {
    const { fake, client } = setup({ commandPolls: 2 });

    await client.forceApplicationSync({ sleep: noSleep });

    expect(fake.requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'ApplicationIndexerSync',
      forceSync: true,
    });
    expect(fake.count('GET', '/api/v1/command/1')).toBe(3);
  });

  it('fails with the command message when the sync fails', async () => {
    const { client } = setup({ commandOutcome: 'failed' });

    await expect(client.forceApplicationSync({ sleep: noSleep })).rejects.toThrow(
      'Prowlarr application sync failed: Application sync failed',
    );
  });

  it('gives up when the command never finishes', async () => {
    const { client } = setup({ commandPolls: 1000 });
    let elapsed = 0;

    await expect(
      client.forceApplicationSync({
        timeoutMs: 10_000,
        intervalMs: 2_000,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
        },
      }),
    ).rejects.toThrow('Condition not met');
  });
});

describe('refreshHealth', () => {
  it('posts the CheckHealth command and polls it until it completes', async () => {
    const { fake, client } = setup({ commandPolls: 1 });

    await client.refreshHealth({ sleep: noSleep });

    expect(fake.requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'CheckHealth',
    });
    expect(fake.count('GET', '/api/v1/command/1')).toBe(2);
  });

  it('names the health check when it fails', async () => {
    const { client } = setup({ commandOutcome: 'failed' });

    await expect(client.refreshHealth({ sleep: noSleep })).rejects.toThrow(
      'Prowlarr health check failed',
    );
  });
});

describe('readStatus', () => {
  it('summarizes applications, indexers, blocked indexers and non-ok health', async () => {
    const { client } = setup({
      blockedIndexers: ['yts'],
      health: [
        { source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable: YTS' },
        { source: 'Other', type: 'ok', message: 'fine' },
      ],
    });
    const { schema, context } = await indexerContext(client);
    await client.ensureApplication('sonarr', URLS.sonarr, 'sonarr-key');
    await client.ensureIndexer(spec('yts'), schemaFor(schema, 'yts'), context);
    await client.ensureIndexer(spec('eztv'), schemaFor(schema, 'eztv'), context);

    const status = await client.readStatus();

    expect(status.applications.map((application) => application.name)).toEqual(['Sonarr']);
    expect(status.indexerCount).toBe(2);
    expect(status.blocked).toEqual([
      { indexerId: 1, name: 'YTS', disabledTill: '2999-01-01T00:00:00Z' },
    ]);
    expect(status.health.map((entry) => entry.message)).toEqual(['Indexers unavailable: YTS']);
  });

  it('ignores a block that already expired', async () => {
    const { client } = setup(
      { blockedIndexers: ['yts'] },
      { now: () => Date.parse('3000-01-01T00:00:00Z') },
    );
    const { schema, context } = await indexerContext(client);
    await client.ensureIndexer(spec('yts'), schemaFor(schema, 'yts'), context);

    const status = await client.readStatus();

    expect(status.blocked).toEqual([]);
  });
});

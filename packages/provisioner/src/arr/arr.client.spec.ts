import { describe, expect, it } from 'vitest';

import { createFakeFetch } from '../testing/fake-fetch';
import { createArrClient, patchSingleton } from './arr.client';

const API_KEY = 'sonarr-key';

function setup() {
  const fake = createFakeFetch();
  const client = createArrClient({
    kind: 'sonarr',
    baseUrl: 'http://127.0.0.1:8989',
    apiKey: API_KEY,
    fetch: fake.fetch,
    sleep: async () => undefined,
  });
  return { fake, client };
}

const decypharrResource = {
  id: 3,
  name: 'Decypharr',
  fields: [],
} as never;

describe('createArrClient', () => {
  it('authenticates every request with the X-Api-Key header', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/system/status', { body: { appName: 'Sonarr' } });
    fake.on('GET', '/api/v3/health', { body: [] });
    fake.on('GET', '/api/v3/language', { body: [] });

    await client.getSystemStatus();
    await client.getHealth();
    await client.listLanguages();

    expect(fake.requests.map((request) => request.headers['x-api-key'])).toEqual([
      API_KEY,
      API_KEY,
      API_KEY,
    ]);
  });

  it('reads and writes config singletons by their id', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/config/naming', { body: { id: 1, renameEpisodes: false } });
    fake.on('PUT', '/api/v3/config/naming/1', { status: 202, body: {} });

    const naming = await client.getConfig('naming');
    await client.putConfig('naming', { ...naming, renameEpisodes: true });

    expect(fake.requests[1]).toMatchObject({
      method: 'PUT',
      path: '/api/v3/config/naming/1',
      body: { id: 1, renameEpisodes: true },
    });
  });

  it('lists and creates root folders', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/rootfolder', { body: [] });
    fake.on('POST', '/api/v3/rootfolder', { status: 201, body: { id: 1, path: '/data/media/tv' } });

    await client.listRootFolders();
    await client.createRootFolder('/data/media/tv');

    expect(fake.requests[1]?.body).toEqual({ path: '/data/media/tv' });
  });

  it('sends forceSave only when asked to', async () => {
    const { fake, client: arr } = setup();
    fake.on('POST', '/api/v3/downloadclient', { status: 201, body: {} });
    fake.on('PUT', '/api/v3/downloadclient/3', { status: 202, body: {} });

    await arr.createDownloadClient(decypharrResource);
    await arr.updateDownloadClient(decypharrResource);
    await arr.updateDownloadClient(decypharrResource, { forceSave: true });

    expect(fake.requests.map((request) => request.query)).toEqual([{}, {}, { forceSave: 'true' }]);
  });

  it('tests a download client with the resource as body', async () => {
    const { fake, client: arr } = setup();
    fake.on('POST', '/api/v3/downloadclient/test', { body: {} });

    await arr.testDownloadClient(decypharrResource);

    expect(fake.requests[0]?.body).toMatchObject({ name: 'Decypharr' });
  });
});

describe('patchSingleton', () => {
  it('puts the complete object when a desired key differs', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/config/indexer', {
      body: { id: 1, minimumAge: 0, rssSyncInterval: 15, unrelated: 'keep' },
    });
    fake.on('PUT', '/api/v3/config/indexer/1', { status: 202, body: {} });

    const changed = await patchSingleton(client, 'indexer', { minimumAge: 0, rssSyncInterval: 30 });

    expect(changed).toBe(true);
    expect(fake.requests[1]?.body).toEqual({
      id: 1,
      minimumAge: 0,
      rssSyncInterval: 30,
      unrelated: 'keep',
    });
  });

  it('does not write when every desired key already matches', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/config/indexer', { body: { id: 1, rssSyncInterval: 30, extra: true } });

    const changed = await patchSingleton(client, 'indexer', { rssSyncInterval: 30 });

    expect(changed).toBe(false);
    expect(fake.count('PUT')).toBe(0);
  });
});

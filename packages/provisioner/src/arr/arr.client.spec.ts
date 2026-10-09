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

  it('reads the custom format collection and its schema', async () => {
    const { fake, client: arr } = setup();
    fake.on('GET', '/api/v3/customformat', { body: [{ id: 1, name: 'Latino' }] });
    fake.on('GET', '/api/v3/customformat/schema', { body: [{ implementation: 'Source' }] });

    await expect(arr.listCustomFormats()).resolves.toEqual([{ id: 1, name: 'Latino' }]);
    await expect(arr.getCustomFormatSchema()).resolves.toEqual([{ implementation: 'Source' }]);
  });

  it('creates a custom format and updates it by id', async () => {
    const { fake, client: arr } = setup();
    fake.on('POST', '/api/v3/customformat', { status: 201, body: { id: 4 } });
    fake.on('PUT', '/api/v3/customformat/4', { status: 202, body: { id: 4 } });
    const format = { name: 'AV1', includeCustomFormatWhenRenaming: false, specifications: [] };

    await arr.createCustomFormat(format);
    await arr.updateCustomFormat({ ...format, id: 4 });

    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/v3/customformat',
      'PUT /api/v3/customformat/4',
    ]);
    expect(fake.requests[1]?.body).toMatchObject({ id: 4, name: 'AV1' });
  });

  it('reads, creates, updates and deletes quality profiles', async () => {
    const { fake, client: arr } = setup();
    fake.on('GET', '/api/v3/qualityprofile', { body: [] });
    fake.on('GET', '/api/v3/qualityprofile/schema', { body: { name: '' } });
    fake.on('POST', '/api/v3/qualityprofile', { status: 201, body: { id: 7 } });
    fake.on('PUT', '/api/v3/qualityprofile/7', { status: 202, body: { id: 7 } });
    fake.on('DELETE', '/api/v3/qualityprofile/7', { body: {} });
    const profile = { id: 7, name: 'Moody Blues' } as never;

    await arr.listQualityProfiles();
    await arr.getQualityProfileSchema();
    await arr.createQualityProfile(profile);
    await arr.updateQualityProfile(profile);
    await arr.deleteQualityProfile(7);

    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /api/v3/qualityprofile',
      'GET /api/v3/qualityprofile/schema',
      'POST /api/v3/qualityprofile',
      'PUT /api/v3/qualityprofile/7',
      'DELETE /api/v3/qualityprofile/7',
    ]);
  });

  it('reads, creates and updates release profiles by id', async () => {
    const { fake, client: arr } = setup();
    fake.on('GET', '/api/v3/releaseprofile', { body: [] });
    fake.on('POST', '/api/v3/releaseprofile', { status: 201, body: { id: 2 } });
    fake.on('PUT', '/api/v3/releaseprofile/2', { status: 202, body: { id: 2 } });
    const profile = {
      name: 'Moody Blues exclusions',
      enabled: true,
      required: [],
      ignored: ['/yts/i'],
      indexerId: 0,
      tags: [],
    };

    await arr.listReleaseProfiles();
    await arr.createReleaseProfile(profile);
    await arr.updateReleaseProfile({ ...profile, id: 2 });

    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /api/v3/releaseprofile',
      'POST /api/v3/releaseprofile',
      'PUT /api/v3/releaseprofile/2',
    ]);
    expect(fake.requests[2]?.body).toMatchObject({ id: 2, ignored: ['/yts/i'] });
  });

  it('reports a profile in use at once instead of retrying the deletion', async () => {
    const { fake, client: arr } = setup();
    fake.on('DELETE', '/api/v3/qualityprofile/3', {
      status: 500,
      body: { message: 'QualityProfile [3] is in use.' },
    });

    await expect(arr.deleteQualityProfile(3)).rejects.toMatchObject({ status: 500 });
    expect(fake.count('DELETE')).toBe(1);
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

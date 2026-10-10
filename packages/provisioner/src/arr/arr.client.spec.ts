import { describe, expect, it } from 'vitest';

import { createFakeFetch } from '../testing/fake-fetch';
import { createFakeServarr } from '../testing/fake-servarr';
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

describe('queue', () => {
  const record = (id: number) => ({
    id,
    title: `Release ${id}`,
    trackedDownloadState: 'importing',
  });

  it('reads every page of the queue with a page size of 200', async () => {
    const { fake, client } = setup();
    const first = Array.from({ length: 200 }, (_, index) => record(index + 1));
    fake.on(
      'GET',
      '/api/v3/queue',
      { body: { page: 1, pageSize: 200, totalRecords: 203, records: first } },
      { body: { page: 2, pageSize: 200, totalRecords: 203, records: [201, 202, 203].map(record) } },
    );

    const records = await client.listQueue();

    expect(records).toHaveLength(203);
    expect(fake.requests.map((request) => request.query)).toEqual([
      { page: '1', pageSize: '200' },
      { page: '2', pageSize: '200' },
    ]);
  });

  it('stops after the first page when it holds every record', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/queue', {
      body: { page: 1, pageSize: 200, totalRecords: 1, records: [record(7)] },
    });

    expect(await client.listQueue()).toEqual([record(7)]);
    expect(fake.count('GET', '/api/v3/queue')).toBe(1);
  });

  it('stops on an empty page even when the total claims more records', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/queue', {
      body: { page: 1, pageSize: 200, totalRecords: 5, records: [] },
    });

    expect(await client.listQueue()).toEqual([]);
    expect(fake.count('GET', '/api/v3/queue')).toBe(1);
  });

  it('removes an item with exactly the requested parameters', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/api/v3/queue/12', { status: 200, body: {} });

    await client.removeQueueItem(12, { removeFromClient: true, blocklist: true });

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/api/v3/queue/12',
      query: { removeFromClient: 'true', blocklist: 'true' },
    });
  });

  it('sends skipRedownload only when it is requested', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/api/v3/queue/3', { status: 200, body: {} });

    await client.removeQueueItem(3, { blocklist: true, skipRedownload: true });
    await client.removeQueueItem(3);

    expect(fake.requests.map((request) => request.query)).toEqual([
      { blocklist: 'true', skipRedownload: 'true' },
      {},
    ]);
  });

  it('does not retry a rejected removal', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/api/v3/queue/12', { status: 404, body: { message: 'NotFound' } });

    await expect(client.removeQueueItem(12, { blocklist: true })).rejects.toMatchObject({
      status: 404,
    });
    expect(fake.count('DELETE')).toBe(1);
  });

  it('does not retry a server error on the removal either', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/api/v3/queue/12', { status: 503 });

    await expect(client.removeQueueItem(12, { blocklist: true })).rejects.toMatchObject({
      status: 503,
    });
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

describe('title removal', () => {
  function setupRadarr() {
    const fake = createFakeFetch();
    const client = createArrClient({
      kind: 'radarr',
      baseUrl: 'http://127.0.0.1:7878',
      apiKey: 'radarr-key',
      fetch: fake.fetch,
      sleep: async () => undefined,
    });
    return { fake, client };
  }

  it('lists the library of its own kind', async () => {
    const sonarr = setup();
    const radarr = setupRadarr();
    sonarr.fake.on('GET', '/api/v3/series', { body: [{ id: 1, title: 'Show', tvdbId: 7 }] });
    radarr.fake.on('GET', '/api/v3/movie', { body: [{ id: 2, title: 'Movie', tmdbId: 9 }] });

    await expect(sonarr.client.listTitles()).resolves.toEqual([
      { id: 1, title: 'Show', tvdbId: 7 },
    ]);
    await expect(radarr.client.listTitles()).resolves.toEqual([
      { id: 2, title: 'Movie', tmdbId: 9 },
    ]);
  });

  it('reads the history of a series by seriesId and of a movie by movieId', async () => {
    const sonarr = setup();
    const radarr = setupRadarr();
    sonarr.fake.on('GET', '/api/v3/history/series', { body: [{ eventType: 'grabbed' }] });
    radarr.fake.on('GET', '/api/v3/history/movie', { body: [{ eventType: 'grabbed' }] });

    await sonarr.client.listHistory(4);
    await radarr.client.listHistory(5);

    expect(sonarr.fake.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/v3/history/series',
      query: { seriesId: '4' },
    });
    expect(radarr.fake.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/v3/history/movie',
      query: { movieId: '5' },
    });
  });

  it('reads every page of the history of a download id', async () => {
    const { fake, client } = setup();
    const page = (records: number[], totalRecords: number) => ({
      body: {
        page: 1,
        pageSize: 200,
        totalRecords,
        records: records.map((seriesId) => ({ eventType: 'grabbed', seriesId })),
      },
    });
    fake.on('GET', '/api/v3/history', page([1, 2], 3), page([3], 3));

    const records = await client.listHistoryByDownloadId('ABC');

    expect(records.map((record) => record.seriesId)).toEqual([1, 2, 3]);
    expect(fake.requests.map((request) => request.query)).toEqual([
      { downloadId: 'ABC', page: '1', pageSize: '200' },
      { downloadId: 'ABC', page: '2', pageSize: '200' },
    ]);
  });

  it('deletes a series with its files and without an exclusion', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/api/v3/series/4', { body: {} });

    await client.deleteTitle(4);

    expect(fake.requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/api/v3/series/4',
      query: { deleteFiles: 'true', addImportListExclusion: 'false' },
    });
  });

  it('deletes a movie with its files and without an exclusion', async () => {
    const { fake, client } = setupRadarr();
    fake.on('DELETE', '/api/v3/movie/5', { body: {} });

    await client.deleteTitle(5);

    expect(fake.requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/api/v3/movie/5',
      query: { deleteFiles: 'true', addImportExclusion: 'false' },
    });
  });

  it('does not retry a failed deletion and reports a missing title as an error', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/api/v3/series/4', { status: 500, body: { message: 'disk error' } });
    fake.on('DELETE', '/api/v3/series/5', { status: 404, body: { message: 'NotFound' } });

    await expect(client.deleteTitle(4)).rejects.toMatchObject({ status: 500 });
    await expect(client.deleteTitle(5)).rejects.toMatchObject({ status: 404 });
    expect(fake.count('DELETE')).toBe(2);
  });

  it('works against the in-memory double, which drops the history with the title', async () => {
    const double = createFakeServarr({
      kind: 'radarr',
      apiKey: 'radarr-key',
      titles: [{ id: 1, title: 'Movie' }],
      history: [{ eventType: 'grabbed', movieId: 1, downloadId: 'AA' }],
    });
    const client = createArrClient({
      kind: 'radarr',
      baseUrl: double.baseUrl,
      apiKey: 'radarr-key',
      fetch: double.fetch,
      sleep: async () => undefined,
    });

    await expect(client.listHistory(1)).resolves.toHaveLength(1);
    await client.deleteTitle(1);

    await expect(client.listTitles()).resolves.toEqual([]);
    await expect(client.listHistoryByDownloadId('AA')).resolves.toEqual([]);
    expect(double.titleDeletions()).toHaveLength(1);
  });
});

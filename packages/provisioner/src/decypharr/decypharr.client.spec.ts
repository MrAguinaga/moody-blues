import { describe, expect, it } from 'vitest';

import { HttpStatusError } from '../http/http.errors';
import { createFakeDecypharr, type FakeDecypharrOptions } from '../testing/fake-decypharr';
import { createFakeFetch } from '../testing/fake-fetch';
import {
  createDecypharrClient,
  DecypharrConfigInvalidError,
  parseArrs,
  parseConfigView,
  parseRepairEntries,
} from './decypharr.client';

const TOKEN = 'decypharr-secret-token';
const noSleep = async () => undefined;

function setup(options: Partial<FakeDecypharrOptions> = {}) {
  const server = createFakeDecypharr({ apiToken: TOKEN, ...options });
  const client = createDecypharrClient({
    baseUrl: server.baseUrl,
    apiToken: TOKEN,
    fetch: server.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return { server, client };
}

describe('createDecypharrClient probes', () => {
  it('reads both version probes without credentials', async () => {
    const { server, client } = setup();

    await expect(client.getVersion()).resolves.toEqual({ version: '2.7', channel: 'stable' });
    await expect(client.getQbitVersion()).resolves.toBe('v4.3.9');

    expect(server.requests.map((request) => request.headers.authorization)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('answers a PROPFIND on the WebDAV root with its status and no credentials', async () => {
    const { server, client } = setup();

    await expect(client.propfindWebdav()).resolves.toBe(207);

    expect(server.requests[0]).toMatchObject({ method: 'PROPFIND', path: '/webdav/' });
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('waits until the version probe answers', async () => {
    const { server, client } = setup({ pingFailures: 2 });

    await client.waitReady({ sleep: noSleep });

    expect(server.count('GET', '/version')).toBe(3);
  });

  it('fails the version probe when the body carries no version', async () => {
    const fake = createFakeFetch();
    fake.on('GET', '/version', { body: { channel: 'stable' } });
    const client = createDecypharrClient({
      baseUrl: 'http://127.0.0.1:8282',
      apiToken: TOKEN,
      fetch: fake.fetch,
    });

    await expect(client.getVersion()).rejects.toThrow('"version"');
  });
});

describe('createDecypharrClient authenticated calls', () => {
  it('sends the Bearer token on config, arrs and repair health', async () => {
    const { server, client } = setup();

    await client.getConfig();
    await client.listArrs();
    await client.listBrokenEntries();

    expect(server.requests.map((request) => request.headers.authorization)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
    expect(server.requests[2]).toMatchObject({
      path: '/api/repair/health',
      query: { status: 'broken' },
    });
  });

  it('maps the effective configuration to a view', async () => {
    const { client } = setup();

    await expect(client.getConfig()).resolves.toMatchObject({
      port: '8282',
      defaultDownloadAction: 'symlink',
      vfsCacheMode: 'writes',
      categories: ['sonarr', 'radarr'],
      arrNames: ['sonarr', 'radarr'],
      hearsayDisabled: true,
      skipPreCache: true,
    });
  });

  it('reads the registered arrs with their host, source and token', async () => {
    const { client } = setup();

    await expect(client.listArrs()).resolves.toEqual([
      { name: 'sonarr', host: 'http://sonarr:8989', token: 'sonarr-key', source: 'config' },
      { name: 'radarr', host: 'http://radarr:7878', token: 'radarr-key', source: 'config' },
    ]);
  });

  it('interprets the pending wizard 503 as an invalid configuration, not a slow start', async () => {
    const { server, client } = setup({ wizardPending: true });

    const failure = await client.listArrs().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DecypharrConfigInvalidError);
    expect((failure as Error).message).toContain('config/decypharr/config.json');
    expect(server.count('GET', '/api/arrs')).toBe(1);
  });

  it('still reads the configuration while the wizard is pending', async () => {
    const { client } = setup({ wizardPending: true });

    await expect(client.getConfig()).resolves.toMatchObject({ port: '8282' });
  });

  it('keeps an unrelated 503 as a status error', async () => {
    const fake = createFakeFetch();
    fake.on('GET', '/api/arrs', { status: 503, text: 'busy' });
    const client = createDecypharrClient({
      baseUrl: 'http://127.0.0.1:8282',
      apiToken: TOKEN,
      fetch: fake.fetch,
      sleep: noSleep,
      retry: { attempts: 1 },
    });

    await expect(client.listArrs()).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('never puts the token in an error message, even when the server echoes it', async () => {
    const fake = createFakeFetch();
    fake.on('GET', '/api/config', { status: 401, text: `bad token ${TOKEN}` });
    const client = createDecypharrClient({
      baseUrl: 'http://127.0.0.1:8282',
      apiToken: TOKEN,
      fetch: fake.fetch,
      sleep: noSleep,
    });

    const failure = await client.getConfig().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('401');
    expect((failure as Error).message).not.toContain(TOKEN);
  });

  it('reports the status of a rejected WebDAV probe as a status error', async () => {
    const { server, client } = setup({ webdavStatus: 401 });

    await expect(client.propfindWebdav()).rejects.toMatchObject({ status: 401 });
    expect(server.count('PROPFIND')).toBe(1);
  });
});

describe('response parsing', () => {
  it('treats absent configuration keys as their defaults', () => {
    expect(parseConfigView({})).toEqual({
      port: undefined,
      useAuth: false,
      enableWebdavAuth: false,
      downloadFolder: undefined,
      defaultDownloadAction: undefined,
      categories: [],
      arrNames: [],
      downloadUncached: false,
      rateLimit: undefined,
      mountType: undefined,
      mountPath: undefined,
      vfsCacheMode: undefined,
      vfsCacheMaxSize: undefined,
      vfsCacheMaxAge: undefined,
      repairEnabled: false,
      repairSchedule: undefined,
      repairAutoRepair: false,
      queueCleanupRules: [],
      hearsayDisabled: false,
      skipPreCache: false,
    });
  });

  it('accepts the arrs and repair entries wrapped in an object', () => {
    expect(parseArrs({ arrs: [{ name: 'sonarr', host: 'h', token: 't' }] })).toEqual([
      { name: 'sonarr', host: 'h', token: 't', source: undefined },
    ]);
    expect(parseRepairEntries({ entries: [{ name: 'a', status: 'broken' }, 'noise'] })).toEqual([
      { name: 'a', status: 'broken' },
    ]);
    expect(parseRepairEntries(null)).toEqual([]);
  });
});

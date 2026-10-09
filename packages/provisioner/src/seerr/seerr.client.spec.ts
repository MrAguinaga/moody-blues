import { describe, expect, it } from 'vitest';

import { HttpStatusError } from '../http/http.errors';
import { createFakeFetch, type FakeFetch } from '../testing/fake-fetch';
import { createFakeSeerr, FAKE_SEERR_API_KEY, type FakeSeerrOptions } from '../testing/fake-seerr';
import { createSeerrClient } from './seerr.client';
import { buildArrInstance } from './seerr.settings';

const noSleep = async () => undefined;
const KEY = 'seerr-test-key';
const ADMIN = { username: 'Admin', password: 'p@ss word' };

function setupFake(options: FakeSeerrOptions = {}) {
  const fake = createFakeSeerr({
    accounts: [{ ...ADMIN, isAdministrator: true }],
    ...options,
  });
  const client = createSeerrClient({
    baseUrl: fake.baseUrl,
    apiKey: FAKE_SEERR_API_KEY,
    fetch: fake.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return { fake, client };
}

function setupRoutes(): { routes: FakeFetch; client: ReturnType<typeof createSeerrClient> } {
  const routes = createFakeFetch();
  const client = createSeerrClient({
    baseUrl: 'http://127.0.0.1:5055',
    apiKey: KEY,
    fetch: routes.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return { routes, client };
}

describe('createSeerrClient', () => {
  it('sends the API key on every authenticated call', async () => {
    const { routes, client } = setupRoutes();
    routes.on('GET', '/api/v1/auth/me', { body: { id: 1, permissions: 2 } });
    routes.on('GET', '/api/v1/settings/main', { body: {} });
    routes.on('GET', '/api/v1/settings/jellyfin', { body: {} });
    routes.on('GET', '/api/v1/settings/sonarr', { body: [] });

    await client.whoAmI();
    await client.getMainSettings();
    await client.getJellyfinSettings();
    await client.listArrInstances('sonarr');

    for (const request of routes.requests) {
      expect(request.headers['x-api-key']).toBe(KEY);
    }
  });

  it('keeps the API key out of the anonymous calls', async () => {
    const { routes, client } = setupRoutes();
    routes.on('GET', '/api/v1/settings/public', { body: { initialized: false } });
    routes.on('POST', '/api/v1/auth/jellyfin', { body: { id: 1, permissions: 2 } });

    await client.getPublicSettings();
    await client.loginWithJellyfin({ ...ADMIN, hostname: 'jellyfin', port: 8096 });

    for (const request of routes.requests) {
      expect(request.headers).not.toHaveProperty('x-api-key');
    }
  });

  it('signs in with the exact documented body', async () => {
    const { routes, client } = setupRoutes();
    routes.on('POST', '/api/v1/auth/jellyfin', { body: { id: 1, permissions: 2 } });

    const user = await client.loginWithJellyfin({ ...ADMIN, hostname: 'jellyfin', port: 8096 });

    expect(user).toEqual({ id: 1, permissions: 2 });
    expect(routes.requests[0]?.body).toEqual({
      username: 'Admin',
      password: 'p@ss word',
      hostname: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      serverType: 2,
    });
    expect(routes.requests[0]?.body).not.toHaveProperty('email');
  });

  it('does not forward the session cookie of the sign-in', async () => {
    const { fake, client } = setupFake();

    await client.loginWithJellyfin({ ...ADMIN, hostname: 'jellyfin', port: 8096 });
    await client.whoAmI();

    for (const request of fake.requests) {
      expect(request.headers).not.toHaveProperty('cookie');
    }
  });

  it('enables a library with a PUT on its encoded id', async () => {
    const { routes, client } = setupRoutes();
    routes.on('PUT', '/api/v1/settings/jellyfin/library/a%2Fb', { status: 200, body: {} });

    await client.enableLibrary('a/b');

    expect(routes.requests[0]?.method).toBe('PUT');
    expect(routes.requests[0]?.body).toEqual({ enabled: true });
  });

  it('starts the scan and the library sync with the documented bodies', async () => {
    const { routes, client } = setupRoutes();
    routes.on('POST', '/api/v1/settings/jellyfin/sync', { body: { running: true } });
    routes.on('POST', '/api/v1/settings/jellyfin/library/sync', {
      body: [{ id: 'a', name: 'Películas', enabled: false, type: 'movie' }],
    });

    await client.startLibraryScan();
    const libraries = await client.syncLibraries();

    expect(routes.requests[0]?.body).toEqual({ start: true });
    expect(libraries).toEqual([{ id: 'a', name: 'Películas', enabled: false, type: 'movie' }]);
  });

  it('saves partial main settings and Jellyfin connection updates as given', async () => {
    const { routes, client } = setupRoutes();
    routes.on('POST', '/api/v1/settings/main', { body: {} });
    routes.on('POST', '/api/v1/settings/jellyfin', { body: {} });

    await client.saveMainSettings({ cacheImages: false });
    await client.saveJellyfinSettings({
      ip: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      apiKey: 'k',
      externalHostname: 'https://watch.example.org',
    });

    expect(routes.requests[0]?.body).toEqual({ cacheImages: false });
    expect(routes.requests[1]?.body).toEqual({
      ip: 'jellyfin',
      port: 8096,
      useSsl: false,
      urlBase: '',
      apiKey: 'k',
      externalHostname: 'https://watch.example.org',
    });
  });

  it('creates, tests and updates arr instances on the per-app paths', async () => {
    const { routes, client } = setupRoutes();
    routes.on('POST', '/api/v1/settings/radarr/test', { body: {} });
    routes.on('POST', '/api/v1/settings/radarr', { status: 201, body: { id: 0 } });
    routes.on('PUT', '/api/v1/settings/radarr/0', { body: { id: 0 } });
    const instance = buildArrInstance('radarr', {
      apiKey: 'radarr-key',
      profile: { id: 7, name: 'Moody Blues' },
      directory: '/data/media/movies',
    });

    await client.testArr('radarr', {
      hostname: 'radarr',
      port: 7878,
      apiKey: 'radarr-key',
      useSsl: false,
      baseUrl: '',
    });
    await client.createArrInstance('radarr', instance);
    await client.updateArrInstance('radarr', 0, instance);

    expect(routes.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/v1/settings/radarr/test',
      'POST /api/v1/settings/radarr',
      'PUT /api/v1/settings/radarr/0',
    ]);
  });

  it('waits on the public settings route', async () => {
    const { fake, client } = setupFake({ readyAfterFailures: 1 });

    await client.waitReady({ sleep: noSleep });

    expect(fake.requests.map((request) => request.path)).toEqual([
      '/api/v1/settings/public',
      '/api/v1/settings/public',
    ]);
  });

  it('rejects an unauthenticated call with 403 until the first sign-in creates the user', async () => {
    const { client } = setupFake();

    await expect(client.whoAmI()).rejects.toMatchObject({ status: 403 });
    await client.loginWithJellyfin({ ...ADMIN, hostname: 'jellyfin', port: 8096 });
    await expect(client.whoAmI()).resolves.toMatchObject({ id: 1 });
  });

  it('never puts the API key, password or cookie in an error message', async () => {
    const { routes, client } = setupRoutes();
    routes.on('GET', '/api/v1/settings/main', { status: 500, text: 'boom' });
    routes.on('POST', '/api/v1/auth/jellyfin', {
      status: 401,
      body: { message: 'INVALID_CREDENTIALS' },
    });

    const failures = await Promise.all([
      client.getMainSettings().catch((error: unknown) => error),
      client
        .loginWithJellyfin({ ...ADMIN, hostname: 'jellyfin', port: 8096 })
        .catch((error: unknown) => error),
    ]);

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(HttpStatusError);
      const message = (failure as Error).message;
      expect(message).not.toContain(KEY);
      expect(message).not.toContain(ADMIN.password);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { createHttpClient } from '../http/http.client';
import { createFakeFetch } from '../testing/fake-fetch';
import {
  buildHostSettings,
  ensureServarrAdminUser,
  type ServarrAdminCredentials,
  type ServarrApiPrefix,
  type ServarrHostResource,
} from './servarr-host';

const PREFIXES: readonly ServarrApiPrefix[] = ['/api/v3', '/api/v1'];
const credentials: ServarrAdminCredentials = {
  username: 'Admin',
  password: 'p@ss word',
  rotate: false,
};

function hostResource(overrides: Partial<ServarrHostResource> = {}): ServarrHostResource {
  return {
    id: 1,
    bindAddress: '*',
    port: 9696,
    allowedHosts: '',
    logSizeLimit: 1,
    authenticationMethod: 'forms',
    authenticationRequired: 'enabled',
    analyticsEnabled: false,
    logLevel: 'info',
    username: 'admin',
    password: 'stored-hash',
    passwordConfirmation: '',
    ...overrides,
  };
}

function setup(prefix: ServarrApiPrefix, host: ServarrHostResource) {
  const fake = createFakeFetch();
  fake.on('GET', `${prefix}/config/host`, { body: host });
  fake.on('PUT', `${prefix}/config/host/${host.id}`, { status: 202, body: host.id });
  const http = createHttpClient({
    baseUrl: 'http://127.0.0.1:9696',
    fetch: fake.fetch,
    sleep: async () => undefined,
  });
  return { fake, http };
}

describe('buildHostSettings', () => {
  it('requires forms authentication and disables analytics', () => {
    expect(buildHostSettings()).toEqual({
      authenticationMethod: 'forms',
      authenticationRequired: 'enabled',
      analyticsEnabled: false,
      logLevel: 'info',
    });
  });
});

describe.each(PREFIXES)('ensureServarrAdminUser (%s)', (prefix) => {
  it('does not write when the stored user and settings already match', async () => {
    const { fake, http } = setup(prefix, hostResource());

    const changed = await ensureServarrAdminUser(http, prefix, credentials);

    expect(changed).toBe(false);
    expect(fake.count('PUT')).toBe(0);
  });

  it('writes the complete host object with the credentials when the user is missing', async () => {
    const { fake, http } = setup(
      prefix,
      hostResource({ username: '', authenticationMethod: 'none' }),
    );

    const changed = await ensureServarrAdminUser(http, prefix, credentials);

    expect(changed).toBe(true);
    expect(fake.requests.find((request) => request.method === 'PUT')).toMatchObject({
      path: `${prefix}/config/host/1`,
      body: {
        bindAddress: '*',
        port: 9696,
        allowedHosts: '',
        authenticationMethod: 'forms',
        authenticationRequired: 'enabled',
        username: 'Admin',
        password: 'p@ss word',
        passwordConfirmation: 'p@ss word',
      },
    });
  });

  it('forces the write on rotation even when the user matches', async () => {
    const { fake, http } = setup(prefix, hostResource());

    const changed = await ensureServarrAdminUser(http, prefix, { ...credentials, rotate: true });

    expect(changed).toBe(true);
    expect(fake.count('PUT', `${prefix}/config/host/1`)).toBe(1);
  });

  it('resends the stored password hash untouched when only the settings drifted', async () => {
    const { fake, http } = setup(
      prefix,
      hostResource({ analyticsEnabled: true, logLevel: 'debug' }),
    );

    const changed = await ensureServarrAdminUser(http, prefix, credentials);

    expect(changed).toBe(true);
    expect(fake.requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
      username: 'admin',
      password: 'stored-hash',
      passwordConfirmation: '',
      analyticsEnabled: false,
      logLevel: 'info',
    });
  });

  it('rewrites the credentials when the configured username changes', async () => {
    const { fake, http } = setup(prefix, hostResource());

    const changed = await ensureServarrAdminUser(http, prefix, {
      ...credentials,
      username: 'owner',
    });

    expect(changed).toBe(true);
    expect(fake.requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
      username: 'owner',
      password: 'p@ss word',
    });
  });
});

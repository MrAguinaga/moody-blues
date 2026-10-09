import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout } from '../home';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { readEnv } from '../state';
import { createFakeJellyfin, type FakeJellyfinOptions } from '../testing/fake-jellyfin';
import { ensureJellyfinAccess } from './jellyfin.access';
import { createJellyfinClient } from './jellyfin.client';

const identity = { puid: 1000, pgid: 1000 };
const secrets = { rdApiToken: 'rd-token', adminUsername: 'Admin', adminPassword: 'p@ss word' };
const noSleep = async () => undefined;

describe('ensureJellyfinAccess', () => {
  let sandbox: string;
  let ctx: ProvisionContext;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-jellyfin-access-'));
    ctx = {
      config: createDefaultConfig({ host: identity }),
      secrets,
      layout: createLayout(sandbox),
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
    };
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function setup(options: FakeJellyfinOptions = {}) {
    const fake = createFakeJellyfin({ wizardCompleted: true, ...options });
    const client = createJellyfinClient({
      baseUrl: fake.baseUrl,
      fetch: fake.fetch,
      sleep: noSleep,
      random: () => 0.5,
    });
    return { fake, client };
  }

  const storedKey = () => readEnv(ctx.layout.envFile).JELLYFIN_API_KEY;

  it('creates the moody-blues key, mirrors it in the environment file and closes the session', async () => {
    const { fake, client } = setup();

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access).toEqual({
      apiKey: 'fake-api-key-2',
      created: true,
      persisted: true,
      warnings: [],
    });
    expect(storedKey()).toBe(access.apiKey);
    expect(statSync(ctx.layout.envFile).mode & 0o777).toBe(0o600);
    expect(fake.state.apiKeys.map((key) => key.AppName)).toEqual(['moody-blues']);
    expect(fake.state.sessions.size).toBe(0);
    expect(fake.count('POST', '/Sessions/Logout')).toBe(1);
  });

  it('leaves the client authenticated with the key', async () => {
    const { fake, client } = setup();
    const { apiKey } = await ensureJellyfinAccess(ctx, client);

    await client.listLibraries();

    expect(fake.requests.at(-1)?.headers.authorization).toContain(`Token="${apiKey}"`);
  });

  it('reads the key back when the server answers the creation with a JSON body', async () => {
    const { client } = setup({ apiKeyReply: 'json' });

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access.created).toBe(true);
    expect(storedKey()).toBe(access.apiKey);
  });

  it('uses a valid stored key with a single read and no writes', async () => {
    const { fake, client } = setup({ apiKeys: ['stored-key'] });
    writeFileSync(ctx.layout.envFile, 'JELLYFIN_API_KEY=stored-key\n');
    const before = readFileSync(ctx.layout.envFile, 'utf8');

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access).toEqual({
      apiKey: 'stored-key',
      created: false,
      persisted: false,
      warnings: [],
    });
    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /Auth/Keys',
    ]);
    expect(readFileSync(ctx.layout.envFile, 'utf8')).toBe(before);
  });

  it('reuses an existing moody-blues key found by signing in and only mirrors it', async () => {
    const { fake, client } = setup({ apiKeys: ['existing-key'] });

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access).toMatchObject({ apiKey: 'existing-key', created: false, persisted: true });
    expect(fake.count('POST', '/Auth/Keys')).toBe(0);
    expect(storedKey()).toBe('existing-key');
  });

  it('skips revoked keys and keys of other applications', async () => {
    const { fake, client } = setup();
    fake.state.apiKeys.push(
      { AccessToken: 'seerr-key', AppName: 'Seerr' },
      { AccessToken: 'revoked-key', AppName: 'moody-blues', DateRevoked: '2026-01-01T00:00:00Z' },
    );

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access.created).toBe(true);
    expect(access.apiKey).not.toBe('revoked-key');
    expect(access.apiKey).not.toBe('seerr-key');
  });

  it('regenerates a stale key after the database was reset', async () => {
    const { fake, client } = setup();
    writeFileSync(ctx.layout.envFile, 'JELLYFIN_API_KEY=stale-key\nRD_API_TOKEN=rd-token\n');

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access).toMatchObject({ created: true, persisted: true });
    expect(storedKey()).toBe(access.apiKey);
    expect(storedKey()).not.toBe('stale-key');
    expect(readEnv(ctx.layout.envFile).RD_API_TOKEN).toBe('rd-token');
    expect(fake.count('GET', '/Auth/Keys')).toBe(3);
  });

  it('does not rewrite the environment file when the key already matches', async () => {
    const { client } = setup({ apiKeys: ['existing-key'] });
    writeFileSync(ctx.layout.envFile, 'JELLYFIN_API_KEY=existing-key\n');

    const first = await ensureJellyfinAccess(ctx, client);

    expect(first.persisted).toBe(false);
  });

  it('aborts with the reset hint when the credentials are rejected', async () => {
    const { fake, client } = setup({ adminPassword: 'another password' });

    const failure = ensureJellyfinAccess(ctx, client);

    await expect(failure).rejects.toThrow(/rejected the administrator credentials.*reset --fresh/);
    expect(fake.count('POST', '/Users/AuthenticateByName')).toBe(1);
  });

  it('turns a failed logout into a warning without leaking the key', async () => {
    const { client } = setup({ failLogout: true });

    const access = await ensureJellyfinAccess(ctx, client);

    expect(access.warnings).toHaveLength(1);
    expect(access.warnings[0]).toMatch(/session could not be closed/);
    expect(access.warnings[0]).not.toContain(access.apiKey);
  });

  it('propagates server failures other than a rejected key', async () => {
    const { fake } = setup({ apiKeys: ['stored-key'] });
    writeFileSync(ctx.layout.envFile, 'JELLYFIN_API_KEY=stored-key\n');
    const original = fake.fetch;
    const failing = createJellyfinClient({
      baseUrl: fake.baseUrl,
      fetch: async (input, init) =>
        input.includes('/Auth/Keys')
          ? new Response('boom', { status: 500 })
          : original(input, init),
      sleep: noSleep,
      retry: { attempts: 1 },
    });

    await expect(ensureJellyfinAccess(ctx, failing)).rejects.toMatchObject({ status: 500 });
  });
});

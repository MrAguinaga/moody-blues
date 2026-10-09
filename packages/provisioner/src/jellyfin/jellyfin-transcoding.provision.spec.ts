import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig, type HardwareAccelKind, type TranscodingMode } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import {
  createFakeJellyfin,
  type FakeJellyfin,
  type FakeJellyfinOptions,
} from '../testing/fake-jellyfin';
import { createJellyfinClient } from './jellyfin.client';
import { ENCODING_SAFEGUARDS } from './jellyfin.constants';
import { provisionJellyfin } from './jellyfin.provision';
import { provisionTranscoding } from './jellyfin-transcoding.provision';
import { HardwareAccelerationMissingError } from './jellyfin-transcoding.settings';
import { createJellyfinTranscodingStep } from './jellyfin-transcoding.step';

const identity = { puid: 1000, pgid: 1000 };
const ADMIN = { username: 'Admin', password: 'p@ss word' };
const noSleep = async () => undefined;
const MODES: readonly TranscodingMode[] = ['off', 'cpu', 'hardware'];
const READ_ONLY_ROUTES = [
  'GET /System/Info/Public',
  'GET /Auth/Keys',
  'GET /System/Configuration/encoding',
  'GET /Users',
];
const PLAYBACK_KEYS = [
  'EnableVideoPlaybackTranscoding',
  'EnableAudioPlaybackTranscoding',
  'EnablePlaybackRemuxing',
] as const;

describe('provisionTranscoding', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-jellyfin-transcoding-'));
    layout = createLayout(sandbox);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function createContext(
    mode: TranscodingMode = 'off',
    hardware?: HardwareAccelKind,
  ): ProvisionContext {
    return {
      config: {
        ...createDefaultConfig({ host: identity, domain: 'example.org' }),
        transcoding: mode,
      },
      secrets: {
        rdApiToken: 'rd-token',
        adminUsername: ADMIN.username,
        adminPassword: ADMIN.password,
      },
      layout,
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
      ...(hardware ? { hardware } : {}),
    };
  }

  function setup(options: FakeJellyfinOptions = {}) {
    writeFileSync(layout.envFile, 'JELLYFIN_API_KEY=issued-key\n');
    return createFakeJellyfin({
      localAddress: 'https://watch.example.org',
      wizardCompleted: true,
      apiKeys: ['issued-key'],
      ...options,
    });
  }

  function clientFor(server: FakeJellyfin) {
    return createJellyfinClient({
      baseUrl: server.baseUrl,
      fetch: server.fetch,
      sleep: noSleep,
      random: () => 0.5,
    });
  }

  const options = (server: FakeJellyfin) => ({
    client: clientFor(server),
    signal: new AbortController().signal,
    ready: { sleep: noSleep },
  });

  const transcode = (server: FakeJellyfin, ctx = createContext()) =>
    provisionTranscoding(ctx, options(server));
  const provision = (server: FakeJellyfin, ctx = createContext()) =>
    provisionJellyfin(ctx, options(server));

  const routes = (server: FakeJellyfin, from = 0) =>
    server.requests.slice(from).map((request) => `${request.method} ${request.path}`);
  const policyOf = (server: FakeJellyfin, name: string) =>
    server.state.users.find((user) => user.name === name)?.policy;
  const safeguards = (server: FakeJellyfin) =>
    Object.fromEntries(
      Object.keys(ENCODING_SAFEGUARDS).map((key) => [key, server.state.encoding[key]]),
    );

  it('applies the off mode to the encoding options and to every user, administrator included', async () => {
    const server = setup({ extraUsers: [{ name: 'Friend' }] });

    const outcome = await transcode(server);

    expect(outcome).toEqual({
      status: 'changed',
      detail: 'playback policy of 2 of 2 users',
    });
    for (const name of ['Admin', 'Friend']) {
      expect(policyOf(server, name)).toMatchObject({
        EnableVideoPlaybackTranscoding: false,
        EnableAudioPlaybackTranscoding: true,
        EnablePlaybackRemuxing: true,
      });
    }
    expect(server.state.encoding.HardwareAccelerationType).toBe('none');
  });

  it('creates the API key when none was issued yet and says so', async () => {
    const server = setup({ apiKeys: [] });

    const outcome = await transcode(server);

    expect(outcome.detail).toBe(
      'created the API key, stored the API key in the environment file, playback policy of 1 of 1 users',
    );
    expect(server.state.apiKeys).toHaveLength(1);
  });

  it('is idempotent: the second run reads everything and writes nothing', async () => {
    const server = setup({ extraUsers: [{ name: 'Friend' }] });
    await transcode(server);
    const seen = server.requests.length;

    const outcome = await transcode(server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.requests.slice(seen).filter((request) => request.method !== 'GET')).toEqual([]);
    expect(new Set(routes(server, seen))).toEqual(new Set(READ_ONLY_ROUTES));
  });

  it('reports the encoding keys that drifted', async () => {
    const server = setup({ encoding: { HardwareAccelerationType: 'vaapi' } });

    const outcome = await transcode(server);

    expect(outcome.detail).toBe(
      'encoding options HardwareAccelerationType, playback policy of 1 of 1 users',
    );
    expect(server.state.encoding.HardwareAccelerationType).toBe('none');
  });

  it.each([
    ['off', [false, true, true]],
    ['cpu', [true, true, true]],
    ['hardware', [true, true, true]],
  ] as const)('sets the playback policy of %s mode', async (mode, expected) => {
    const server = setup();

    await transcode(server, createContext(mode, 'vaapi'));

    expect(PLAYBACK_KEYS.map((key) => policyOf(server, 'Admin')?.[key])).toEqual(expected);
  });

  it('forwards the rest of the policy and both provider ids exactly as they were read', async () => {
    const server = setup({
      extraUsers: [
        {
          name: 'Friend',
          policy: {
            AuthenticationProviderId: 'Custom.AuthProvider',
            PasswordResetProviderId: 'Custom.ResetProvider',
            EnableMediaPlayback: false,
            MaxActiveSessions: 3,
            BlockedTags: ['kids'],
            ForceRemoteSourceTranscoding: true,
          },
        },
      ],
    });
    const before = structuredClone(policyOf(server, 'Friend'));

    await transcode(server);

    expect(policyOf(server, 'Friend')).toEqual({
      ...before,
      EnableVideoPlaybackTranscoding: false,
    });
    expect(policyOf(server, 'Friend')).toMatchObject({
      AuthenticationProviderId: 'Custom.AuthProvider',
      PasswordResetProviderId: 'Custom.ResetProvider',
    });
  });

  it('writes only the users whose policy drifted', async () => {
    const server = setup({
      extraUsers: [
        { name: 'Done', policy: { EnableVideoPlaybackTranscoding: false } },
        { name: 'Pending' },
      ],
    });
    await transcode(server);
    server.state.users[2]!.policy.EnableVideoPlaybackTranscoding = true;
    const seen = server.requests.length;

    const outcome = await transcode(server);

    expect(outcome.detail).toBe('playback policy of 1 of 3 users');
    const writes = server.requests.slice(seen).filter((request) => request.method !== 'GET');
    expect(writes.map((request) => request.path)).toEqual([
      `/Users/${server.state.users[2]?.id}/Policy`,
    ]);
  });

  it('corrects only the expected keys when moving from off to cpu and back', async () => {
    const server = setup();
    await transcode(server, createContext('off'));
    const afterOff = structuredClone(server.state);

    const toCpu = await transcode(server, createContext('cpu'));
    const afterCpu = structuredClone(server.state);
    const backToOff = await transcode(server, createContext('off'));

    expect(toCpu.detail).toBe('playback policy of 1 of 1 users');
    expect(afterCpu.encoding).toEqual(afterOff.encoding);
    expect(afterCpu.users[0]?.policy).toEqual({
      ...afterOff.users[0]?.policy,
      EnableVideoPlaybackTranscoding: true,
    });
    expect(backToOff.detail).toBe('playback policy of 1 of 1 users');
    expect(server.state.users[0]?.policy).toEqual(afterOff.users[0]?.policy);
    expect((await transcode(server, createContext('off'))).status).toBe('unchanged');
  });

  it('maps VAAPI and NVIDIA to their encoding options and returns to none', async () => {
    const server = setup();

    const vaapi = await transcode(server, createContext('hardware', 'vaapi'));
    expect(server.state.encoding).toMatchObject({
      HardwareAccelerationType: 'vaapi',
      VaapiDevice: '/dev/dri/renderD128',
      EnableHardwareEncoding: true,
    });
    expect(vaapi.detail).toContain('accelerator vaapi');

    await transcode(server, createContext('hardware', 'nvidia'));
    expect(server.state.encoding.HardwareAccelerationType).toBe('nvenc');

    await transcode(server, createContext('cpu'));
    expect(server.state.encoding).toMatchObject({
      HardwareAccelerationType: 'none',
      EnableHardwareEncoding: true,
    });
    expect((await transcode(server, createContext('cpu'))).status).toBe('unchanged');
  });

  it('fails before sending anything when hardware mode has no accelerator', async () => {
    const server = setup();

    await expect(transcode(server, createContext('hardware'))).rejects.toThrow(
      HardwareAccelerationMissingError,
    );
    expect(server.requests).toEqual([]);
  });

  it('aborts when Jellyfin rejects a policy', async () => {
    const server = setup({
      extraUsers: [{ name: 'Broken', policy: { AuthenticationProviderId: '' } }],
    });

    await expect(transcode(server)).rejects.toMatchObject({ status: 400 });
  });

  it('aborts when Jellyfin lists a user without a policy', async () => {
    const server = setup();
    const client = clientFor(server);
    client.listUsers = async () => [{ Id: 'u1', Name: 'Ghost' }];

    await expect(
      provisionTranscoding(createContext(), {
        client,
        signal: new AbortController().signal,
        ready: { sleep: noSleep },
      }),
    ).rejects.toThrow('Jellyfin returned no policy for the user "Ghost"');
  });

  it('reports progress without secrets and keeps the API key out of the detail', async () => {
    const server = setup({ extraUsers: [{ name: 'Friend' }] });
    const messages: string[] = [];
    const ctx = {
      ...createContext('hardware', 'vaapi'),
      reportProgress: (m: string) => messages.push(m),
    };

    const outcome = await transcode(server, ctx);

    const keys = server.state.apiKeys.map((key) => key.AccessToken);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(outcome.detail).not.toContain(key);
      expect(messages.join(' ')).not.toContain(key);
    }
    expect(outcome.detail).not.toContain(ADMIN.password);
    expect(messages.length).toBeGreaterThan(0);
  });

  describe('coexistence with jellyfin-provision', () => {
    const orders = [
      ['provision first', [provision, transcode]],
      ['transcoding first', [transcode, provision]],
    ] as const;

    it.each(MODES.flatMap((mode) => orders.map(([label, steps]) => [mode, label, steps] as const)))(
      'leaves both steps unchanged on the next round in %s mode, %s',
      async (mode, _label, steps) => {
        const server = setup();
        const ctx = createContext(mode, 'vaapi');
        for (const step of steps) {
          await step(server, ctx);
        }
        const expectedSafeguards = { ...ENCODING_SAFEGUARDS };
        const afterFirstRound = structuredClone(server.state.encoding);

        for (const step of steps) {
          const seen = server.requests.length;
          const outcome = await step(server, ctx);

          expect(outcome.status).toBe('unchanged');
          expect(server.requests.slice(seen).filter((request) => request.method !== 'GET')).toEqual(
            [],
          );
        }
        expect(safeguards(server)).toEqual(expectedSafeguards);
        expect(server.state.encoding).toEqual(afterFirstRound);
      },
    );

    it('keeps the safeguards while the mode changes between runs', async () => {
      const server = setup();
      await provision(server);

      for (const mode of ['cpu', 'hardware', 'off'] as const) {
        const ctx = createContext(mode, 'vaapi');
        await transcode(server, ctx);
        await provision(server, ctx);
        expect(safeguards(server)).toEqual({ ...ENCODING_SAFEGUARDS });
      }
    });
  });
});

describe('createJellyfinTranscodingStep', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-jellyfin-transcoding-step-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('runs the real step against the host port of the catalog', async () => {
    const layout = createLayout(sandbox);
    writeFileSync(layout.envFile, 'JELLYFIN_API_KEY=issued-key\n');
    const server = createFakeJellyfin({ wizardCompleted: true, apiKeys: ['issued-key'] });
    const step = createJellyfinTranscodingStep({
      fetch: server.fetch,
      sleep: noSleep,
      random: () => 0.5,
      ready: { sleep: noSleep },
    });
    const ctx: ProvisionContext = {
      config: createDefaultConfig({ host: identity, domain: 'example.org' }),
      secrets: { rdApiToken: 'rd', adminUsername: ADMIN.username, adminPassword: ADMIN.password },
      layout,
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
    };

    const first = await step.run(ctx, new AbortController().signal);
    const writesAfterFirst = server.writes().length;
    const second = await step.run(ctx, new AbortController().signal);

    expect(step.id).toBe('jellyfin-transcoding');
    expect(step.scopes).toEqual(['setup', 'reset', 'config', 'update']);
    expect(first.status).toBe('changed');
    expect(second).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(writesAfterFirst);
    expect(new URL(server.requests[0]?.url ?? '').origin).toBe('http://127.0.0.1:8096');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createArrClient } from '../arr/arr.client';
import { provisionArr } from '../arr/arr.provision';
import { ARR_KINDS, type ArrKind } from '../arr/arr.types';
import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import { runPipeline } from '../pipeline/pipeline.runner';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { createFakeDecypharr, type FakeDecypharrOptions } from '../testing/fake-decypharr';
import { createFakeServarr, type FakeServarr } from '../testing/fake-servarr';
import { createDecypharrClient } from './decypharr.client';
import {
  DecypharrDriftError,
  type MountWaitOptions,
  verifyDecypharr,
  type VerifyDecypharrOptions,
} from './decypharr.verify';
import { createDecypharrVerifyStep } from './decypharr-verify.step';

const identity = { puid: 1000, pgid: 1000 };
const KEYS = { decypharr: 'decypharr-token', sonarr: 'sonarr-key', radarr: 'radarr-key' };
const RD_TOKEN = 'rd-token';
const noSleep = async () => undefined;
const SECRETS = [...Object.values(KEYS), RD_TOKEN];

function createContext(overrides: Partial<ProvisionContext> = {}): ProvisionContext {
  return {
    config: createDefaultConfig({ host: identity }),
    secrets: { rdApiToken: RD_TOKEN, adminUsername: 'Admin', adminPassword: 'p@ss word' },
    layout: createLayout('/unused'),
    identity,
    runtime: {} as ContainerRuntime,
    flags: new Map(),
    cliVersion: '9.9.9',
    ...overrides,
  };
}

async function provisionedServarr(kind: ArrKind): Promise<FakeServarr> {
  const server = createFakeServarr({
    kind,
    apiKey: KEYS[kind],
    decypharrReachable: true,
  });
  await provisionArr(createContext(), {
    kind,
    client: createArrClient({
      kind,
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      fetch: server.fetch,
      sleep: noSleep,
    }),
    apiKey: server.apiKey,
    signal: new AbortController().signal,
    ready: { sleep: noSleep },
  });
  return server;
}

interface Harness {
  decypharr: ReturnType<typeof createFakeDecypharr>;
  servarr: Record<ArrKind, FakeServarr>;
  options: VerifyDecypharrOptions;
}

async function createHarness(
  decypharrOptions: Partial<FakeDecypharrOptions> = {},
  mount: MountWaitOptions = {},
  servarr?: Partial<Record<ArrKind, FakeServarr>>,
): Promise<Harness> {
  const decypharr = createFakeDecypharr({ apiToken: KEYS.decypharr, ...decypharrOptions });
  const servers: Record<ArrKind, FakeServarr> = {
    sonarr: servarr?.sonarr ?? (await provisionedServarr('sonarr')),
    radarr: servarr?.radarr ?? (await provisionedServarr('radarr')),
  };
  const arrs = Object.fromEntries(
    ARR_KINDS.map((kind) => [
      kind,
      createArrClient({
        kind,
        baseUrl: servers[kind].baseUrl,
        apiKey: KEYS[kind],
        fetch: servers[kind].fetch,
        sleep: noSleep,
      }),
    ]),
  ) as VerifyDecypharrOptions['arrs'];
  return {
    decypharr,
    servarr: servers,
    options: {
      decypharr: createDecypharrClient({
        baseUrl: decypharr.baseUrl,
        apiToken: KEYS.decypharr,
        fetch: decypharr.fetch,
        sleep: noSleep,
      }),
      arrs,
      serviceKeys: KEYS,
      signal: new AbortController().signal,
      ready: { sleep: noSleep },
      mount: { readDir: async () => ['__all__', '__bad__'], sleep: noSleep, ...mount },
    },
  };
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
}

describe('verifyDecypharr', () => {
  it('passes on the seeded configuration with a working link and a visible mount', async () => {
    const { options, decypharr, servarr } = await createHarness();

    const report = await verifyDecypharr(createContext(), options);

    expect(report).toMatchObject({
      ok: true,
      version: '2.7',
      brokenEntries: 0,
      mount: { webdavStatus: 207, allFolderVisible: true },
    });
    expect(report.invariants).toHaveLength(13);
    expect(report.links).toEqual(
      (['sonarr', 'radarr'] as const).map((app) => ({
        app,
        knownByDecypharr: true,
        clientLoginOk: true,
        removeCompleted: true,
        removeFailedDisabled: true,
        issues: [],
      })),
    );
    expect(decypharr.writes()).toEqual([]);
    expect(servarr.sonarr.count('POST', '/api/v3/downloadclient/test')).toBe(1);
    expect(servarr.radarr.count('POST', '/api/v3/downloadclient/test')).toBe(1);
  });

  it('only reads: neither Decypharr nor the arrs receive a write apart from the client test', async () => {
    const { options, servarr } = await createHarness();
    const before = ARR_KINDS.map((kind) => servarr[kind].writes().length);

    await verifyDecypharr(createContext(), options);

    expect(
      ARR_KINDS.map(
        (kind, index) =>
          servarr[kind].writes().filter((request) => request.path !== '/api/v3/downloadclient/test')
            .length - before[index]!,
      ),
    ).toEqual([0, 0]);
  });

  it('reports every drift of an altered configuration', async () => {
    const { options } = await createHarness({
      config: (config) => {
        config.default_download_action = 'download';
        (config.mount as { rclone: Record<string, unknown> }).rclone.vfs_cache_mode = 'full';
        config.hearsay = { disabled: false };
      },
    });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.ok).toBe(false);
    expect(
      report.invariants.filter(({ status }) => status === 'drift').map(({ id }) => id),
    ).toEqual(['download-action', 'vfs-cache-mode', 'hearsay']);
  });

  it('honours storage.downloadUncached when it is enabled', async () => {
    const { options } = await createHarness({ seed: { downloadUncached: true } });
    const config = createDefaultConfig({ host: identity });
    config.storage = { enabled: true, downloadUncached: true };

    const report = await verifyDecypharr(createContext({ config }), options);

    expect(report.ok).toBe(true);
  });

  it('detects a host with a trailing slash', async () => {
    const { options } = await createHarness({
      config: (config) => {
        (config.arrs as Record<string, unknown>[])[0]!.host = 'http://sonarr:8989/';
      },
    });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.ok).toBe(false);
    expect(report.links[0]).toMatchObject({ app: 'sonarr', knownByDecypharr: false });
    expect(report.links[0]!.issues).toEqual([
      'arrs[sonarr].host expected "http://sonarr:8989", observed "http://sonarr:8989/"',
    ]);
    expect(report.links[1]!.knownByDecypharr).toBe(true);
  });

  it('detects an arr unknown to Decypharr, a wrong source and a wrong token without printing them', async () => {
    const { options } = await createHarness({
      config: (config) => {
        const arrs = config.arrs as Record<string, unknown>[];
        arrs[0]!.source = 'auto';
        arrs[1]!.token = 'another-radarr-key';
        arrs.push({ name: 'extra', host: 'http://extra', token: 't' });
        config.arrs = arrs.slice(0, 2);
      },
    });

    const report = await verifyDecypharr(createContext(), options);
    const issues = report.links.flatMap((link) => link.issues);

    expect(issues).toEqual([
      'arrs[sonarr].source expected "config", observed "auto"',
      'arrs[radarr].token does not match the radarr API key',
    ]);
    expectNoSecrets(JSON.stringify(report));
    expect(JSON.stringify(report)).not.toContain('another-radarr-key');
  });

  it('detects that Decypharr does not list an arr', async () => {
    const { options } = await createHarness({
      config: (config) => {
        config.arrs = (config.arrs as Record<string, unknown>[]).slice(0, 1);
      },
    });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.links[1]).toMatchObject({ app: 'radarr', knownByDecypharr: false });
    expect(report.links[1]!.issues).toEqual(['GET /api/arrs does not list "radarr"']);
  });

  it('detects removeFailedDownloads enabled and removeCompletedDownloads disabled', async () => {
    const sonarr = await provisionedServarr('sonarr');
    sonarr.state.downloadClients[0]!.removeFailedDownloads = true;
    sonarr.state.downloadClients[0]!.removeCompletedDownloads = false;
    const { options } = await createHarness({}, {}, { sonarr });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.links[0]).toMatchObject({
      removeCompleted: false,
      removeFailedDisabled: false,
      clientLoginOk: true,
    });
    expect(report.links[0]!.issues).toEqual([
      'sonarr client removeCompletedDownloads expected true, observed false',
      'sonarr client removeFailedDownloads expected false, observed true',
    ]);
  });

  it('reports a missing download client', async () => {
    const radarr = await provisionedServarr('radarr');
    radarr.state.downloadClients = [];
    const { options } = await createHarness({}, {}, { radarr });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.links[1]!.issues).toContain('radarr has no download client named "Decypharr"');
    expect(report.invariants.find(({ id }) => id === 'categories')?.status).toBe('drift');
  });

  it('reports a failed login of the download client without leaking keys', async () => {
    const reachable = await provisionedServarr('sonarr');
    const unreachable = createFakeServarr({ kind: 'sonarr', apiKey: KEYS.sonarr });
    unreachable.state.downloadClients = structuredClone(reachable.state.downloadClients);
    const { options } = await createHarness({}, {}, { sonarr: unreachable });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.links[0]).toMatchObject({ clientLoginOk: false });
    expect(report.links[0]!.issues[0]).toContain('sonarr client test failed');
    expect(report.links[0]!.issues[0]).toContain('Unable to connect to qBittorrent');
    expectNoSecrets(JSON.stringify(report));
  });

  it('flags a WebDAV that does not answer 207', async () => {
    const { options } = await createHarness({ webdavStatus: 401 });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.ok).toBe(false);
    expect(report.mount.webdavStatus).toBe(401);
  });

  it('times out when the mount never shows the __all__ folder', async () => {
    let elapsed = 0;
    const reads: string[] = [];
    const { options } = await createHarness(
      {},
      {
        readDir: async (directory) => {
          reads.push(directory);
          return [];
        },
        timeoutMs: 10_000,
        intervalMs: 2_000,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
        },
      },
    );

    const report = await verifyDecypharr(
      createContext({ layout: createLayout('/home/mb') }),
      options,
    );

    expect(report.mount.allFolderVisible).toBe(false);
    expect(report.ok).toBe(false);
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.every((directory) => directory === '/home/mb/mnt/debrid')).toBe(true);
  });

  it('keeps waiting while the mount directory is unreadable and succeeds once it appears', async () => {
    let calls = 0;
    const { options } = await createHarness(
      {},
      {
        readDir: async () => {
          calls += 1;
          if (calls < 3) throw new Error('ENOENT');
          return calls < 4 ? ['x'] : ['__all__'];
        },
      },
    );

    const report = await verifyDecypharr(createContext(), options);

    expect(report.mount.allFolderVisible).toBe(true);
    expect(calls).toBe(4);
  });

  it('counts broken entries and still passes', async () => {
    const { options } = await createHarness({
      brokenEntries: [{ name: 'a' }, { name: 'b' }],
    });

    const report = await verifyDecypharr(createContext(), options);

    expect(report).toMatchObject({ ok: true, brokenEntries: 2 });
  });

  it('degrades to a note when the repair health cannot be read', async () => {
    const { options } = await createHarness({ repairHealthStatus: 404 });

    const report = await verifyDecypharr(createContext(), options);

    expect(report.ok).toBe(true);
    expect(report.repairHealthNote).toContain('repair health unavailable');
    expect(report.repairHealthNote).toContain('404');
  });

  it('fails with the configuration hint when the wizard is pending', async () => {
    const { options } = await createHarness({ wizardPending: true });

    await expect(verifyDecypharr(createContext(), options)).rejects.toThrow(
      'config/decypharr/config.json',
    );
  });
});

describe('decypharr-verify step', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-decypharr-'));
    layout = createLayout(join(sandbox, 'home'));
    mkdirSync(layout.root, { recursive: true });
    writeFileSync(
      layout.envFile,
      [
        `SONARR_API_KEY=${KEYS.sonarr}`,
        `RADARR_API_KEY=${KEYS.radarr}`,
        'PROWLARR_API_KEY=prowlarr-key',
        'BAZARR_API_KEY=bazarr-key',
        `DECYPHARR_API_TOKEN=${KEYS.decypharr}`,
        'SEERR_API_KEY=seerr-key',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function storageContext(): ProvisionContext {
    const config = createDefaultConfig({ host: identity });
    config.storage = { enabled: true, downloadUncached: false };
    return createContext({ layout, config });
  }

  async function stepWith(harness: Harness) {
    return createDecypharrVerifyStep({
      decypharr: { fetch: harness.decypharr.fetch, sleep: noSleep },
      arr: {
        sonarr: { fetch: harness.servarr.sonarr.fetch, sleep: noSleep },
        radarr: { fetch: harness.servarr.radarr.fetch, sleep: noSleep },
      },
      ready: { sleep: noSleep },
      mount: harness.options.mount,
    });
  }

  it('runs in every scope that starts services', () => {
    const step = createDecypharrVerifyStep();

    expect(step.id).toBe('decypharr-verify');
    expect(step.scopes).toEqual(['setup', 'reset', 'config', 'update']);
  });

  it('is skipped without a single request when storage is disabled', async () => {
    const harness = await createHarness();
    const step = await stepWith(harness);
    const ctx = createContext({ layout });

    const report = await runPipeline([step], ctx, { scope: 'setup' });

    expect(report.success).toBe(true);
    expect(report.steps[0]).toMatchObject({ id: 'decypharr-verify', status: 'skipped' });
    expect(report.steps[0]!.detail).toContain('storage.enabled is false');
    expect(harness.decypharr.requests).toHaveLength(0);
  });

  it('reports unchanged with a summary and never changed', async () => {
    const harness = await createHarness({ brokenEntries: [{ name: 'a' }] });
    const step = await stepWith(harness);

    const report = await runPipeline([step], storageContext(), { scope: 'setup' });

    expect(report.success).toBe(true);
    expect(report.steps[0]).toMatchObject({ id: 'decypharr-verify', status: 'unchanged' });
    expect(report.steps[0]!.detail).toBe(
      'Decypharr 2.7, 13 invariants ok, Sonarr and Radarr linked, WebDAV 207, __all__ visible, ' +
        'warning: 1 broken repair entry awaiting automatic repair',
    );
    expectNoSecrets(report.steps[0]!.detail!);
  });

  it('fails the pipeline with the complete drift list and the reset hint', async () => {
    const harness = await createHarness({
      config: (config) => {
        config.default_download_action = 'download';
        config.port = 8282;
      },
    });
    const step = await stepWith(harness);

    const report = await runPipeline([step], storageContext(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain(
      'invariant download-action (ADR-014): expected "symlink", observed "download"',
    );
    expect(report.error).toContain('invariant port: expected "8282", observed 8282');
    expect(report.error).toContain('moody-blues reset --fresh');
    expectNoSecrets(report.error!);
  });

  it('suggests the propagation checks when the mount does not appear', async () => {
    const harness = await createHarness({}, { readDir: async () => [], timeoutMs: 0 });
    const step = await stepWith(harness);

    const report = await runPipeline([step], storageContext(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('findmnt -no PROPAGATION');
    expect(report.error).toContain('/dev/fuse');
    expect(report.error).toContain('rclone.log');
    expect(report.error).not.toContain('reset --fresh');
  });

  it('exposes the error type for drifts', async () => {
    const harness = await createHarness({
      config: (config) => {
        config.use_auth = false;
      },
    });
    const step = await stepWith(harness);

    await expect(step.run(storageContext(), new AbortController().signal)).rejects.toBeInstanceOf(
      DecypharrDriftError,
    );
  });

  it('uses the host url of the service catalog', async () => {
    const harness = await createHarness();
    const step = await stepWith(harness);

    await step.run(storageContext(), new AbortController().signal);

    expect(
      harness.decypharr.requests.every((request) =>
        request.url.startsWith('http://127.0.0.1:8282'),
      ),
    ).toBe(true);
  });

  it('fails when the environment file lacks the service keys', async () => {
    writeFileSync(layout.envFile, 'BAZARR_API_KEY=bazarr-key\n');
    const step = createDecypharrVerifyStep();

    const report = await runPipeline([step], storageContext(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Missing service keys');
  });
});

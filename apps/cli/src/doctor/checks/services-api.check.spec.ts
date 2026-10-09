import { describe, expect, it } from 'vitest';

import {
  createStubArr,
  createStubFetch,
  createTestContext,
  type TestContextOptions,
} from '../doctor-context.testing';
import {
  bazarrApiCheck,
  jellyfinApiCheck,
  prowlarrApiCheck,
  radarrApiCheck,
  seerrApiCheck,
  sonarrApiCheck,
  splitHealth,
} from './services-api.check';

const stopped = (service: string): TestContextOptions => ({
  services: { [service]: { state: 'exited', health: 'none' } },
});

describe('splitHealth', () => {
  it('keeps warnings and errors and drops notices and ok entries', () => {
    const split = splitHealth([
      { source: 'A', type: 'notice', message: 'a' },
      { source: 'B', type: 'warning', message: 'b' },
      { source: 'C', type: 'error', message: 'c' },
      { source: 'D', type: 'ok', message: 'd' },
    ]);

    expect(split).toEqual({ errors: ['C: c'], warnings: ['B: b'] });
  });

  it('drops the ignored sources', () => {
    const split = splitHealth(
      [{ source: 'DownloadClientCheck', type: 'error', message: 'x' }],
      ['DownloadClientCheck'],
    );

    expect(split).toEqual({ errors: [], warnings: [] });
  });
});

describe.each([
  ['sonarr', sonarrApiCheck, 'Sonarr'],
  ['radarr', radarrApiCheck, 'Radarr'],
] as const)('%s API check', (kind, check, label) => {
  it('is ok when the API answers and the health is clean', async () => {
    const { ctx } = createTestContext();

    const result = await check.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.message).toContain(label);
  });

  it('ignores health notices', async () => {
    const { ctx } = createTestContext({
      stubs: {
        [kind]: createStubArr('1.0', [], [{ source: 'Update', type: 'notice', message: 'n' }]),
      },
    });

    expect((await check.run(ctx)).status).toBe('ok');
  });

  it('warns on health warnings', async () => {
    const { ctx } = createTestContext({
      stubs: {
        [kind]: createStubArr('1.0', [], [{ source: 'Disk', type: 'warning', message: 'low' }]),
      },
    });

    const result = await check.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['warning Disk: low']);
  });

  it('fails on health errors', async () => {
    const { ctx } = createTestContext({
      stubs: {
        [kind]: createStubArr('1.0', [], [{ source: 'Disk', type: 'error', message: 'full' }]),
      },
    });

    expect((await check.run(ctx)).status).toBe('error');
  });

  it('ignores the indexer warnings that Prowlarr already reports', async () => {
    const { ctx } = createTestContext({
      stubs: {
        [kind]: createStubArr(
          '1.0',
          [],
          [
            { source: 'IndexerStatusCheck', type: 'warning', message: 'down: 1337x' },
            { source: 'IndexerLongTermStatusCheck', type: 'error', message: 'down: yts' },
          ],
        ),
      },
    });

    expect((await check.run(ctx)).status).toBe('ok');
  });

  it('keeps the other indexer warnings', async () => {
    const { ctx } = createTestContext({
      stubs: {
        [kind]: createStubArr(
          '1.0',
          [],
          [
            { source: 'IndexerStatusCheck', type: 'warning', message: 'down: 1337x' },
            { source: 'IndexerRssCheck', type: 'warning', message: 'No indexers available' },
          ],
        ),
      },
    });

    const result = await check.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['warning IndexerRssCheck: No indexers available']);
  });

  it('ignores the download client health while the storage profile is off', async () => {
    const health = [
      { source: 'DownloadClientCheck', type: 'error', message: 'cannot reach decypharr' },
      { source: 'DownloadClientStatusCheck', type: 'error', message: 'none available' },
    ];
    const off = createTestContext({
      storage: false,
      stubs: { [kind]: createStubArr('1.0', [], health) },
    });
    const on = createTestContext({
      storage: true,
      stubs: { [kind]: createStubArr('1.0', [], health) },
    });

    expect((await check.run(off.ctx)).status).toBe('ok');
    expect((await check.run(on.ctx)).status).toBe('error');
  });

  it('fails when the key is rejected', async () => {
    const stub = createStubArr('1.0');
    stub.on('GET', '/api/v3/system/status', { status: 401, text: 'Unauthorized' });
    const { ctx } = createTestContext({ stubs: { [kind]: stub } });

    const result = await check.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe(`${label} rejected the API key`);
  });

  it('fails when the service does not answer', async () => {
    const stub = createStubArr('1.0');
    stub.on('GET', '/api/v3/system/status', new Error('connect ECONNREFUSED'));
    const { ctx } = createTestContext({ stubs: { [kind]: stub } });

    const result = await check.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe(`${label} did not answer`);
  });

  it('is skipped when its container is not running', async () => {
    const { ctx, stubs } = createTestContext(stopped(kind));

    const result = await check.run(ctx);

    expect(result.status).toBe('skipped');
    expect(stubs[kind].requests).toEqual([]);
  });

  it('is skipped when Docker did not report the stack', async () => {
    const { ctx } = createTestContext({ stack: new Error('docker down') });

    expect((await check.run(ctx)).status).toBe('skipped');
  });
});

describe('Prowlarr API check', () => {
  function prowlarr(indexers: number, options: { blockedUntil?: string; health?: unknown[] } = {}) {
    const stub = createStubFetch();
    stub.on('GET', '/api/v1/applications', { body: [] });
    stub.on('GET', '/api/v1/indexer', {
      body: Array.from({ length: indexers }, (_, index) => ({
        id: index + 1,
        name: `idx${index + 1}`,
      })),
    });
    stub.on('GET', '/api/v1/indexerstatus', {
      body: options.blockedUntil ? [{ indexerId: 1, disabledTill: options.blockedUntil }] : [],
    });
    stub.on('GET', '/api/v1/health', { body: options.health ?? [] });
    return stub;
  }

  it('is ok with indexers, none blocked and a clean health', async () => {
    const { ctx } = createTestContext({ stubs: { prowlarr: prowlarr(3) } });

    expect(await prowlarrApiCheck.run(ctx)).toEqual({
      status: 'ok',
      message: 'Prowlarr has 3 indexers and none is blocked',
    });
  });

  it('warns about a blocked indexer', async () => {
    const { ctx } = createTestContext({
      stubs: { prowlarr: prowlarr(3, { blockedUntil: '2026-10-09T18:00:00Z' }) },
    });

    const result = await prowlarrApiCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['indexer idx1 is blocked until 2026-10-09T18:00:00Z']);
  });

  it('ignores a blocked status that already expired', async () => {
    const { ctx } = createTestContext({
      stubs: { prowlarr: prowlarr(3, { blockedUntil: '2026-10-09T11:00:00Z' }) },
    });

    expect((await prowlarrApiCheck.run(ctx)).status).toBe('ok');
  });

  it('warns on a health warning', async () => {
    const { ctx } = createTestContext({
      stubs: {
        prowlarr: prowlarr(2, {
          health: [{ source: 'IndexerStatusCheck', type: 'warning', message: 'down: 1337x' }],
        }),
      },
    });

    const result = await prowlarrApiCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['warning IndexerStatusCheck: down: 1337x']);
  });

  it('fails without indexers', async () => {
    const { ctx } = createTestContext({ stubs: { prowlarr: prowlarr(0) } });

    expect((await prowlarrApiCheck.run(ctx)).status).toBe('error');
  });

  it('fails on a health error', async () => {
    const { ctx } = createTestContext({
      stubs: {
        prowlarr: prowlarr(2, { health: [{ source: 'X', type: 'error', message: 'broken' }] }),
      },
    });

    expect((await prowlarrApiCheck.run(ctx)).status).toBe('error');
  });

  it('fails when the key is rejected', async () => {
    const stub = prowlarr(2);
    stub.on('GET', '/api/v1/applications', { status: 401 });
    const { ctx } = createTestContext({ stubs: { prowlarr: stub } });

    expect((await prowlarrApiCheck.run(ctx)).message).toBe('Prowlarr rejected the API key');
  });

  it('is skipped when the container is not running', async () => {
    const { ctx } = createTestContext(stopped('prowlarr'));

    expect((await prowlarrApiCheck.run(ctx)).status).toBe('skipped');
  });
});

describe('Bazarr API check', () => {
  function bazarr(sonarrVersion: string, radarrVersion: string) {
    const stub = createStubFetch();
    stub.on('GET', '/api/system/status', {
      body: {
        data: {
          bazarr_version: '1.6.2',
          sonarr_version: sonarrVersion,
          radarr_version: radarrVersion,
        },
      },
    });
    return stub;
  }

  it('is ok when it reached Sonarr and Radarr', async () => {
    const { ctx } = createTestContext({ stubs: { bazarr: bazarr('4.0', '6.4') } });

    expect((await bazarrApiCheck.run(ctx)).status).toBe('ok');
  });

  it.each([
    ['Sonarr', '', '6.4'],
    ['Radarr', '4.0', ''],
    ['Sonarr and Radarr', '', ''],
  ])('warns when it has not reached %s', async (names, sonarrVersion, radarrVersion) => {
    const { ctx } = createTestContext({ stubs: { bazarr: bazarr(sonarrVersion, radarrVersion) } });

    const result = await bazarrApiCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toBe(`Bazarr has not reached ${names}`);
  });

  it('fails when the key is rejected', async () => {
    const stub = createStubFetch();
    stub.on('GET', '/api/system/status', { status: 401 });
    const { ctx } = createTestContext({ stubs: { bazarr: stub } });

    expect((await bazarrApiCheck.run(ctx)).message).toBe('Bazarr rejected the API key');
  });

  it('is skipped when the container is stopped', async () => {
    const { ctx } = createTestContext(stopped('bazarr'));

    expect((await bazarrApiCheck.run(ctx)).status).toBe('skipped');
  });
});

describe('Jellyfin API check', () => {
  function jellyfin(wizardCompleted: boolean, keysStatus = 200) {
    const stub = createStubFetch();
    stub.on('GET', '/System/Info/Public', {
      body: { Version: '12.2.0', StartupWizardCompleted: wizardCompleted },
    });
    stub.on('GET', '/Auth/Keys', { status: keysStatus, body: { Items: [] } });
    return stub;
  }

  it('is ok when the wizard is complete and the key is accepted', async () => {
    const stub = jellyfin(true);
    const { ctx } = createTestContext({
      env: { JELLYFIN_API_KEY: 'jellyfin-secret-key' },
      stubs: { jellyfin: stub },
    });

    const result = await jellyfinApiCheck.run(ctx);

    expect(result.status).toBe('ok');
    expect(stub.requests.at(-1)?.headers.authorization).toContain('Token="jellyfin-secret-key"');
  });

  it('warns when the key is missing from the env file', async () => {
    const { ctx } = createTestContext({ stubs: { jellyfin: jellyfin(true) } });

    const result = await jellyfinApiCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toContain('JELLYFIN_API_KEY');
  });

  it('fails when the wizard is not completed', async () => {
    const { ctx } = createTestContext({
      env: { JELLYFIN_API_KEY: 'jellyfin-secret-key' },
      stubs: { jellyfin: jellyfin(false) },
    });

    expect((await jellyfinApiCheck.run(ctx)).status).toBe('error');
  });

  it('fails when the key is rejected', async () => {
    const { ctx } = createTestContext({
      env: { JELLYFIN_API_KEY: 'jellyfin-secret-key' },
      stubs: { jellyfin: jellyfin(true, 401) },
    });

    const result = await jellyfinApiCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe('Jellyfin rejected the API key');
  });

  it('fails while the server is still starting', async () => {
    const stub = createStubFetch();
    stub.on('GET', '/System/Info/Public', { body: { serverName: 'bootstrap' } });
    const { ctx } = createTestContext({ stubs: { jellyfin: stub } });

    expect((await jellyfinApiCheck.run(ctx)).status).toBe('error');
  });

  it('is skipped when the container is stopped', async () => {
    const { ctx } = createTestContext(stopped('jellyfin'));

    expect((await jellyfinApiCheck.run(ctx)).status).toBe('skipped');
  });
});

describe('Seerr API check', () => {
  function seerr(initialized: boolean, meStatus = 200) {
    const stub = createStubFetch();
    stub.on('GET', '/api/v1/settings/public', { body: { initialized, mediaServerType: 2 } });
    stub.on('GET', '/api/v1/auth/me', { status: meStatus, body: { id: 1, permissions: 2 } });
    return stub;
  }

  it('is ok when initialized and the key is accepted', async () => {
    const stub = seerr(true);
    const { ctx } = createTestContext({ stubs: { seerr: stub } });

    expect((await seerrApiCheck.run(ctx)).status).toBe('ok');
    expect(stub.requests.at(-1)?.headers['x-api-key']).toBe('seerr-secret-key');
  });

  it('fails when it is not initialized', async () => {
    const { ctx } = createTestContext({ stubs: { seerr: seerr(false) } });

    expect((await seerrApiCheck.run(ctx)).message).toBe('Seerr is not initialized');
  });

  it('fails when the key is rejected', async () => {
    const { ctx } = createTestContext({ stubs: { seerr: seerr(true, 403) } });

    expect((await seerrApiCheck.run(ctx)).message).toBe('Seerr rejected the API key');
  });

  it('is skipped when the container is stopped', async () => {
    const { ctx } = createTestContext(stopped('seerr'));

    expect((await seerrApiCheck.run(ctx)).status).toBe('skipped');
  });
});

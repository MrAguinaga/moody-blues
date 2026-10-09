import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DecypharrConfigInvalidError,
  HttpStatusError,
  ServiceNotReadyError,
  type VerificationReport,
  verifyDecypharr,
} from '@moody-blues/provisioner';

import { createTestContext } from '../doctor-context.testing';
import { debridMountCheck, decypharrConfigCheck, decypharrLinkCheck } from './decypharr.check';
import { realDebridTokenCheck } from './realdebrid-token.check';

vi.mock('@moody-blues/provisioner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@moody-blues/provisioner')>()),
  verifyDecypharr: vi.fn(),
  loadServiceKeys: vi.fn(() => ({
    sonarrApiKey: 'sonarr-secret-key',
    radarrApiKey: 'radarr-secret-key',
    decypharrApiToken: 'decypharr-secret-token',
  })),
}));

const verify = vi.mocked(verifyDecypharr);
const MOUNT = '/mb-test/mnt/debrid';

function healthyLink(app: 'sonarr' | 'radarr') {
  return {
    app,
    knownByDecypharr: true,
    clientLoginOk: true,
    removeCompleted: true,
    removeFailedDisabled: true,
    issues: [],
  };
}

function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    version: '2.7',
    invariants: Array.from({ length: 14 }, (_, index) => ({
      id: 'port' as const,
      description: `invariant ${index}`,
      status: 'ok' as const,
      expected: 'x',
      actual: 'x',
    })),
    links: [healthyLink('sonarr'), healthyLink('radarr')],
    mount: { webdavStatus: 207, allFolderVisible: true },
    brokenEntries: 0,
    ok: true,
    ...overrides,
  };
}

function withStorage(directories: Record<string, string[] | Error> = {}) {
  return createTestContext({
    storage: true,
    directories: { [`${MOUNT}/__all__`]: [], ...directories },
  });
}

beforeEach(() => {
  verify.mockReset();
});

describe('Decypharr checks without the storage profile', () => {
  it.each([
    ['decypharr-config', decypharrConfigCheck],
    ['decypharr-link', decypharrLinkCheck],
    ['debrid-mount', debridMountCheck],
    ['realdebrid-token', realDebridTokenCheck],
  ])('skips %s and never verifies Decypharr', async (_id, check) => {
    const { ctx } = createTestContext({ storage: false });

    const result = await check.run(ctx);

    expect(result.status).toBe('skipped');
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('decypharrConfigCheck', () => {
  it('is ok with the 14 invariants and reports the version', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = withStorage();

    expect(await decypharrConfigCheck.run(ctx)).toEqual({
      status: 'ok',
      message: '14 invariants hold, Decypharr 2.7',
    });
  });

  it('verifies once for the three Decypharr checks and with 5 second limits', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = withStorage();

    await decypharrConfigCheck.run(ctx);
    await decypharrLinkCheck.run(ctx);
    await debridMountCheck.run(ctx);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]?.[1]).toMatchObject({
      ready: { timeoutMs: 5000 },
      mount: { timeoutMs: 5000 },
    });
  });

  it('fails with the drifted invariants as details', async () => {
    verify.mockResolvedValue(
      report({
        invariants: [
          { id: 'port', description: 'p', status: 'drift', expected: '8282', actual: '9999' },
          ...report().invariants.slice(1),
        ],
      }),
    );
    const { ctx } = withStorage();

    const result = await decypharrConfigCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe('1 of 14 Decypharr invariants drifted');
    expect(result.details?.[0]).toBe('invariant port: expected 8282, observed 9999');
  });

  it('fails when the wizard answers 503', async () => {
    verify.mockRejectedValue(new DecypharrConfigInvalidError('http://127.0.0.1:8282/api/config'));
    const { ctx } = withStorage();

    const result = await decypharrConfigCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toContain('setup wizard');
  });

  it('fails when Decypharr does not answer', async () => {
    verify.mockRejectedValue(
      new ServiceNotReadyError('Decypharr', 5000, undefined, 'GET', '/version'),
    );
    const { ctx } = withStorage();

    const result = await decypharrConfigCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe('Decypharr did not answer');
  });

  it('fails when the token is rejected', async () => {
    verify.mockRejectedValue(
      new HttpStatusError('GET', 'http://127.0.0.1:8282/api/config', 401, ''),
    );
    const { ctx } = withStorage();

    expect((await decypharrConfigCheck.run(ctx)).message).toBe('Decypharr rejected the API token');
  });
});

describe('decypharrLinkCheck', () => {
  it('is ok when both apps are registered and sign in', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = withStorage();

    expect((await decypharrLinkCheck.run(ctx)).status).toBe('ok');
  });

  it('fails when a registration is missing', async () => {
    verify.mockResolvedValue(
      report({
        links: [
          healthyLink('sonarr'),
          {
            ...healthyLink('radarr'),
            knownByDecypharr: false,
            issues: ['GET /api/arrs does not list "radarr"'],
          },
        ],
      }),
    );
    const { ctx } = withStorage();

    const result = await decypharrLinkCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details).toContain('GET /api/arrs does not list "radarr"');
  });

  it('fails when the login test fails', async () => {
    verify.mockResolvedValue(
      report({
        links: [{ ...healthyLink('sonarr'), clientLoginOk: false }, healthyLink('radarr')],
      }),
    );
    const { ctx } = withStorage();

    const result = await decypharrLinkCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details).toContain('sonarr download client login failed');
  });

  it('is skipped when the configuration check could not run', async () => {
    verify.mockRejectedValue(new Error('boom'));
    const { ctx } = withStorage();

    expect((await decypharrLinkCheck.run(ctx)).status).toBe('skipped');
  });
});

describe('debridMountCheck', () => {
  it('is ok when the mount is readable and nothing is broken', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = withStorage();

    expect(await debridMountCheck.run(ctx)).toEqual({
      status: 'ok',
      message: 'WebDAV answers 207, __all__ is readable, no broken repair entries',
    });
  });

  it('warns about broken repair entries', async () => {
    verify.mockResolvedValue(report({ brokenEntries: 2 }));
    const { ctx } = withStorage();

    const result = await debridMountCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['2 broken repair entries await the automatic repair']);
  });

  it('warns when the repair health cannot be read', async () => {
    verify.mockResolvedValue(report({ repairHealthNote: 'repair health unavailable: 500' }));
    const { ctx } = withStorage();

    expect((await debridMountCheck.run(ctx)).status).toBe('warning');
  });

  it('fails when WebDAV does not answer 207', async () => {
    verify.mockResolvedValue(report({ mount: { webdavStatus: 502, allFolderVisible: true } }));
    const { ctx } = withStorage();

    const result = await debridMountCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details).toEqual(['PROPFIND /webdav/ answered 502, expected 207']);
  });

  it('fails when __all__ is not visible', async () => {
    verify.mockResolvedValue(report({ mount: { webdavStatus: 207, allFolderVisible: false } }));
    const { ctx } = withStorage();

    const result = await debridMountCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details).toEqual([`Folder __all__ is not visible in ${MOUNT}`]);
  });

  it('explains how to release a dead FUSE mount', async () => {
    verify.mockImplementation(async (_ctx, options) => {
      await options.mount?.readDir?.(MOUNT).catch(() => undefined);
      return report({ mount: { webdavStatus: 207, allFolderVisible: false } });
    });
    const { ctx } = withStorage({
      [MOUNT]: Object.assign(new Error('transport endpoint is not connected'), {
        code: 'ENOTCONN',
      }),
    });

    const result = await debridMountCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details?.[0]).toContain('ENOTCONN');
    expect(result.suggestion).toContain(`sudo umount -l ${MOUNT}`);
  });

  it('fails when reading __all__ fails with ENOTCONN', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = withStorage({
      [`${MOUNT}/__all__`]: Object.assign(new Error('not connected'), { code: 'ENOTCONN' }),
    });

    const result = await debridMountCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details?.[0]).toContain('Reading __all__ failed: ENOTCONN');
  });

  it('fails when __all__ does not answer in time', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = withStorage({
      [`${MOUNT}/__all__`]: Object.assign(new Error('no answer within 5 s'), { code: 'ETIMEDOUT' }),
    });

    const result = await debridMountCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.details?.[0]).toContain('ETIMEDOUT');
  });

  it('is skipped when the configuration check could not run', async () => {
    verify.mockRejectedValue(new Error('boom'));
    const { ctx } = withStorage();

    expect((await debridMountCheck.run(ctx)).status).toBe('skipped');
  });
});

describe('realDebridTokenCheck', () => {
  const logOf = (text: string) => ({ text, modifiedAt: Date.parse('2026-10-09T12:00:00Z') });

  it('is ok when the log shows no authentication rejection', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = createTestContext({
      storage: true,
      log: logOf(
        [
          '2026-10-09 11:59:00 | WARN  | [realdebrid] 404 torrent_not_cached',
          '2026-10-09 11:59:10 | WARN  | [realdebrid] 451 UnavailableForLegalReasons',
        ].join('\n'),
      ),
    });

    expect(await realDebridTokenCheck.run(ctx)).toEqual({
      status: 'ok',
      message: 'Indirect check: no authentication errors in the Decypharr log',
    });
  });

  it('fails when the recent log has a rejection', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = createTestContext({
      storage: true,
      log: logOf('2026-10-09 11:59:00 | ERROR | [realdebrid] bad_token'),
    });

    const result = await realDebridTokenCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe('Real-Debrid rejected the token');
    expect(result.suggestion).toContain('RD_API_TOKEN');
  });

  it('does not repeat the log content', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = createTestContext({
      storage: true,
      log: logOf('2026-10-09 11:59:00 | ERROR | [realdebrid] bad_token Bearer abcdef123456'),
    });

    const result = await realDebridTokenCheck.run(ctx);

    expect(JSON.stringify(result)).not.toContain('abcdef123456');
  });

  it('warns when the log cannot be read', async () => {
    verify.mockResolvedValue(report());
    const { ctx } = createTestContext({ storage: true });

    expect((await realDebridTokenCheck.run(ctx)).status).toBe('warning');
  });

  it('warns when Decypharr could not be verified', async () => {
    verify.mockRejectedValue(new Error('boom'));
    const { ctx } = createTestContext({
      storage: true,
      log: logOf('2026-10-09 11:59:00 | ERROR | [realdebrid] bad_token'),
    });

    const result = await realDebridTokenCheck.run(ctx);

    expect(result.status).toBe('warning');
  });
});

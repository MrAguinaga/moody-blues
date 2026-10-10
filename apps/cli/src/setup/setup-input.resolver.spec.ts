import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig, createLayout, writeEnv, writeState } from '@moody-blues/provisioner';

import type { SetupResolution, SetupSources, SetupValues } from './setup.types';
import { resolveSetupInput } from './setup-input.resolver';
import { loadSetupSources, parseSetupEnvRecord } from './setup-sources.loader';

const SECRETS: SetupValues = {
  rdApiToken: 'rd-token',
  adminUsername: 'admin',
  adminPassword: 'hunter2-secret',
};

function sources(overrides: Partial<SetupSources> = {}): SetupSources {
  return { flags: {}, envFile: {}, previous: {}, ignoredKeys: [], ...overrides };
}

const withStorage = { detectStorage: vi.fn(async () => true) };
const withoutStorage = { detectStorage: vi.fn(async () => false) };

function expectComplete(resolution: SetupResolution) {
  if (!resolution.complete) {
    throw new Error(`Expected a complete resolution: ${JSON.stringify(resolution.issues)}`);
  }
  return resolution.input;
}

describe('resolveSetupInput', () => {
  it('applies the defaults when only the required secrets are provided', async () => {
    const input = expectComplete(
      await resolveSetupInput(sources({ envFile: SECRETS }), withoutStorage),
    );

    expect(input.config).toMatchObject({
      mode: 'local',
      domain: 'localhost',
      transcoding: 'off',
      acme: { staging: false },
      storage: { enabled: false },
    });
    expect(input.secrets).toEqual({
      rdApiToken: 'rd-token',
      adminUsername: 'admin',
      adminPassword: 'hunter2-secret',
    });
  });

  it('enables storage only when the host supports it', async () => {
    const input = expectComplete(
      await resolveSetupInput(sources({ envFile: SECRETS }), withStorage),
    );

    expect(input.config.storage.enabled).toBe(true);
  });

  it('gives flags precedence over the env file, the previous installation and the defaults', async () => {
    const previousConfig = createDefaultConfig({
      mode: 'remote',
      domain: 'previous.example.com',
      transcoding: 'cpu',
      host: { puid: 1000, pgid: 1000 },
    });

    const input = expectComplete(
      await resolveSetupInput(
        sources({
          flags: { mode: 'remote', domain: 'flag.example.com', transcoding: 'hardware' },
          envFile: {
            ...SECRETS,
            mode: 'local',
            domain: 'file.example.com',
            transcoding: 'cpu',
            acmeEmail: 'file@example.com',
          },
          previous: {
            mode: 'remote',
            domain: 'previous.example.com',
            transcoding: 'off',
            acmeEmail: 'previous@example.com',
            rdApiToken: 'old-token',
          },
          previousConfig,
        }),
        withoutStorage,
      ),
    );

    expect(input.config).toMatchObject({
      mode: 'remote',
      domain: 'flag.example.com',
      transcoding: 'hardware',
      acme: { email: 'file@example.com' },
    });
    expect(input.secrets.rdApiToken).toBe('rd-token');
  });

  it('falls back to the previous installation for everything that is not provided', async () => {
    const previousConfig = createDefaultConfig({
      mode: 'remote',
      domain: 'previous.example.com',
      transcoding: 'cpu',
      acme: { email: 'ops@example.com', staging: true },
      host: { puid: 1234, pgid: 4321 },
    });

    const input = expectComplete(
      await resolveSetupInput(
        sources({
          previous: {
            ...SECRETS,
            mode: 'remote',
            domain: 'previous.example.com',
            transcoding: 'cpu',
            acmeEmail: 'ops@example.com',
            acmeStaging: true,
          },
          previousConfig,
        }),
        withoutStorage,
      ),
    );

    expect(input.config).toMatchObject({
      mode: 'remote',
      domain: 'previous.example.com',
      transcoding: 'cpu',
      acme: { email: 'ops@example.com', staging: true },
      host: { puid: 1234, pgid: 4321 },
    });
  });

  it('reports every missing required value without echoing any value', async () => {
    const resolution = await resolveSetupInput(
      sources({ flags: { mode: 'remote' }, envFile: { rdApiToken: 'rd-token' } }),
      withStorage,
    );

    expect(resolution.complete).toBe(false);
    if (resolution.complete) return;
    expect(resolution.issues).toEqual([
      { key: 'MB_DOMAIN', problem: 'missing', message: 'MB_DOMAIN is required in remote mode' },
      { key: 'ADMIN_USERNAME', problem: 'missing', message: 'ADMIN_USERNAME is required' },
      { key: 'ADMIN_PASSWORD', problem: 'missing', message: 'ADMIN_PASSWORD is required' },
    ]);
    expect(JSON.stringify(resolution)).not.toContain('rd-token\n');
  });

  it('does not detect the storage while the input is incomplete', async () => {
    const detectStorage = vi.fn(async () => true);

    await resolveSetupInput(sources(), { detectStorage });

    expect(detectStorage).not.toHaveBeenCalled();
  });

  it.each([
    ['mode', { mode: 'cloud' }, 'MB_MODE'],
    ['transcoding', { transcoding: 'gpu' }, 'MB_TRANSCODING'],
  ])('flags an invalid %s', async (_name, values, key) => {
    const resolution = await resolveSetupInput(
      sources({ envFile: { ...SECRETS, ...values } }),
      withStorage,
    );

    expect(resolution.complete).toBe(false);
    if (resolution.complete) return;
    expect(resolution.issues).toContainEqual(expect.objectContaining({ key, problem: 'invalid' }));
  });

  it('rejects an invalid remote domain and an invalid email through the config schema', async () => {
    const resolution = await resolveSetupInput(
      sources({
        envFile: { ...SECRETS, mode: 'remote', domain: 'not a domain', acmeEmail: 'nope' },
      }),
      withStorage,
    );

    expect(resolution.complete).toBe(false);
    if (resolution.complete) return;
    expect(resolution.issues.map((issue) => issue.key).sort()).toEqual([
      'MB_ACME_EMAIL',
      'MB_DOMAIN',
    ]);
  });

  it('rejects a public domain in local mode', async () => {
    const resolution = await resolveSetupInput(
      sources({ envFile: { ...SECRETS, mode: 'local', domain: 'example.com' } }),
      withStorage,
    );

    expect(resolution.complete).toBe(false);
    if (resolution.complete) return;
    expect(resolution.issues).toEqual([
      expect.objectContaining({ key: 'MB_DOMAIN', problem: 'invalid' }),
    ]);
  });

  it('ignores a previous remote domain when switching to local mode', async () => {
    const input = expectComplete(
      await resolveSetupInput(
        sources({
          flags: { mode: 'local' },
          previous: { ...SECRETS, mode: 'remote', domain: 'previous.example.com' },
        }),
        withoutStorage,
      ),
    );

    expect(input.config).toMatchObject({ mode: 'local', domain: 'localhost' });
  });

  it('does not inherit the localhost domain when switching to remote mode', async () => {
    const resolution = await resolveSetupInput(
      sources({
        flags: { mode: 'remote' },
        previous: { ...SECRETS, mode: 'local', domain: 'localhost' },
      }),
      withoutStorage,
    );

    expect(resolution.complete).toBe(false);
    if (resolution.complete) return;
    expect(resolution.issues).toEqual([expect.objectContaining({ key: 'MB_DOMAIN' })]);
    expect(resolution.draft.domain).toBeUndefined();
  });

  it('treats blank values as absent', async () => {
    const resolution = await resolveSetupInput(
      sources({ envFile: { ...SECRETS, adminUsername: '   ' } }),
      withStorage,
    );

    expect(resolution.complete).toBe(false);
  });

  it('keeps optional OpenSubtitles credentials and trims values', async () => {
    const input = expectComplete(
      await resolveSetupInput(
        sources({
          envFile: {
            ...SECRETS,
            rdApiToken: '  padded-token  ',
            opensubtitlesUsername: 'subs',
            opensubtitlesPassword: 'subs-pass',
          },
        }),
        withStorage,
      ),
    );

    expect(input.secrets).toMatchObject({
      rdApiToken: 'padded-token',
      opensubtitlesUsername: 'subs',
      opensubtitlesPassword: 'subs-pass',
    });
  });

  describe('an empty OpenSubtitles value', () => {
    const previous: SetupValues = {
      ...SECRETS,
      opensubtitlesUsername: 'old-user',
      opensubtitlesPassword: 'old-pass',
    };

    it('removes the previous credentials when the env file sets them empty', async () => {
      const input = expectComplete(
        await resolveSetupInput(
          sources({
            envFile: { ...SECRETS, opensubtitlesUsername: '', opensubtitlesPassword: '  ' },
            previous,
          }),
          withStorage,
        ),
      );

      expect(input.secrets).toEqual({
        ...{ rdApiToken: 'rd-token', adminUsername: 'admin', adminPassword: 'hunter2-secret' },
        clearedSecrets: ['OPENSUBTITLES_USERNAME', 'OPENSUBTITLES_PASSWORD'],
      });
    });

    it('clears only the key that is empty', async () => {
      const input = expectComplete(
        await resolveSetupInput(
          sources({ envFile: { ...SECRETS, opensubtitlesUsername: '' }, previous }),
          withStorage,
        ),
      );

      expect(input.secrets).toMatchObject({
        opensubtitlesPassword: 'old-pass',
        clearedSecrets: ['OPENSUBTITLES_USERNAME'],
      });
      expect(input.secrets.opensubtitlesUsername).toBeUndefined();
    });

    it('keeps the previous credentials when the keys are absent from the env file', async () => {
      const input = expectComplete(
        await resolveSetupInput(sources({ envFile: SECRETS, previous }), withStorage),
      );

      expect(input.secrets).toMatchObject({
        opensubtitlesUsername: 'old-user',
        opensubtitlesPassword: 'old-pass',
      });
      expect(input.secrets.clearedSecrets).toBeUndefined();
    });

    it('lets a value with higher precedence win over an empty one', async () => {
      const input = expectComplete(
        await resolveSetupInput(
          sources({
            flags: { opensubtitlesUsername: 'flag-user' },
            envFile: { ...SECRETS, opensubtitlesUsername: '' },
            previous,
          }),
          withStorage,
        ),
      );

      expect(input.secrets).toMatchObject({ opensubtitlesUsername: 'flag-user' });
      expect(input.secrets.clearedSecrets).toBeUndefined();
    });
  });

  it('lets wizard answers fill the gaps and take precedence over previous values', async () => {
    const input = expectComplete(
      await resolveSetupInput(
        sources({
          answers: { ...SECRETS, mode: 'remote', domain: 'answer.example.com' },
          previous: { transcoding: 'cpu' },
        }),
        withoutStorage,
      ),
    );

    expect(input.config).toMatchObject({
      mode: 'remote',
      domain: 'answer.example.com',
      transcoding: 'cpu',
    });
  });
});

describe('loadSetupSources', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-setup-sources-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('reads accepted keys from the env file and lists the ignored ones', () => {
    const envFile = join(sandbox, 'secrets.env');
    writeFileSync(
      envFile,
      [
        'RD_API_TOKEN=rd-token',
        'ADMIN_USERNAME=admin',
        "ADMIN_PASSWORD='p@ss word'",
        'MB_MODE=remote',
        'MB_DOMAIN=example.com',
        'MB_ACME_EMAIL=ops@example.com',
        'MB_TRANSCODING=cpu',
        'SONARR_API_KEY=abc',
        'EXTRA=1',
      ].join('\n'),
    );

    const { sources } = loadSetupSources({ flags: {}, envFile, home: join(sandbox, 'home') });

    expect(sources.envFile).toEqual({
      rdApiToken: 'rd-token',
      adminUsername: 'admin',
      adminPassword: 'p@ss word',
      mode: 'remote',
      domain: 'example.com',
      acmeEmail: 'ops@example.com',
      transcoding: 'cpu',
    });
    expect(sources.ignoredKeys).toEqual(['EXTRA', 'SONARR_API_KEY']);
    expect(sources.previousConfig).toBeUndefined();
  });

  it('keeps a key that is present and empty so the resolver can tell it from an absent one', () => {
    const { values } = parseSetupEnvRecord({ OPENSUBTITLES_USERNAME: '', RD_API_TOKEN: 't' });

    expect(values).toEqual({ opensubtitlesUsername: '', rdApiToken: 't' });
  });

  it('fails with a clear message when the env file is missing or malformed', () => {
    const home = join(sandbox, 'home');
    const broken = join(sandbox, 'broken.env');
    writeFileSync(broken, 'not an assignment');

    expect(() => loadSetupSources({ flags: {}, envFile: join(sandbox, 'nope.env'), home })).toThrow(
      /Environment file not found/,
    );
    expect(() => loadSetupSources({ flags: {}, envFile: broken, home })).toThrow(
      /Invalid environment file .*line 1/,
    );
  });

  it('loads the previous installation: configuration and user secrets only', () => {
    const layout = createLayout(join(sandbox, 'home'));
    mkdirSync(layout.root);
    const config = createDefaultConfig({
      mode: 'remote',
      domain: 'example.com',
      acme: { email: 'ops@example.com', staging: true },
      transcoding: 'cpu',
      host: { puid: 1000, pgid: 1000 },
    });
    writeState(layout.stateFile, config, { runAsRoot: false });
    writeEnv(layout.envFile, {
      MB_HOME: layout.root,
      RD_API_TOKEN: 'old-token',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'old-pass',
      SONARR_API_KEY: 'generated',
    });

    const { sources } = loadSetupSources({ flags: { mode: 'local' }, home: layout.root });

    expect(sources.previous).toEqual({
      mode: 'remote',
      domain: 'example.com',
      acmeEmail: 'ops@example.com',
      acmeStaging: true,
      transcoding: 'cpu',
      rdApiToken: 'old-token',
      adminUsername: 'admin',
      adminPassword: 'old-pass',
    });
    expect(sources.previousConfig).toEqual(config);
    expect(sources.flags).toEqual({ mode: 'local' });
  });
});

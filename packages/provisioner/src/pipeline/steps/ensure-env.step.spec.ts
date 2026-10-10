import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../../config';
import { createLayout, type MbHomeLayout } from '../../home';
import { readEnv } from '../../state';
import type { ContainerRuntime, ProvisionContext } from '../pipeline.types';
import { ensureEnvStep } from './ensure-env.step';

const identity = { puid: 1000, pgid: 1000 };

describe('ensureEnvStep', () => {
  let sandbox: string;
  let layout: MbHomeLayout;
  let ctx: ProvisionContext;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-ensure-env-'));
    layout = createLayout(sandbox);
    ctx = {
      config: createDefaultConfig({ host: identity }),
      secrets: { rdApiToken: 'rd-token', adminUsername: 'Admin', adminPassword: 'p@ss word' },
      layout,
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
    };
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('keeps the issued Jellyfin key on later runs and reports unchanged', async () => {
    const first = await ensureEnvStep.run(ctx, new AbortController().signal);
    expect(first.status).toBe('changed');
    writeFileSync(
      layout.envFile,
      `${readFileSync(layout.envFile, 'utf8')}JELLYFIN_API_KEY=issued-key\n`,
    );
    const before = readFileSync(layout.envFile, 'utf8');

    const second = await ensureEnvStep.run(ctx, new AbortController().signal);

    expect(second).toEqual({ status: 'unchanged' });
    expect(readEnv(layout.envFile).JELLYFIN_API_KEY).toBe('issued-key');
    expect(readFileSync(layout.envFile, 'utf8')).toBe(before);
  });

  it('keeps the issued key when other entries change', async () => {
    await ensureEnvStep.run(ctx, new AbortController().signal);
    writeFileSync(
      layout.envFile,
      `${readFileSync(layout.envFile, 'utf8')}JELLYFIN_API_KEY=issued-key\n`,
    );
    ctx.secrets = { ...ctx.secrets, adminPassword: 'rotated' };

    const outcome = await ensureEnvStep.run(ctx, new AbortController().signal);

    expect(outcome.status).toBe('changed');
    expect(readEnv(layout.envFile)).toMatchObject({
      ADMIN_PASSWORD: 'rotated',
      JELLYFIN_API_KEY: 'issued-key',
    });
  });

  it('writes the issued key after the service keys', async () => {
    await ensureEnvStep.run(ctx, new AbortController().signal);
    writeFileSync(
      layout.envFile,
      `${readFileSync(layout.envFile, 'utf8')}JELLYFIN_API_KEY=issued-key\n`,
    );
    ctx.secrets = { ...ctx.secrets, adminPassword: 'rotated' };
    await ensureEnvStep.run(ctx, new AbortController().signal);

    const keys = readFileSync(layout.envFile, 'utf8')
      .split('\n')
      .map((line) => line.split('=')[0]);

    expect(keys.indexOf('JELLYFIN_API_KEY')).toBe(keys.indexOf('SEERR_API_KEY') + 1);
  });

  it('writes the CPU limit as the Docker cores minus one after the other host keys', async () => {
    ctx.dockerCpus = 6;

    await ensureEnvStep.run(ctx, new AbortController().signal);

    const keys = readFileSync(layout.envFile, 'utf8')
      .split('\n')
      .map((line) => line.split('=')[0]);
    expect(readEnv(layout.envFile).JELLYFIN_CPU_LIMIT).toBe('5');
    expect(keys.indexOf('JELLYFIN_CPU_LIMIT')).toBe(keys.indexOf('MNT_PROPAGATION') + 1);
  });

  it('falls back to one core when Docker reports nothing and nothing was stored', async () => {
    await ensureEnvStep.run(ctx, new AbortController().signal);

    expect(readEnv(layout.envFile).JELLYFIN_CPU_LIMIT).toBe('1');
  });

  it('keeps the stored limit when a later run cannot read the Docker cores', async () => {
    ctx.dockerCpus = 4;
    await ensureEnvStep.run(ctx, new AbortController().signal);
    ctx.dockerCpus = undefined;
    const before = readFileSync(layout.envFile, 'utf8');

    const outcome = await ensureEnvStep.run(ctx, new AbortController().signal);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(readFileSync(layout.envFile, 'utf8')).toBe(before);
  });

  it('rewrites only the limit when the Docker cores change and is stable otherwise', async () => {
    ctx.dockerCpus = 4;
    await ensureEnvStep.run(ctx, new AbortController().signal);
    expect((await ensureEnvStep.run(ctx, new AbortController().signal)).status).toBe('unchanged');
    ctx.dockerCpus = 8;

    const outcome = await ensureEnvStep.run(ctx, new AbortController().signal);

    expect(outcome).toEqual({ status: 'changed', detail: 'updated JELLYFIN_CPU_LIMIT' });
    expect(readEnv(layout.envFile).JELLYFIN_CPU_LIMIT).toBe('7');
  });

  describe('cleared optional secrets', () => {
    const withOpenSubtitles = {
      opensubtitlesUsername: 'subs',
      opensubtitlesPassword: 'subs-pass',
    };

    it('keeps the optional keys when the secrets do not mention them', async () => {
      ctx.secrets = { ...ctx.secrets, ...withOpenSubtitles };
      await ensureEnvStep.run(ctx, new AbortController().signal);
      ctx.secrets = { rdApiToken: 'rd-token', adminUsername: 'Admin', adminPassword: 'p@ss word' };

      const outcome = await ensureEnvStep.run(ctx, new AbortController().signal);

      expect(outcome).toEqual({ status: 'unchanged' });
      expect(readEnv(layout.envFile)).toMatchObject({
        OPENSUBTITLES_USERNAME: 'subs',
        OPENSUBTITLES_PASSWORD: 'subs-pass',
      });
    });

    it('removes the keys listed as cleared and reports them by name', async () => {
      ctx.secrets = { ...ctx.secrets, ...withOpenSubtitles };
      await ensureEnvStep.run(ctx, new AbortController().signal);
      ctx.secrets = {
        rdApiToken: 'rd-token',
        adminUsername: 'Admin',
        adminPassword: 'p@ss word',
        clearedSecrets: ['OPENSUBTITLES_USERNAME', 'OPENSUBTITLES_PASSWORD'],
      };

      const outcome = await ensureEnvStep.run(ctx, new AbortController().signal);

      expect(outcome).toEqual({
        status: 'changed',
        detail: 'removed OPENSUBTITLES_PASSWORD, OPENSUBTITLES_USERNAME',
      });
      const env = readEnv(layout.envFile);
      expect(env).not.toHaveProperty('OPENSUBTITLES_USERNAME');
      expect(env).not.toHaveProperty('OPENSUBTITLES_PASSWORD');
      expect(env.RD_API_TOKEN).toBe('rd-token');
    });

    it('is unchanged when the cleared keys are already absent', async () => {
      await ensureEnvStep.run(ctx, new AbortController().signal);
      ctx.secrets = { ...ctx.secrets, clearedSecrets: ['OPENSUBTITLES_USERNAME'] };

      const outcome = await ensureEnvStep.run(ctx, new AbortController().signal);

      expect(outcome).toEqual({ status: 'unchanged' });
    });
  });
});

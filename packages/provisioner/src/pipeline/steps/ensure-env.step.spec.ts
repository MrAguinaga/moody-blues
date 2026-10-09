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
});

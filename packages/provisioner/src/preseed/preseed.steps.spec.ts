import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout, ensureHostTree, type MbHomeLayout } from '../home';
import { runPipeline } from '../pipeline/pipeline.runner';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { PRESEED_STEPS } from './preseed.steps';
import { SeedConflictError } from './seed-file';

const identity = { puid: 1000, pgid: 1000 };
const secrets = { rdApiToken: 'rd-token', adminUsername: 'admin', adminPassword: 'p@ss word' };
const ENV = [
  'SONARR_API_KEY=sonarr-key',
  'RADARR_API_KEY=radarr-key',
  'PROWLARR_API_KEY=prowlarr-key',
  'BAZARR_API_KEY=bazarrkey',
  'DECYPHARR_API_TOKEN=decypharr-token',
  'SEERR_API_KEY=seerr-key',
  '',
].join('\n');

describe('PRESEED_STEPS', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-preseed-'));
    layout = createLayout(join(sandbox, 'home'));
    ensureHostTree(layout, identity, { runAsRoot: false });
    writeFileSync(layout.envFile, ENV);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function context(): ProvisionContext {
    return {
      config: createDefaultConfig({ host: identity }),
      secrets,
      layout,
      identity,
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
    };
  }

  it('declares the three steps in order for setup and reset', () => {
    expect(PRESEED_STEPS.map((step) => [step.id, step.scopes.join(',')])).toEqual([
      ['seed-arr-config', 'setup,reset'],
      ['seed-bazarr-config', 'setup,reset'],
      ['seed-decypharr-config', 'setup,reset'],
    ]);
  });

  it('writes every file privately on the first run and reports unchanged on the second', async () => {
    const first = await runPipeline(PRESEED_STEPS, context(), { scope: 'setup' });
    expect(first.success).toBe(true);
    expect(first.steps.map((step) => step.status)).toEqual(['changed', 'changed', 'changed']);

    const files = [
      join(layout.configFor('sonarr'), 'config.xml'),
      join(layout.configFor('radarr'), 'config.xml'),
      join(layout.configFor('prowlarr'), 'config.xml'),
      join(layout.configFor('bazarr'), 'config', 'config.yaml'),
      join(layout.configFor('decypharr'), 'config.json'),
      join(layout.configFor('decypharr'), 'auth.json'),
    ];
    for (const file of files) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    const before = files.map((file) => readFileSync(file, 'utf8'));
    expect(before[0]).toContain('<ApiKey>sonarr-key</ApiKey>');

    const second = await runPipeline(PRESEED_STEPS, context(), { scope: 'setup' });
    expect(second.success).toBe(true);
    expect(second.steps.map((step) => step.status)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
    expect(files.map((file) => readFileSync(file, 'utf8'))).toEqual(before);
  });

  it('generates distinct random secrets for Decypharr', async () => {
    await runPipeline(PRESEED_STEPS, context(), { scope: 'setup' });

    const config = JSON.parse(
      readFileSync(join(layout.configFor('decypharr'), 'config.json'), 'utf8'),
    );
    expect(config.session_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(config.strm.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(config.session_secret).not.toBe(config.strm.secret);
  });

  it('seeds OpenSubtitles credentials into Bazarr when both are present', async () => {
    const ctx = {
      ...context(),
      secrets: { ...secrets, opensubtitlesUsername: 'u', opensubtitlesPassword: 'p' },
    };

    await runPipeline(PRESEED_STEPS, ctx, { scope: 'setup' });

    const yaml = readFileSync(join(layout.configFor('bazarr'), 'config', 'config.yaml'), 'utf8');
    expect(yaml).toContain('opensubtitlescom');
  });

  it('fails with a conflict when a file holds another key', async () => {
    writeFileSync(
      join(layout.configFor('sonarr'), 'config.xml'),
      '<Config><ApiKey>other</ApiKey></Config>',
    );

    const report = await runPipeline(PRESEED_STEPS, context(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('reset --fresh');
    expect(new SeedConflictError('x', 'y')).toBeInstanceOf(Error);
  });

  it('fails clearly when the environment file lacks the service keys', async () => {
    writeFileSync(layout.envFile, 'SONARR_API_KEY=sonarr-key\n');

    const report = await runPipeline(PRESEED_STEPS, context(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Missing service keys');
  });
});

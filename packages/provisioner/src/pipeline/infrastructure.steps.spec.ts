import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '../config';
import { caddyfilePath } from '../gateway';
import { createLayout } from '../home';
import { parseEnvFile, readState } from '../state';
import { INFRASTRUCTURE_STEPS } from './infrastructure.steps';
import { runPipeline } from './pipeline.runner';
import type { ContainerRuntime, PipelineReport, ProvisionContext } from './pipeline.types';

const identity = { puid: 1000, pgid: 1000 };
const secrets = { rdApiToken: 'rd-token', adminUsername: 'admin', adminPassword: 'p@ss word' };

function statuses(report: PipelineReport): Record<string, string> {
  return Object.fromEntries(report.steps.map((step) => [step.id, step.status]));
}

describe('INFRASTRUCTURE_STEPS', () => {
  let sandbox: string;
  let runtime: ContainerRuntime;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-pipeline-'));
    runtime = {
      up: vi.fn(async () => undefined),
      waitHealthy: vi.fn(async () => undefined),
      reloadGateway: vi.fn(async () => undefined),
    };
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function createContext(overrides: Partial<ProvisionContext> = {}): ProvisionContext {
    return {
      config: createDefaultConfig({ host: identity }),
      secrets,
      layout: createLayout(join(sandbox, 'home')),
      identity,
      runtime,
      flags: new Map(),
      cliVersion: '9.9.9',
      ...overrides,
    };
  }

  it('declares the infrastructure steps in order with their scopes', () => {
    expect(INFRASTRUCTURE_STEPS.map((step) => [step.id, step.scopes.join(',')])).toEqual([
      ['host-tree', 'setup,reset'],
      ['persist-state', 'setup,reset,config'],
      ['ensure-env', 'setup,reset,config'],
      ['gateway-config', 'setup,reset,config,update'],
      ['containers-up', 'setup,reset,config,update'],
      ['wait-healthy', 'setup,reset,config,update'],
      ['gateway-reload', 'setup,config,update'],
    ]);
  });

  it('provisions a clean home on the first setup run', async () => {
    const ctx = createContext();

    const report = await runPipeline(INFRASTRUCTURE_STEPS, ctx, { scope: 'setup' });

    expect(report.success).toBe(true);
    expect(report.steps.map((step) => step.id)).toEqual([
      'host-tree',
      'persist-state',
      'ensure-env',
      'gateway-config',
      'containers-up',
      'wait-healthy',
      'gateway-reload',
    ]);
    expect(statuses(report)).toMatchObject({
      'host-tree': 'changed',
      'persist-state': 'changed',
      'ensure-env': 'changed',
      'gateway-config': 'changed',
    });
    expect(readState(ctx.layout.stateFile)?.provisionedVersion).toBe('9.9.9');
    expect(statSync(ctx.layout.envFile).mode & 0o777).toBe(0o600);
    expect(statSync(caddyfilePath(ctx.layout)).isFile()).toBe(true);

    const env = parseEnvFile(readFileSync(ctx.layout.envFile, 'utf8'));
    expect(env).toMatchObject({
      MB_HOME: ctx.layout.root,
      RD_API_TOKEN: 'rd-token',
      ADMIN_PASSWORD: 'p@ss word',
      COMPOSE_PROFILES: '',
    });
    expect(env.SONARR_API_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(runtime.up).toHaveBeenCalledOnce();
    expect(runtime.waitHealthy).toHaveBeenCalledOnce();
    expect(runtime.reloadGateway).toHaveBeenCalledOnce();
  });

  it('reports unchanged for every file step on a second run and keeps the generated keys', async () => {
    const ctx = createContext();
    await runPipeline(INFRASTRUCTURE_STEPS, ctx, { scope: 'setup' });
    const firstEnv = readFileSync(ctx.layout.envFile, 'utf8');

    const report = await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'setup' });

    expect(report.success).toBe(true);
    expect(statuses(report)).toMatchObject({
      'host-tree': 'unchanged',
      'persist-state': 'unchanged',
      'ensure-env': 'unchanged',
      'gateway-config': 'unchanged',
    });
    expect(readFileSync(ctx.layout.envFile, 'utf8')).toBe(firstEnv);
  });

  it('keeps unknown keys and existing service keys when merging the environment file', async () => {
    const ctx = createContext();
    await runPipeline(INFRASTRUCTURE_STEPS, ctx, { scope: 'setup' });
    const generated = parseEnvFile(readFileSync(ctx.layout.envFile, 'utf8'));
    writeFileSync(
      ctx.layout.envFile,
      `${readFileSync(ctx.layout.envFile, 'utf8')}CUSTOM_FLAG=keep-me\n`,
    );

    const report = await runPipeline(
      INFRASTRUCTURE_STEPS,
      createContext({ secrets: { ...secrets, adminPassword: 'rotated' } }),
      { scope: 'setup' },
    );

    const merged = parseEnvFile(readFileSync(ctx.layout.envFile, 'utf8'));
    expect(statuses(report)['ensure-env']).toBe('changed');
    expect(report.steps.find((step) => step.id === 'ensure-env')?.detail).toBe(
      'updated ADMIN_PASSWORD',
    );
    expect(merged.CUSTOM_FLAG).toBe('keep-me');
    expect(merged.ADMIN_PASSWORD).toBe('rotated');
    expect(merged.SONARR_API_KEY).toBe(generated.SONARR_API_KEY);
    expect(merged.DECYPHARR_API_TOKEN).toBe(generated.DECYPHARR_API_TOKEN);
  });

  it('enables the storage profile in the environment when the configuration asks for it', async () => {
    const ctx = createContext({
      config: createDefaultConfig({ host: identity, storage: { enabled: true } }),
    });

    await runPipeline(INFRASTRUCTURE_STEPS, ctx, { scope: 'setup' });

    const env = parseEnvFile(readFileSync(ctx.layout.envFile, 'utf8'));
    expect(env).toMatchObject({ COMPOSE_PROFILES: 'storage', MNT_PROPAGATION: 'rslave' });
  });

  it('rewrites the state when the CLI version changes', async () => {
    await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'setup' });

    const report = await runPipeline(
      INFRASTRUCTURE_STEPS,
      createContext({ cliVersion: '10.0.0' }),
      {
        scope: 'setup',
      },
    );

    expect(statuses(report)['persist-state']).toBe('changed');
    expect(readState(createLayout(join(sandbox, 'home')).stateFile)?.provisionedVersion).toBe(
      '10.0.0',
    );
  });

  it('reloads the gateway when a repeated setup changes the Caddyfile', async () => {
    await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'setup' });
    vi.mocked(runtime.reloadGateway).mockClear();

    const unchanged = await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'setup' });
    expect(statuses(unchanged)['gateway-reload']).toBe('skipped');
    expect(runtime.reloadGateway).not.toHaveBeenCalled();

    const changed = await runPipeline(
      INFRASTRUCTURE_STEPS,
      createContext({
        config: createDefaultConfig({
          host: identity,
          mode: 'remote',
          domain: 'example.com',
        }),
      }),
      { scope: 'setup' },
    );
    expect(statuses(changed)['gateway-reload']).toBe('changed');
    expect(runtime.reloadGateway).toHaveBeenCalledOnce();
  });

  it('reloads the gateway in config scope only when the Caddyfile changed', async () => {
    await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'setup' });
    vi.mocked(runtime.reloadGateway).mockClear();

    const unchanged = await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'config' });
    expect(statuses(unchanged)['gateway-reload']).toBe('skipped');
    expect(runtime.reloadGateway).not.toHaveBeenCalled();

    const changed = await runPipeline(
      INFRASTRUCTURE_STEPS,
      createContext({
        config: createDefaultConfig({
          host: identity,
          mode: 'remote',
          domain: 'example.com',
        }),
      }),
      { scope: 'config' },
    );
    expect(statuses(changed)['gateway-reload']).toBe('changed');
    expect(runtime.reloadGateway).toHaveBeenCalledOnce();
  });

  it('fails the pipeline when the runtime fails to start the containers', async () => {
    vi.mocked(runtime.up).mockRejectedValue(new Error('docker compose up failed'));

    const report = await runPipeline(INFRASTRUCTURE_STEPS, createContext(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toBe('Start containers failed: docker compose up failed');
    expect(runtime.waitHealthy).not.toHaveBeenCalled();
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultConfig,
  createLayout,
  type ProvisionStep,
  writeEnv,
  writeState,
} from '@moody-blues/provisioner';

import type { ConfigDeps } from '../config';
import { buildStackStatus, type HardwareProbe } from '../docker';
import { createConfigCommand, executeConfig } from './config.command';

describe('config command', () => {
  let home: string;
  let output: string[];
  let errors: string[];

  const settings = (patch: Partial<Parameters<typeof executeConfig>[0]> = {}) => ({
    home,
    yes: false,
    mode: 'headless' as const,
    version: '0.0.0',
    ...patch,
  });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mb-config-'));
    const layout = createLayout(home);
    writeState(
      layout.stateFile,
      createDefaultConfig({ transcoding: 'cpu', host: { puid: 1000, pgid: 1000 } }),
    );
    writeEnv(layout.envFile, { MB_HOME: home });
    output = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      output.push(message);
    });
    vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it('declares the optional arguments and the home option', () => {
    const command = createConfigCommand('0.0.0');

    expect(command.registeredArguments.map((argument) => argument.name())).toEqual([
      'key',
      'value',
    ]);
    expect(command.registeredArguments.every((argument) => !argument.required)).toBe(true);
    expect(command.options.map((option) => option.long)).toEqual(['--home']);
  });

  it('prints every setting without arguments', async () => {
    await executeConfig(settings());

    expect(output).toEqual([
      'Moody Blues CLI v0.0.0 — Configuration',
      '  transcoding  cpu    off | cpu | hardware',
      '  quality-cap  1080p  read-only in this version (4K arrives in 0.2.0)',
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints a single setting with its key', async () => {
    await executeConfig(settings({ key: 'transcoding' }));

    expect(output).toEqual([
      'Moody Blues CLI v0.0.0 — Configuration',
      '  transcoding  cpu  off | cpu | hardware',
    ]);
  });

  it('prints valid JSON with --json', async () => {
    await executeConfig(settings({ mode: 'json' }));

    expect(JSON.parse(output.join('\n'))).toEqual({
      settings: [
        { key: 'transcoding', value: 'cpu', allowed: ['off', 'cpu', 'hardware'], writable: true },
        { key: 'quality-cap', value: '1080p', allowed: ['1080p'], writable: false },
      ],
    });
  });

  it('fails with the allowed settings on an unknown key before reading the installation', async () => {
    await executeConfig(settings({ home: join(home, 'missing'), key: 'mode', value: 'remote' }));

    expect(errors[0]).toMatch(
      /Unknown setting "mode"\. Available settings: transcoding, quality-cap\./,
    );
    expect(process.exitCode).toBe(1);
  });

  it('fails with the allowed values on an invalid value before reading the installation', async () => {
    await executeConfig(
      settings({ home: join(home, 'missing'), key: 'transcoding', value: 'gpu' }),
    );

    expect(errors[0]).toMatch(/Allowed values: off, cpu, hardware\./);
    expect(process.exitCode).toBe(1);
  });

  it('rejects another quality cap with the reason', async () => {
    await executeConfig(settings({ key: 'quality-cap', value: '2160p' }));

    expect(errors[0]).toMatch(/Only 1080p is available/);
    expect(process.exitCode).toBe(1);
  });

  it('fails when the installation is missing', async () => {
    await executeConfig(settings({ home: join(home, 'missing') }));

    expect(errors[0]).toMatch(/not set up yet/);
    expect(process.exitCode).toBe(1);
  });

  describe('changing a setting', () => {
    const noGpu: HardwareProbe = { renderDeviceGid: () => undefined, hasExecutable: () => false };
    const nvidia: HardwareProbe = { renderDeviceGid: () => undefined, hasExecutable: () => true };
    let ran: string[];

    const step = (id: string, fail = false): ProvisionStep => ({
      id,
      title: id,
      scopes: ['config'],
      run: async () => {
        ran.push(id);
        if (fail) {
          throw new Error('boom');
        }
        return { status: 'changed' };
      },
    });

    const deps = (probe: HardwareProbe = noGpu, failing?: string): Partial<ConfigDeps> => ({
      probe,
      createRunner: () => ({
        ps: async () =>
          buildStackStatus(
            'moody-blues',
            ['jellyfin', 'sonarr', 'radarr'].map((service) => ({
              service,
              state: 'running' as const,
              health: 'healthy' as const,
              exitCode: 0,
              publishedPorts: [],
            })),
          ),
      }),
      createRuntime: () => ({
        up: async () => undefined,
        waitHealthy: async () => undefined,
        reloadGateway: async () => undefined,
      }),
      pipeline: [
        'persist-state',
        'containers-up',
        'wait-healthy',
        'jellyfin-transcoding',
        'master-profile',
      ].map((id) => step(id, id === failing)),
    });

    const withSecrets = () => {
      writeEnv(createLayout(home).envFile, {
        MB_HOME: home,
        RD_API_TOKEN: 'rd-test-token',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'test-password',
      });
    };

    beforeEach(() => {
      ran = [];
      withSecrets();
    });

    it('prints the plan and the steps and exits with 0', async () => {
      await executeConfig(settings({ key: 'transcoding', value: 'off', deps: deps() }));

      expect(ran).toEqual(['persist-state', 'jellyfin-transcoding']);
      expect(output[0]).toBe('Moody Blues CLI v0.0.0 — Config (Headless)');
      expect(output).toContain('transcoding: cpu -> off');
      expect(output).toContain('Affected steps: persist-state, jellyfin-transcoding');
      expect(output.at(-1)).toBe('✔ transcoding is now "off".');
      expect(process.exitCode).toBe(0);
    });

    it('prints the report as JSON without the plan lines', async () => {
      await executeConfig(
        settings({ key: 'transcoding', value: 'off', mode: 'json', deps: deps() }),
      );

      const report = JSON.parse(output.join('\n'));
      expect(report).toMatchObject({
        success: true,
        key: 'transcoding',
        previous: 'cpu',
        value: 'off',
        changed: true,
        steps: ['persist-state', 'jellyfin-transcoding'],
        pipeline: { scope: 'config', success: true },
      });
    });

    it('exits with 1 and the recovery hint when a step fails', async () => {
      await executeConfig(
        settings({ key: 'transcoding', value: 'off', deps: deps(noGpu, 'jellyfin-transcoding') }),
      );

      expect(errors[0]).toMatch(/jellyfin-transcoding failed: boom/);
      expect(errors[0]).toMatch(/Repeat the same command.*set transcoding back to "cpu"/);
      expect(process.exitCode).toBe(1);
    });

    it('refuses a disruptive change without --yes, runs nothing and exits with 1', async () => {
      await executeConfig(settings({ key: 'transcoding', value: 'hardware', deps: deps(nvidia) }));

      expect(ran).toEqual([]);
      expect(output).toContain(
        'Affected steps: persist-state, containers-up, wait-healthy, jellyfin-transcoding',
      );
      expect(errors[0]).toMatch(/Jellyfin will be recreated.*Pass --yes/);
      expect(process.exitCode).toBe(1);
    });

    it('describes the refused change in JSON', async () => {
      await executeConfig(
        settings({ key: 'transcoding', value: 'hardware', mode: 'json', deps: deps(nvidia) }),
      );

      expect(JSON.parse(output.join('\n'))).toMatchObject({
        success: false,
        steps: expect.any(Array),
      });
      expect(ran).toEqual([]);
      expect(process.exitCode).toBe(1);
    });

    it('applies a disruptive change with --yes', async () => {
      await executeConfig(
        settings({ key: 'transcoding', value: 'hardware', yes: true, deps: deps(nvidia) }),
      );

      expect(ran).toEqual([
        'persist-state',
        'containers-up',
        'wait-healthy',
        'jellyfin-transcoding',
      ]);
      expect(process.exitCode).toBe(0);
    });

    it('rejects hardware without a GPU before running anything', async () => {
      await executeConfig(
        settings({ key: 'transcoding', value: 'hardware', yes: true, deps: deps() }),
      );

      expect(ran).toEqual([]);
      expect(errors[0]).toMatch(/no GPU was found/);
      expect(process.exitCode).toBe(1);
    });
  });
});

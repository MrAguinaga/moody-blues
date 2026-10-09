import { describe, expect, it, vi } from 'vitest';

import {
  type ContainerRuntime,
  createDefaultConfig,
  createLayout,
  type MoodyBluesConfig,
  type ProvisionContext,
  type ProvisionStep,
  type TranscodingMode,
} from '@moody-blues/provisioner';

import { buildStackStatus, type HardwareProbe, type ServiceStatus } from '../docker';
import type { Installation } from '../installation';
import {
  type ConfigChangeOptions,
  type ConfigDecision,
  type ConfigDeps,
  runConfigChange,
} from './config.service';

const ENV = {
  MB_HOME: '/srv/moody-blues',
  RD_API_TOKEN: 'rd-test-token',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'test-password',
};
const SERVICES = ['jellyfin', 'sonarr', 'radarr', 'caddy'];
const PIPELINE_IDS = [
  'host-tree',
  'persist-state',
  'ensure-env',
  'seed-arr-config',
  'containers-up',
  'wait-healthy',
  'master-profile',
  'jellyfin-transcoding',
];

const noGpu: HardwareProbe = { renderDeviceGid: () => undefined, hasExecutable: () => false };
const nvidia: HardwareProbe = { renderDeviceGid: () => undefined, hasExecutable: () => true };

const service = (name: string, overrides: Partial<ServiceStatus> = {}): ServiceStatus => ({
  service: name,
  state: 'running',
  health: 'healthy',
  exitCode: 0,
  publishedPorts: [],
  ...overrides,
});

interface Harness {
  options: ConfigChangeOptions;
  executed: { id: string; transcoding: TranscodingMode; hardware: ProvisionContext['hardware'] }[];
  loaded: Installation;
  runtime: ContainerRuntime;
  ps: ReturnType<typeof vi.fn>;
}

function harness(
  current: Partial<MoodyBluesConfig> = {},
  services: ServiceStatus[] = SERVICES.map((name) => service(name)),
  overrides: Partial<ConfigChangeOptions> & { probe?: HardwareProbe; failAt?: string } = {},
): Harness {
  const { probe = noGpu, failAt, ...optionOverrides } = overrides;
  const executed: Harness['executed'] = [];
  const pipeline: ProvisionStep[] = PIPELINE_IDS.map((id) => ({
    id,
    title: id,
    scopes: id === 'host-tree' || id === 'seed-arr-config' ? ['setup'] : ['setup', 'config'],
    run: async (ctx) => {
      executed.push({ id, transcoding: ctx.config.transcoding, hardware: ctx.hardware });
      if (id === failAt) {
        throw new Error('boom');
      }
      return { status: 'unchanged' };
    },
  }));
  const loaded: Installation = {
    layout: createLayout('/srv/moody-blues'),
    config: createDefaultConfig(current),
    env: ENV,
  };
  const runtime: ContainerRuntime = {
    up: async () => undefined,
    waitHealthy: async () => undefined,
    reloadGateway: async () => undefined,
  };
  const ps = vi.fn(async () => buildStackStatus('moody-blues', services));
  const deps: Partial<ConfigDeps> = {
    load: () => loaded,
    createRunner: () => ({ ps }),
    createRuntime: () => runtime,
    probe,
    pipeline,
  };

  return {
    executed,
    loaded,
    runtime,
    ps,
    options: {
      key: 'transcoding',
      value: 'cpu',
      cliVersion: '0.0.0',
      signal: new AbortController().signal,
      deps,
      ...optionOverrides,
    },
  };
}

const ids = (h: Harness) => h.executed.map((entry) => entry.id);

describe('runConfigChange', () => {
  it('runs only persist-state and jellyfin-transcoding for a transcoding change without hardware', async () => {
    const h = harness({ transcoding: 'off' });

    const outcome = await runConfigChange(h.options);

    expect(ids(h)).toEqual(['persist-state', 'jellyfin-transcoding']);
    expect(outcome).toMatchObject({
      kind: 'applied',
      report: {
        success: true,
        key: 'transcoding',
        previous: 'off',
        value: 'cpu',
        changed: true,
        steps: ['persist-state', 'jellyfin-transcoding'],
      },
    });
  });

  it('runs the steps with the new value in the configuration', async () => {
    const h = harness({ transcoding: 'off' });

    await runConfigChange(h.options);

    expect(h.executed.every((entry) => entry.transcoding === 'cpu')).toBe(true);
    expect(h.loaded.config.transcoding).toBe('off');
  });

  it('reapplies the same value and reports no change', async () => {
    const h = harness({ transcoding: 'off' });

    const outcome = await runConfigChange({ ...h.options, value: 'off' });

    expect(ids(h)).toEqual(['persist-state', 'jellyfin-transcoding']);
    expect(outcome).toMatchObject({ kind: 'applied', report: { changed: false, success: true } });
  });

  it('reapplies the master profile for quality-cap', async () => {
    const h = harness();

    await runConfigChange({ ...h.options, key: 'quality-cap', value: '1080p' });

    expect(ids(h)).toEqual(['persist-state', 'master-profile']);
  });

  it('reports a failing step and stops there', async () => {
    const h = harness({ transcoding: 'off' }, undefined, { failAt: 'persist-state' });

    const outcome = await runConfigChange(h.options);

    expect(ids(h)).toEqual(['persist-state']);
    expect(outcome).toMatchObject({
      kind: 'applied',
      report: { success: false, pipeline: { error: 'persist-state failed: boom' } },
    });
  });

  it('adds the off note to the plan', async () => {
    const h = harness({ transcoding: 'cpu' });
    const onPlan = vi.fn();

    await runConfigChange({ ...h.options, value: 'off', onPlan });

    expect(onPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: [expect.stringMatching(/remux and audio transcoding are allowed/)],
      }),
    );
  });

  describe('preconditions', () => {
    it('runs nothing when Jellyfin is not running', async () => {
      const h = harness(
        {},
        SERVICES.map((name) =>
          name === 'jellyfin' ? service(name, { state: 'exited', health: 'none' }) : service(name),
        ),
      );
      const onPlan = vi.fn();

      await expect(runConfigChange({ ...h.options, onPlan })).rejects.toThrow(
        /"jellyfin" is not running and healthy \(exited, health none\)\. Start the stack with "moody-blues start" or diagnose it with "moody-blues doctor"\./,
      );
      expect(h.executed).toEqual([]);
      expect(onPlan).not.toHaveBeenCalled();
    });

    it('reports a missing service as not running', async () => {
      const h = harness({}, []);

      await expect(runConfigChange(h.options)).rejects.toThrow(/"jellyfin".*not found/);
      expect(h.executed).toEqual([]);
    });

    it('requires Sonarr and Radarr for quality-cap', async () => {
      const h = harness(
        {},
        SERVICES.map((name) =>
          name === 'radarr' ? service(name, { health: 'unhealthy' }) : service(name),
        ),
      );

      await expect(
        runConfigChange({ ...h.options, key: 'quality-cap', value: '1080p' }),
      ).rejects.toThrow(/"radarr" is not running and healthy/);
      expect(h.executed).toEqual([]);
    });

    it('rejects hardware without a GPU using the message of the check and writes nothing', async () => {
      const h = harness({ transcoding: 'off' });

      await expect(
        runConfigChange({ ...h.options, value: 'hardware', confirm: async () => 'approved' }),
      ).rejects.toThrow(
        /Hardware transcoding is selected but no GPU was found.*Choose "cpu" or "off"/,
      );
      expect(h.executed).toEqual([]);
      expect(h.ps).not.toHaveBeenCalled();
    });

    it('warns about cpu without a GPU and continues', async () => {
      const h = harness({ transcoding: 'off' });
      const onPlan = vi.fn();

      await runConfigChange({ ...h.options, onPlan });

      expect(onPlan).toHaveBeenCalledWith(
        expect.objectContaining({ notes: [expect.stringMatching(/the CPU may saturate/)] }),
      );
      expect(ids(h)).toEqual(['persist-state', 'jellyfin-transcoding']);
    });
  });

  describe('crossing hardware', () => {
    it('declines to run without a way to confirm', async () => {
      const h = harness({ transcoding: 'off' }, undefined, { probe: nvidia });

      const outcome = await runConfigChange({ ...h.options, value: 'hardware' });

      expect(outcome.kind).toBe('unconfirmed');
      expect(h.executed).toEqual([]);
    });

    it('does not run when the confirmation is unavailable or declined', async () => {
      for (const decision of ['unavailable', 'declined'] as ConfigDecision[]) {
        const h = harness({ transcoding: 'off' }, undefined, { probe: nvidia });

        const outcome = await runConfigChange({
          ...h.options,
          value: 'hardware',
          confirm: async () => decision,
        });

        expect(outcome.kind).toBe(decision === 'declined' ? 'declined' : 'unconfirmed');
        expect(h.executed).toEqual([]);
      }
    });

    it('recreates Jellyfin once approved and detects the accelerator', async () => {
      const h = harness({ transcoding: 'off' }, [], { probe: nvidia });
      const confirm = vi.fn(async (): Promise<ConfigDecision> => 'approved');

      const outcome = await runConfigChange({ ...h.options, value: 'hardware', confirm });

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          disruptive: true,
          disruption: expect.stringMatching(/Jellyfin will be recreated/),
        }),
      );
      expect(ids(h)).toEqual([
        'persist-state',
        'containers-up',
        'wait-healthy',
        'jellyfin-transcoding',
      ]);
      expect(h.executed.every((entry) => entry.hardware === 'nvidia')).toBe(true);
      expect(outcome.kind).toBe('applied');
    });

    it('does not need a running stack to leave hardware', async () => {
      const h = harness({ transcoding: 'hardware' }, []);

      await runConfigChange({ ...h.options, value: 'off', confirm: async () => 'approved' });

      expect(ids(h)).toContain('containers-up');
      expect(h.executed.every((entry) => entry.hardware === undefined)).toBe(true);
    });

    it('never asks for confirmation on an in-place change', async () => {
      const h = harness({ transcoding: 'off' });
      const confirm = vi.fn(async (): Promise<ConfigDecision> => 'approved');

      await runConfigChange({ ...h.options, confirm });

      expect(confirm).not.toHaveBeenCalled();
    });
  });

  it('fails before anything else when the saved secrets are incomplete', async () => {
    const h = harness();
    h.loaded.env = { MB_HOME: '/srv/moody-blues' };

    await expect(runConfigChange(h.options)).rejects.toThrow(/saved secrets.*are incomplete/s);
    expect(h.ps).not.toHaveBeenCalled();
    expect(h.executed).toEqual([]);
  });
});

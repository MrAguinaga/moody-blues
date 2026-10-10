import { describe, expect, it, vi } from 'vitest';

import {
  type ContainerRuntime,
  createDefaultConfig,
  createLayout,
  type ProvisionStep,
} from '@moody-blues/provisioner';

import type { Installation } from '../installation';
import { type RedeployDeps, runRedeploy } from './update.redeploy';

const ENV = {
  MB_HOME: '/srv/moody-blues',
  RD_API_TOKEN: 'rd-test-token',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'test-password',
};

const runtime: ContainerRuntime = {
  up: async () => undefined,
  waitHealthy: async () => undefined,
  reloadGateway: async () => undefined,
};

function harness(
  overrides: { env?: Record<string, string>; pull?: () => Promise<void>; failAt?: string } = {},
) {
  const order: string[] = [];
  const pipeline: ProvisionStep[] = ['containers-up', 'master-profile'].map((id) => ({
    id,
    title: id,
    scopes: ['setup'],
    run: async (ctx) => {
      order.push(`${id}@${ctx.cliVersion}`);
      if (id === overrides.failAt) {
        throw new Error('boom');
      }
      return { status: 'unchanged' };
    },
  }));
  const installation: Installation = {
    layout: createLayout('/srv/moody-blues'),
    config: createDefaultConfig(),
    env: overrides.env ?? ENV,
  };
  const pull = vi.fn(async () => {
    order.push('pull');
    await overrides.pull?.();
  });
  const deps: Partial<RedeployDeps> = {
    load: () => installation,
    createRunner: () => ({ pull }),
    createRuntime: () => runtime,
    detectCpus: async () => 2,
    pipeline,
  };
  return { deps, order, pull };
}

describe('runRedeploy', () => {
  it('pulls the images, then runs the setup pipeline with the installed code version', async () => {
    const { deps, order } = harness();
    const stages: string[] = [];

    const report = await runRedeploy({
      cliVersion: '0.2.0',
      signal: new AbortController().signal,
      deps,
      onStage: (message) => stages.push(message),
    });

    expect(report).toMatchObject({ success: true, aborted: false, pulled: true });
    expect(order).toEqual(['pull', 'containers-up@0.2.0', 'master-profile@0.2.0']);
    expect(stages).toHaveLength(2);
  });

  it('stops before the pipeline when the pull fails', async () => {
    const { deps, order } = harness({
      pull: async () => {
        throw new Error('registry unreachable');
      },
    });

    const report = await runRedeploy({
      cliVersion: '0.2.0',
      signal: new AbortController().signal,
      deps,
    });

    expect(report).toEqual({
      success: false,
      aborted: false,
      pulled: false,
      error: 'registry unreachable',
    });
    expect(order).toEqual(['pull']);
  });

  it('reports a failing pipeline step', async () => {
    const { deps } = harness({ failAt: 'master-profile' });

    const report = await runRedeploy({
      cliVersion: '0.2.0',
      signal: new AbortController().signal,
      deps,
    });

    expect(report.success).toBe(false);
    expect(report.pulled).toBe(true);
    expect(report.error).toContain('boom');
  });

  it('reports an interruption during the pull', async () => {
    const controller = new AbortController();
    const { deps } = harness({
      pull: async () => {
        controller.abort();
        throw new Error('killed');
      },
    });

    const report = await runRedeploy({ cliVersion: '0.2.0', signal: controller.signal, deps });

    expect(report).toMatchObject({ success: false, aborted: true });
  });

  it('asks for the setup when the saved secrets are incomplete', async () => {
    const { deps } = harness({ env: { MB_HOME: '/srv/moody-blues' } });

    await expect(
      runRedeploy({ cliVersion: '0.2.0', signal: new AbortController().signal, deps }),
    ).rejects.toThrow('moody-blues setup');
  });
});

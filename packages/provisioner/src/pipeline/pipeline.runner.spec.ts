import { describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '../config';
import { createLayout } from '../home';
import { runPipeline } from './pipeline.runner';
import type {
  ContainerRuntime,
  PipelineEvent,
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
} from './pipeline.types';

function createContext(): ProvisionContext {
  const runtime: ContainerRuntime = {
    up: vi.fn(),
    waitHealthy: vi.fn(),
    reloadGateway: vi.fn(),
  };
  return {
    config: createDefaultConfig({ host: { puid: 1000, pgid: 1000 } }),
    secrets: { rdApiToken: 'token', adminUsername: 'admin', adminPassword: 'secret' },
    layout: createLayout('/unused'),
    identity: { puid: 1000, pgid: 1000 },
    runtime,
    flags: new Map(),
    cliVersion: '0.0.0-test',
  };
}

function createStep(
  id: string,
  scopes: ProvisionScope[],
  run: ProvisionStep['run'] = async () => ({ status: 'changed' }),
): ProvisionStep {
  return { id, title: `Step ${id}`, scopes, run: vi.fn(run) };
}

describe('runPipeline', () => {
  it('runs the steps of the requested scope in declaration order', async () => {
    const order: string[] = [];
    const record =
      (id: string): ProvisionStep['run'] =>
      async () => {
        order.push(id);
        return { status: 'unchanged' };
      };
    const steps = [
      createStep('a', ['setup', 'reset'], record('a')),
      createStep('b', ['config'], record('b')),
      createStep('c', ['setup'], record('c')),
      createStep('d', ['reset', 'setup'], record('d')),
    ];

    const report = await runPipeline(steps, createContext(), { scope: 'setup' });

    expect(order).toEqual(['a', 'c', 'd']);
    expect(report.success).toBe(true);
    expect(report.steps.map((step) => step.id)).toEqual(['a', 'c', 'd']);
    expect(report.steps.every((step) => step.status === 'unchanged')).toBe(true);
  });

  it('emits start, done and failure events with the planned step list', async () => {
    const steps = [
      createStep('ok', ['setup'], async (ctx) => {
        ctx.reportProgress?.('halfway');
        return { status: 'changed', detail: 'wrote 1 file' };
      }),
      createStep('boom', ['setup'], async () => {
        throw new Error('exploded');
      }),
    ];
    const events: PipelineEvent[] = [];

    const report = await runPipeline(steps, createContext(), {
      scope: 'setup',
      onEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.type)).toEqual([
      'pipeline-start',
      'step-start',
      'step-progress',
      'step-done',
      'step-start',
      'step-failed',
    ]);
    expect(events[0]).toMatchObject({
      type: 'pipeline-start',
      steps: [
        { id: 'ok', title: 'Step ok' },
        { id: 'boom', title: 'Step boom' },
      ],
    });
    expect(events[1]).toMatchObject({ type: 'step-start', index: 1, total: 2 });
    expect(events[2]).toMatchObject({ type: 'step-progress', message: 'halfway' });
    expect(events[5]).toMatchObject({ type: 'step-failed', error: 'exploded' });
    expect(report.error).toBe('Step boom failed: exploded');
  });

  it('stops at the first failure and reports the steps executed so far', async () => {
    const never = createStep('never', ['setup']);
    const steps = [
      createStep('first', ['setup']),
      createStep('second', ['setup'], async () => {
        throw new Error('nope');
      }),
      never,
    ];

    const report = await runPipeline(steps, createContext(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.aborted).toBe(false);
    expect(report.steps.map((step) => [step.id, step.status])).toEqual([
      ['first', 'changed'],
      ['second', 'failed'],
    ]);
    expect(report.steps[1]?.detail).toBe('nope');
    expect(never.run).not.toHaveBeenCalled();
  });

  it('does not start any step when the signal is already aborted', async () => {
    const step = createStep('a', ['setup']);
    const controller = new AbortController();
    controller.abort();

    const report = await runPipeline([step], createContext(), {
      scope: 'setup',
      signal: controller.signal,
    });

    expect(report).toMatchObject({ success: false, aborted: true, steps: [] });
    expect(step.run).not.toHaveBeenCalled();
  });

  it('stops between steps when aborted mid-run and forwards the signal to steps', async () => {
    const controller = new AbortController();
    const received: AbortSignal[] = [];
    const steps = [
      createStep('first', ['setup'], async (_ctx, signal) => {
        received.push(signal);
        controller.abort();
        return { status: 'changed' };
      }),
      createStep('second', ['setup']),
    ];

    const report = await runPipeline(steps, createContext(), {
      scope: 'setup',
      signal: controller.signal,
    });

    expect(received[0]).toBe(controller.signal);
    expect(report.aborted).toBe(true);
    expect(report.success).toBe(false);
    expect(report.steps.map((step) => step.id)).toEqual(['first']);
    expect(steps[1]?.run).not.toHaveBeenCalled();
  });

  it('marks a step that throws after an abort as failed and aborted', async () => {
    const controller = new AbortController();
    const steps = [
      createStep('long', ['setup'], async () => {
        controller.abort();
        throw new Error('interrupted');
      }),
    ];

    const report = await runPipeline(steps, createContext(), {
      scope: 'setup',
      signal: controller.signal,
    });

    expect(report).toMatchObject({ success: false, aborted: true });
    expect(report.steps[0]?.status).toBe('failed');
  });

  it('shares the flags map between steps', async () => {
    const steps = [
      createStep('set', ['setup'], async ({ flags }) => {
        flags.set('shared', true);
        return { status: 'changed' };
      }),
      createStep('read', ['setup'], async ({ flags }) => ({
        status: flags.get('shared') ? 'changed' : 'skipped',
      })),
    ];

    const report = await runPipeline(steps, createContext(), { scope: 'setup' });

    expect(report.steps[1]?.status).toBe('changed');
  });
});

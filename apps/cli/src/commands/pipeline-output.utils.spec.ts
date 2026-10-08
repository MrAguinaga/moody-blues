import { describe, expect, it } from 'vitest';

import type { PipelineEvent } from '@moody-blues/provisioner';

import type { StepItemState } from '../ui/components/StepItem';
import { applyPipelineEvent, formatPipelineEvent } from './pipeline-output.utils';

const start: PipelineEvent = {
  type: 'pipeline-start',
  scope: 'setup',
  steps: [
    { id: 'a', title: 'Step A' },
    { id: 'b', title: 'Step B' },
  ],
};

function fold(events: PipelineEvent[]): StepItemState[] {
  return events.reduce<StepItemState[]>((steps, event) => applyPipelineEvent(steps, event), []);
}

describe('applyPipelineEvent', () => {
  it('lists every planned step as pending', () => {
    expect(fold([start]).map((step) => step.status)).toEqual(['pending', 'pending']);
  });

  it('tracks running, progress, done and failed states', () => {
    const steps = fold([
      start,
      { type: 'step-start', id: 'a', title: 'Step A', index: 1, total: 2 },
      { type: 'step-progress', id: 'a', title: 'Step A', message: '1 of 2 healthy' },
    ]);
    expect(steps[0]).toMatchObject({ status: 'running', progress: '1 of 2 healthy' });

    const done = fold([
      start,
      { type: 'step-start', id: 'a', title: 'Step A', index: 1, total: 2 },
      { type: 'step-progress', id: 'a', title: 'Step A', message: 'working' },
      {
        type: 'step-done',
        id: 'a',
        title: 'Step A',
        outcome: { status: 'changed', detail: '2 files' },
        durationMs: 10,
      },
      { type: 'step-start', id: 'b', title: 'Step B', index: 2, total: 2 },
      { type: 'step-failed', id: 'b', title: 'Step B', error: 'boom', durationMs: 5 },
    ]);
    expect(done[0]).toEqual({
      id: 'a',
      title: 'Step A',
      status: 'changed',
      detail: '2 files',
      progress: undefined,
    });
    expect(done[1]).toMatchObject({ status: 'failed', detail: 'boom' });
  });
});

describe('formatPipelineEvent', () => {
  it('prints one start line and one result line per step', () => {
    expect(formatPipelineEvent(start)).toEqual([]);
    expect(
      formatPipelineEvent({ type: 'step-start', id: 'a', title: 'Step A', index: 3, total: 7 }),
    ).toEqual(['[3/7] Step A...']);
    expect(
      formatPipelineEvent({
        type: 'step-done',
        id: 'a',
        title: 'Step A',
        outcome: { status: 'unchanged' },
        durationMs: 1500,
      }),
    ).toEqual(['      ✔ Step A — unchanged [1.5s]']);
    expect(
      formatPipelineEvent({
        type: 'step-failed',
        id: 'a',
        title: 'Step A',
        error: 'boom',
        durationMs: 200,
      }),
    ).toEqual(['      ✖ Step A — boom [0.2s]']);
  });
});

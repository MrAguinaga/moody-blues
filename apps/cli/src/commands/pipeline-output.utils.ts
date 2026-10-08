import type { PipelineEvent } from '@moody-blues/provisioner';

import type { StepItemState } from '../ui/components/StepItem';

function updateStep(
  steps: StepItemState[],
  id: string,
  patch: Partial<StepItemState>,
): StepItemState[] {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step));
}

export function applyPipelineEvent(steps: StepItemState[], event: PipelineEvent): StepItemState[] {
  switch (event.type) {
    case 'pipeline-start':
      return event.steps.map(({ id, title }) => ({ id, title, status: 'pending' }));
    case 'step-start':
      return updateStep(steps, event.id, { status: 'running' });
    case 'step-progress':
      return updateStep(steps, event.id, { progress: event.message });
    case 'step-done':
      return updateStep(steps, event.id, {
        status: event.outcome.status,
        detail: event.outcome.detail,
        progress: undefined,
      });
    case 'step-failed':
      return updateStep(steps, event.id, {
        status: 'failed',
        detail: event.error,
        progress: undefined,
      });
  }
}

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatPipelineEvent(event: PipelineEvent): string[] {
  switch (event.type) {
    case 'pipeline-start':
      return [];
    case 'step-start':
      return [`[${event.index}/${event.total}] ${event.title}...`];
    case 'step-progress':
      return [`      ${event.message}`];
    case 'step-done': {
      const detail = event.outcome.detail ? ` (${event.outcome.detail})` : '';
      return [
        `      ✔ ${event.title} — ${event.outcome.status}${detail} [${formatSeconds(event.durationMs)}]`,
      ];
    }
    case 'step-failed':
      return [`      ✖ ${event.title} — ${event.error} [${formatSeconds(event.durationMs)}]`];
  }
}

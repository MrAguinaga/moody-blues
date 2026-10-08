import type {
  PipelineEvent,
  PipelineReport,
  ProvisionContext,
  ProvisionStep,
  RunPipelineOptions,
  StepResult,
} from './pipeline.types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runPipeline(
  steps: readonly ProvisionStep[],
  ctx: ProvisionContext,
  options: RunPipelineOptions,
): Promise<PipelineReport> {
  const { scope, onEvent } = options;
  const signal = options.signal ?? new AbortController().signal;
  const selected = steps.filter((step) => step.scopes.includes(scope));
  const results: StepResult[] = [];
  const emit = (event: PipelineEvent) => onEvent?.(event);

  emit({
    type: 'pipeline-start',
    scope,
    steps: selected.map(({ id, title }) => ({ id, title })),
  });

  for (const [position, step] of selected.entries()) {
    if (signal.aborted) {
      return { scope, success: false, aborted: true, steps: results, error: 'Pipeline aborted' };
    }

    const { id, title } = step;
    emit({ type: 'step-start', id, title, index: position + 1, total: selected.length });
    const startedAt = Date.now();
    const stepContext: ProvisionContext = {
      ...ctx,
      reportProgress: (message) => emit({ type: 'step-progress', id, title, message }),
    };

    try {
      const outcome = await step.run(stepContext, signal);
      const durationMs = Date.now() - startedAt;
      results.push({ id, title, ...outcome, durationMs });
      emit({ type: 'step-done', id, title, outcome, durationMs });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = errorMessage(error);
      results.push({ id, title, status: 'failed', detail: message, durationMs });
      emit({ type: 'step-failed', id, title, error: message, durationMs });
      return {
        scope,
        success: false,
        aborted: signal.aborted,
        steps: results,
        error: `${title} failed: ${message}`,
      };
    }
  }

  return { scope, success: true, aborted: false, steps: results };
}

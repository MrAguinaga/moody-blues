import type { ProvisionStep } from './pipeline.types';

export function selectConfigSteps(
  pipeline: readonly ProvisionStep[],
  ids: readonly string[],
): ProvisionStep[] {
  return ids.map((id) => {
    const step = pipeline.find((candidate) => candidate.id === id);
    if (!step) {
      throw new Error(`Cannot select step "${id}": it does not exist in the pipeline`);
    }
    if (!step.scopes.includes('config')) {
      throw new Error(`Cannot select step "${id}": it does not run in the config scope`);
    }
    return step;
  });
}

import type { ProvisionStep } from './pipeline.types';

export type InsertPosition = 'before' | 'after';

export function insertSteps(
  steps: readonly ProvisionStep[],
  anchorId: string,
  position: InsertPosition,
  extra: readonly ProvisionStep[],
): ProvisionStep[] {
  const anchor = steps.findIndex((step) => step.id === anchorId);
  if (anchor === -1) {
    throw new Error(`Cannot insert steps: anchor step "${anchorId}" does not exist`);
  }
  const index = position === 'before' ? anchor : anchor + 1;
  return [...steps.slice(0, index), ...extra, ...steps.slice(index)];
}

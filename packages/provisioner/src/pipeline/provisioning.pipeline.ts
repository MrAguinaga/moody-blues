import { PRESEED_STEPS } from '../preseed/preseed.steps';
import { API_STEPS } from './api.steps';
import { insertSteps } from './compose-pipeline';
import { INFRASTRUCTURE_STEPS } from './infrastructure.steps';
import type { ProvisionStep } from './pipeline.types';

export const PROVISIONING_PIPELINE: readonly ProvisionStep[] = [
  ...insertSteps(INFRASTRUCTURE_STEPS, 'containers-up', 'before', PRESEED_STEPS),
  ...API_STEPS,
];

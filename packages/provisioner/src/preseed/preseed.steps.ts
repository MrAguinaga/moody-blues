import type { ProvisionStep } from '../pipeline/pipeline.types';
import { seedArrConfigStep } from './seed-arr-config.step';
import { seedBazarrConfigStep } from './seed-bazarr-config.step';
import { seedDecypharrConfigStep } from './seed-decypharr-config.step';

export const PRESEED_STEPS: readonly ProvisionStep[] = [
  seedArrConfigStep,
  seedBazarrConfigStep,
  seedDecypharrConfigStep,
];

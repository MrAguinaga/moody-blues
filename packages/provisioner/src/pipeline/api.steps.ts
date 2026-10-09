import { ARR_STEPS } from '../arr/arr.steps';
import { masterProfileStep } from '../profile/master-profile.step';
import { prowlarrProvisionStep } from '../prowlarr/prowlarr-provision.step';
import type { ProvisionStep } from './pipeline.types';

export const API_STEPS: readonly ProvisionStep[] = [
  ...ARR_STEPS,
  masterProfileStep,
  prowlarrProvisionStep,
];

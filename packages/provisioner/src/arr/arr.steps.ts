import type { ProvisionStep } from '../pipeline/pipeline.types';
import { radarrProvisionStep } from './radarr-provision.step';
import { sonarrProvisionStep } from './sonarr-provision.step';

export const ARR_STEPS: readonly ProvisionStep[] = [sonarrProvisionStep, radarrProvisionStep];

import type { ProvisionStep } from '../pipeline/pipeline.types';
import { createArrProvisionStep } from './arr.provision';

export const sonarrProvisionStep: ProvisionStep = createArrProvisionStep('sonarr');

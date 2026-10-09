import type { ProvisionStep } from '../pipeline/pipeline.types';
import { createArrProvisionStep } from './arr.provision';

export const radarrProvisionStep: ProvisionStep = createArrProvisionStep('radarr');

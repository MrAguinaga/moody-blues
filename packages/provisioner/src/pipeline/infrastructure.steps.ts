import type { ProvisionStep } from './pipeline.types';
import { containersUpStep } from './steps/containers-up.step';
import { ensureEnvStep } from './steps/ensure-env.step';
import { gatewayConfigStep } from './steps/gateway-config.step';
import { gatewayReloadStep } from './steps/gateway-reload.step';
import { hostTreeStep } from './steps/host-tree.step';
import { persistStateStep } from './steps/persist-state.step';
import { waitHealthyStep } from './steps/wait-healthy.step';

export const INFRASTRUCTURE_STEPS: readonly ProvisionStep[] = [
  hostTreeStep,
  persistStateStep,
  ensureEnvStep,
  gatewayConfigStep,
  containersUpStep,
  waitHealthyStep,
  gatewayReloadStep,
];

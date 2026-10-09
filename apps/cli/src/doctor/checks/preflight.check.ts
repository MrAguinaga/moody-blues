import {
  type CheckDefinition,
  type CheckResult,
  composeCheck,
  diskSpaceCheck,
  dnsCheck,
  dockerCheck,
  fuseCheck,
  portsCheck,
  transcodingCheck,
} from '../../checks';
import type { DoctorCheck, DoctorCheckId, DoctorOutcome, DoctorStatus } from '../doctor.types';
import { skipped, STORAGE_DISABLED_MESSAGE, storageDisabled } from './check-gate.utils';

function toStatus(status: CheckResult['status']): DoctorStatus {
  switch (status) {
    case 'success':
      return 'ok';
    case 'warning':
      return 'warning';
    default:
      return 'error';
  }
}

export function toDoctorOutcome(result: CheckResult): DoctorOutcome {
  return {
    status: toStatus(result.status),
    message: result.message ?? '',
    ...(result.error ? { details: [result.error] } : {}),
    ...(result.suggestion ? { suggestion: result.suggestion } : {}),
  };
}

function adapt(
  definition: CheckDefinition,
  id: DoctorCheckId,
  options: { requiresStorage?: boolean } = {},
): DoctorCheck {
  return {
    id,
    name: definition.name,
    run: async (ctx) => {
      if (options.requiresStorage && storageDisabled(ctx)) {
        return skipped(STORAGE_DISABLED_MESSAGE);
      }
      return toDoctorOutcome(await definition.run(ctx.checkContext));
    },
  };
}

export const PREFLIGHT_CHECKS: readonly DoctorCheck[] = [
  adapt(dockerCheck, 'docker-daemon'),
  adapt(composeCheck, 'docker-compose'),
  adapt(portsCheck, 'ports-availability'),
  adapt(fuseCheck, 'fuse', { requiresStorage: true }),
  adapt(transcodingCheck, 'transcoding'),
  adapt(dnsCheck, 'dns'),
  adapt(diskSpaceCheck, 'disk-space'),
];

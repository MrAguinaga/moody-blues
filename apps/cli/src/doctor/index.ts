export { buildDoctorChecks, DOCTOR_CHECKS, REMEDIATION_CHECKS } from './checks';
export {
  DEFAULT_STUCK_AFTER_MINUTES,
  MAX_FIX_ITEMS,
  MAX_STUCK_AFTER_MINUTES,
  MIN_STUCK_AFTER_MINUTES,
} from './doctor.constants';
export { runDoctor, type RunDoctorOptions, summarize } from './doctor.runner';
export {
  DOCTOR_CHECK_IDS,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorContext,
  type DoctorCounts,
  type DoctorOutcome,
  type DoctorReport,
  type DoctorResult,
  type DoctorStatus,
  type FixDecision,
  type FixOutcome,
  type FixPlan,
  type StuckItem,
} from './doctor.types';
export { createDoctorContext, type CreateDoctorContextOptions } from './doctor-context.loader';
export { describeFixPlan, FIX_ACTION } from './doctor-fix.service';
export { redactSecrets } from './doctor-redact.utils';

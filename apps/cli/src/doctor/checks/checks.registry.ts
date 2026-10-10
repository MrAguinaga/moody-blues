import type { DoctorCheck } from '../doctor.types';
import { bazarrProvidersCheck } from './bazarr-providers.check';
import { containersCheck } from './containers.check';
import { debridMountCheck, decypharrConfigCheck, decypharrLinkCheck } from './decypharr.check';
import { libraryCheck } from './library.check';
import { PREFLIGHT_CHECKS } from './preflight.check';
import {
  createRealDebridAccountCheck,
  type RealDebridAccountOptions,
} from './realdebrid-account.check';
import { realDebridTokenCheck } from './realdebrid-token.check';
import { reinsertionCheck } from './reinsertion.check';
import {
  bazarrApiCheck,
  jellyfinApiCheck,
  prowlarrApiCheck,
  radarrApiCheck,
  seerrApiCheck,
  sonarrApiCheck,
} from './services-api.check';
import { stuckDownloadsCheck } from './stuck-downloads.check';

export const DOCTOR_CHECKS: readonly DoctorCheck[] = [
  ...PREFLIGHT_CHECKS,
  containersCheck,
  sonarrApiCheck,
  radarrApiCheck,
  prowlarrApiCheck,
  bazarrApiCheck,
  jellyfinApiCheck,
  seerrApiCheck,
  decypharrConfigCheck,
  decypharrLinkCheck,
  debridMountCheck,
  realDebridTokenCheck,
  stuckDownloadsCheck,
  reinsertionCheck,
  libraryCheck,
  bazarrProvidersCheck,
];

export const REMEDIATION_CHECKS: readonly DoctorCheck[] = [stuckDownloadsCheck, reinsertionCheck];

export interface BuildDoctorChecksOptions {
  realDebrid?: boolean;
  realDebridAccount?: RealDebridAccountOptions;
}

export function buildDoctorChecks(options: BuildDoctorChecksOptions = {}): readonly DoctorCheck[] {
  if (!options.realDebrid) {
    return DOCTOR_CHECKS;
  }
  const tokenPosition = DOCTOR_CHECKS.indexOf(realDebridTokenCheck) + 1;
  return [
    ...DOCTOR_CHECKS.slice(0, tokenPosition),
    createRealDebridAccountCheck(options.realDebridAccount),
    ...DOCTOR_CHECKS.slice(tokenPosition),
  ];
}

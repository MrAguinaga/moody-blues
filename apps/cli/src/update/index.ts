export {
  fetchLatestRelease,
  type FetchLatestReleaseOptions,
  LATEST_RELEASE_URL,
  UpdateCheckError,
} from './release.client';
export { compareSemver, normalizeVersion, parseSemver, type Semver } from './semver.utils';
export {
  cacheFromRelease,
  isCacheFresh,
  readInstalledState,
  releaseFromCache,
  storeUpdateCache,
  UPDATE_CACHE_TTL_MS,
} from './update.cache';
export { checkForUpdate, type CheckForUpdateOptions, isNewer } from './update.check';
export { type CodeUpdateResult, runCodeUpdate, type RunCodeUpdateOptions } from './update.code';
export { CLI_ENTRYPOINT, findCodeDir, type FindCodeDirOptions } from './update.code-dir';
export { CommandFailedError, spawnCommand } from './update.exec';
export {
  type RedeployDeps,
  type RedeployOptions,
  type RedeployReport,
  runRedeploy,
} from './update.redeploy';
export {
  applyUpdate,
  type ApplyUpdateOptions,
  type ApplyUpdateResult,
  inspectUpdate,
  type InspectUpdateOptions,
  REDEPLOY_HINT,
  type UpdateDeps,
  type UpdateInspection,
} from './update.service';
export type {
  CommandOptions,
  CommandRunner,
  ReleaseInfo,
  UpdateCheck,
  UpdateSource,
  UpdateStepId,
  UpdateStepResult,
  UpdateStepStatus,
} from './update.types';

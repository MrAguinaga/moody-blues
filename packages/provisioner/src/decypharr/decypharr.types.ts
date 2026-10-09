export interface VersionInfo {
  version: string;
  channel?: string;
}

export interface QueueCleanupRule {
  id: string;
  action?: string;
}

export interface DecypharrConfigView {
  port?: string | number;
  useAuth: boolean;
  enableWebdavAuth: boolean;
  downloadFolder?: string;
  defaultDownloadAction?: string;
  categories: string[];
  arrNames: string[];
  downloadUncached: boolean;
  rateLimit?: string;
  mountType?: string;
  mountPath?: string;
  vfsCacheMode?: string;
  vfsCacheMaxSize?: string;
  vfsCacheMaxAge?: string;
  repairEnabled: boolean;
  repairSchedule?: string;
  repairAutoRepair: boolean;
  queueCleanupRules: QueueCleanupRule[];
  hearsayDisabled: boolean;
  skipPreCache: boolean;
}

export interface DecypharrArr {
  name: string;
  host: string;
  token: string;
  source?: string;
}

export interface RepairHealthEntry {
  name?: string;
  status?: string;
}

export const INVARIANT_IDS = [
  'download-action',
  'vfs-cache-mode',
  'vfs-cache-size',
  'cached-only',
  'categories',
  'download-folder',
  'mount',
  'auth',
  'hearsay',
  'pre-cache',
  'rate-limit',
  'repair',
  'queue-cleanup',
  'port',
] as const;

export type InvariantId = (typeof INVARIANT_IDS)[number];

export interface InvariantCheck {
  id: InvariantId;
  description: string;
  status: 'ok' | 'drift';
  expected: string;
  actual: string;
  adr?: string;
}

export interface ExpectedSettings {
  downloadUncached: boolean;
  clientCategories: Record<'sonarr' | 'radarr', string | undefined>;
}

export type LinkApp = 'sonarr' | 'radarr';

export interface LinkCheck {
  app: LinkApp;
  knownByDecypharr: boolean;
  clientLoginOk: boolean;
  removeCompleted: boolean;
  removeFailedDisabled: boolean;
  issues: string[];
}

export interface MountCheck {
  webdavStatus: number;
  allFolderVisible: boolean;
}

export interface VerificationReport {
  version: string;
  invariants: InvariantCheck[];
  links: LinkCheck[];
  mount: MountCheck;
  brokenEntries: number;
  repairHealthNote?: string;
  ok: boolean;
}

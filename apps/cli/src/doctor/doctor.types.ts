import type {
  ArrClient,
  BazarrClient,
  DecypharrClient,
  JellyfinClient,
  ProvisionContext,
  ProwlarrClient,
  SeerrClient,
} from '@moody-blues/provisioner';

import type { CheckContext } from '../checks';
import type { StackStatus } from '../docker';
import type { Installation } from '../installation';

export type DoctorStatus = 'ok' | 'warning' | 'error' | 'skipped';

export const DOCTOR_CHECK_IDS = [
  'docker-daemon',
  'docker-compose',
  'ports-availability',
  'fuse',
  'transcoding',
  'dns',
  'disk-space',
  'containers',
  'api-sonarr',
  'api-radarr',
  'api-prowlarr',
  'api-bazarr',
  'api-jellyfin',
  'api-seerr',
  'decypharr-config',
  'decypharr-link',
  'debrid-mount',
  'realdebrid-token',
  'realdebrid-account',
  'stuck-downloads',
  'decypharr-reinsertion',
  'library',
  'bazarr-providers',
  'jellyfin-policy',
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

export interface StuckItem {
  app: 'sonarr' | 'radarr';
  queueId: number;
  title: string;
  state: string;
  ageMinutes: number;
  message?: string;
}

export interface DoctorOutcome {
  status: DoctorStatus;
  message: string;
  details?: string[];
  suggestion?: string;
  fixable?: boolean;
  stuckItems?: StuckItem[];
}

export interface DoctorResult extends DoctorOutcome {
  id: DoctorCheckId;
  name: string;
}

export interface DoctorCheck {
  id: DoctorCheckId;
  name: string;
  run(ctx: DoctorContext): Promise<DoctorOutcome>;
}

export interface DoctorClients {
  sonarr: ArrClient;
  radarr: ArrClient;
  prowlarr: ProwlarrClient;
  bazarr: BazarrClient;
  jellyfin: JellyfinClient;
  seerr: SeerrClient;
  decypharr: DecypharrClient;
}

export interface LogTail {
  text: string;
  modifiedAt: number;
}

export interface DoctorContext {
  installation: Installation;
  provision: ProvisionContext;
  checkContext: CheckContext;
  clients: DoctorClients;
  signal: AbortSignal;
  stuckAfterMs: number;
  decypharrLogPath: string;
  timeZone?: string;
  stack(): Promise<StackStatus>;
  memo<T>(key: string, factory: () => Promise<T>): Promise<T>;
  forget(key: string): void;
  now(): number;
  readLogTail(path: string, bytes: number): Promise<LogTail>;
  readDirectory(path: string, timeoutMs: number): Promise<string[]>;
  redact(text: string): string;
}

export interface DoctorCounts {
  ok: number;
  warning: number;
  error: number;
  skipped: number;
}

export interface FixPlan {
  items: StuckItem[];
  pending: number;
}

export interface FixOutcome {
  id: 'remove-stuck-downloads';
  applied: boolean;
  removed: number;
  failed: string[];
  items: string[];
  pending: number;
  reinsertionsBefore: number;
  reinsertionsAfter: number;
  loopStopped: boolean;
  note?: string;
}

export interface DoctorReport {
  timestamp: string;
  version: string;
  home: string;
  success: boolean;
  counts: DoctorCounts;
  checks: DoctorResult[];
  fixes: FixOutcome[];
}

export type FixDecision = 'approved' | 'declined' | 'unavailable';

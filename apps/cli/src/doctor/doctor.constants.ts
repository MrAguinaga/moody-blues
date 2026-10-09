import type { ArrKind } from '@moody-blues/provisioner';

const MINUTE_MS = 60_000;

export const STUCK_STATES: readonly string[] = [
  'importPending',
  'importing',
  'importBlocked',
  'failed',
];
export const DEFAULT_STUCK_AFTER_MINUTES = 10;
export const MIN_STUCK_AFTER_MINUTES = 1;
export const MAX_STUCK_AFTER_MINUTES = 1440;

export const CHECK_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 5_000;
export const STACK_QUERY_TIMEOUT_MS = 8_000;
export const MOUNT_READ_TIMEOUT_MS = 5_000;

export const REINSERTION_WINDOW_MS = 15 * MINUTE_MS;
export const REINSERTION_THRESHOLD = 3;
export const LOG_TAIL_BYTES = 512 * 1024;
export const REINSERTION_MARKER = 'Successfully re-inserted entry';

export const MAX_FIX_ITEMS = 10;
export const FIX_SETTLE_MS = 30_000;
export const MAX_DETAIL_LINES = 10;
export const MAX_QUEUE_MESSAGE_LENGTH = 200;

export const RD_AUTH_REJECTION_PATTERNS: readonly RegExp[] = [
  /bad_token/i,
  /invalid[ _]token/i,
  /unauthorized/i,
  /\b401\b/,
  /permission_denied/i,
  /account_locked/i,
  /disabled_account/i,
];

export const REAL_DEBRID_USER_URL = 'https://api.real-debrid.com/rest/1.0/user';
export const REAL_DEBRID_EXPIRY_WARNING_DAYS = 14;

export const ARR_APPS: readonly ArrKind[] = ['sonarr', 'radarr'];

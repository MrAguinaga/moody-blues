import { parseSizeBytes } from '../preseed/size.preseed';
import type {
  DecypharrConfigView,
  ExpectedSettings,
  InvariantCheck,
  InvariantId,
} from './decypharr.types';

export const MAX_VFS_CACHE_BYTES = 2 * 1024 ** 3;
export const REQUIRED_CLEANUP_RULES: readonly string[] = [
  'failed_download',
  'unable_to_parse',
  'no_eligible_files',
  'episodes_missing',
  'file_empty',
];
export const CLEANUP_ACTION = 'blacklist_research';

const REQUIRED_CATEGORIES: readonly string[] = ['sonarr', 'radarr'];

type Evaluation = Pick<InvariantCheck, 'expected' | 'actual'> & { ok: boolean };

interface InvariantDefinition {
  id: InvariantId;
  description: string;
  adr?: string;
  evaluate(view: DecypharrConfigView, expected: ExpectedSettings): Evaluation;
}

function show(value: unknown): string {
  return value === undefined ? 'absent' : JSON.stringify(value);
}

function equals(expected: unknown, actual: unknown): Evaluation {
  return { ok: expected === actual, expected: show(expected), actual: show(actual) };
}

function cacheSize(view: DecypharrConfigView): Evaluation {
  const expected = 'vfs_cache_max_size <= 2 GiB and vfs_cache_max_age set';
  const { vfsCacheMaxSize: size, vfsCacheMaxAge: age } = view;
  const problems: string[] = [];
  if (!size) {
    problems.push('vfs_cache_max_size absent');
  } else {
    try {
      const bytes = parseSizeBytes(size);
      if (bytes > MAX_VFS_CACHE_BYTES) {
        problems.push(`vfs_cache_max_size ${show(size)} exceeds 2 GiB`);
      }
    } catch {
      problems.push(`vfs_cache_max_size ${show(size)} is not a valid rclone size`);
    }
  }
  if (!age) {
    problems.push('vfs_cache_max_age absent');
  }
  return {
    ok: problems.length === 0,
    expected,
    actual: problems.length === 0 ? `${size} and ${age}` : problems.join(', '),
  };
}

function categories(view: DecypharrConfigView, expected: ExpectedSettings): Evaluation {
  const wanted = (['sonarr', 'radarr'] as const).map((app) => expected.clientCategories[app]);
  const problems: string[] = [];
  for (const name of REQUIRED_CATEGORIES) {
    if (!view.categories.includes(name)) {
      problems.push(`categories lacks ${show(name)}`);
    }
  }
  for (const app of ['sonarr', 'radarr'] as const) {
    const category = expected.clientCategories[app];
    if (category === undefined) {
      problems.push(`${app} download client category unknown`);
    } else if (!view.arrNames.includes(category) || !view.categories.includes(category)) {
      problems.push(
        `${app} client category ${show(category)} is not a configured arr and category`,
      );
    }
  }
  return {
    ok: problems.length === 0,
    expected: `categories and arrs[].name contain ${wanted.map(show).join(', ')}`,
    actual:
      problems.length === 0
        ? `categories=${show(view.categories)} arrs=${show(view.arrNames)}`
        : `${problems.join(', ')}; categories=${show(view.categories)} arrs=${show(view.arrNames)}`,
  };
}

function queueCleanup(view: DecypharrConfigView): Evaluation {
  const problems = REQUIRED_CLEANUP_RULES.flatMap((id) => {
    const rule = view.queueCleanupRules.find((candidate) => candidate.id === id);
    if (!rule) {
      return [`${id} missing`];
    }
    return rule.action === CLEANUP_ACTION ? [] : [`${id} action ${show(rule.action)}`];
  });
  return {
    ok: problems.length === 0,
    expected: `rules ${REQUIRED_CLEANUP_RULES.join(', ')} with action ${CLEANUP_ACTION}`,
    actual: problems.length === 0 ? 'all rules present' : problems.join(', '),
  };
}

function pair(expected: Record<string, unknown>, actual: Record<string, unknown>): Evaluation {
  const keys = Object.keys(expected);
  const wrong = keys.filter((key) => expected[key] !== actual[key]);
  const render = (source: Record<string, unknown>) =>
    keys.map((key) => `${key}=${show(source[key])}`).join(' ');
  return { ok: wrong.length === 0, expected: render(expected), actual: render(actual) };
}

export const INVARIANT_DEFINITIONS: readonly InvariantDefinition[] = [
  {
    id: 'download-action',
    description: 'Downloads are exposed as symlinks, never copied to disk',
    adr: 'ADR-014',
    evaluate: (view) => equals('symlink', view.defaultDownloadAction),
  },
  {
    id: 'vfs-cache-mode',
    description: 'The rclone VFS cache only buffers writes',
    adr: 'ADR-014',
    evaluate: (view) => equals('writes', view.vfsCacheMode),
  },
  {
    id: 'vfs-cache-size',
    description: 'The rclone VFS cache is bounded in size and age',
    adr: 'ADR-014',
    evaluate: cacheSize,
  },
  {
    id: 'cached-only',
    description: 'Uncached torrents are only downloaded when storage.downloadUncached allows it',
    adr: 'ADR-004',
    evaluate: (view, expected) => equals(expected.downloadUncached, view.downloadUncached),
  },
  {
    id: 'categories',
    description: 'Decypharr categories match the download clients of Sonarr and Radarr',
    evaluate: categories,
  },
  {
    id: 'download-folder',
    description: 'The download folder is the shared data path',
    adr: 'ADR-013',
    evaluate: (view) => equals('/data/downloads', view.downloadFolder),
  },
  {
    id: 'mount',
    description: 'The rclone mount is published at the shared debrid path',
    adr: 'ADR-013',
    evaluate: (view) =>
      pair(
        { type: 'rclone', mount_path: '/mnt/debrid' },
        { type: view.mountType, mount_path: view.mountPath },
      ),
  },
  {
    id: 'auth',
    description: 'API authentication is on and the embedded WebDAV mount is anonymous',
    evaluate: (view) =>
      pair(
        { use_auth: true, enable_webdav_auth: false },
        { use_auth: view.useAuth, enable_webdav_auth: view.enableWebdavAuth },
      ),
  },
  {
    id: 'hearsay',
    description: 'The public gossip network is disabled',
    evaluate: (view) => equals(true, view.hearsayDisabled),
  },
  {
    id: 'pre-cache',
    description: 'Completed downloads are not read back to warm the cache',
    evaluate: (view) => equals(true, view.skipPreCache),
  },
  {
    id: 'rate-limit',
    description: 'The debrid provider is rate limited',
    evaluate: (view) => ({
      ok: Boolean(view.rateLimit),
      expected: 'non-empty rate_limit',
      actual: show(view.rateLimit),
    }),
  },
  {
    id: 'repair',
    description: 'Scheduled automatic repair is enabled',
    evaluate: (view) =>
      pair(
        { enabled: true, schedule: 'non-empty', auto_repair: true },
        {
          enabled: view.repairEnabled,
          schedule: view.repairSchedule ? 'non-empty' : view.repairSchedule,
          auto_repair: view.repairAutoRepair,
        },
      ),
  },
  {
    id: 'queue-cleanup',
    description: 'Failed releases are blacklisted and searched again',
    evaluate: queueCleanup,
  },
  {
    id: 'port',
    description: 'The listen port is the string the services connect to',
    evaluate: (view) => equals('8282', view.port),
  },
];

export function evaluateInvariants(
  view: DecypharrConfigView,
  expected: ExpectedSettings,
): InvariantCheck[] {
  return INVARIANT_DEFINITIONS.map(({ id, description, adr, evaluate }) => {
    const { ok, expected: wanted, actual } = evaluate(view, expected);
    const check: InvariantCheck = {
      id,
      description,
      status: ok ? 'ok' : 'drift',
      expected: wanted,
      actual,
    };
    return adr ? { ...check, adr } : check;
  });
}

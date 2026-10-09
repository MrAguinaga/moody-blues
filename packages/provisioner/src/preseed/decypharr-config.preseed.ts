import bcrypt from 'bcryptjs';

import { SERVICE_CATALOG } from '../services';
import type { DecypharrAuthInput, DecypharrSeedInput } from './preseed.types';

const BCRYPT_COST = 10;

interface DecypharrConfigShape {
  arrs?: { name?: string; token?: string }[];
}

export function readDecypharrConfigToken(content: string): string | undefined {
  const parsed = JSON.parse(content) as DecypharrConfigShape;
  return parsed.arrs?.find((arr) => arr.name === 'sonarr')?.token;
}

export function readDecypharrAuthToken(content: string): string | undefined {
  return (JSON.parse(content) as { api_token?: string }).api_token;
}

export function renderDecypharrConfig(input: DecypharrSeedInput): string {
  const required = {
    'Real-Debrid token': input.rdApiToken,
    'Decypharr API token': input.apiToken,
    'Sonarr API key': input.sonarrApiKey,
    'Radarr API key': input.radarrApiKey,
  };
  for (const [label, value] of Object.entries(required)) {
    if (!value.trim()) {
      throw new Error(`The ${label} must not be empty`);
    }
  }

  const config = {
    port: String(SERVICE_CATALOG.decypharr.port),
    bind_address: '0.0.0.0',
    url_base: '/',
    log_level: 'info',
    session_secret: input.sessionSecret,
    strm: { secret: input.strmSecret },
    use_auth: true,
    enable_webdav_auth: false,
    download_folder: '/data/downloads',
    categories: ['sonarr', 'radarr'],
    default_download_action: 'symlink',
    folder_naming: 'original_no_ext',
    max_active_downloads: 5,
    refresh_interval: '30s',
    remove_stalled_after: '6h',
    allow_samples: false,
    skip_pre_cache: true,
    debrids: [
      {
        provider: 'realdebrid',
        name: 'realdebrid',
        api_key: input.rdApiToken,
        download_uncached: input.downloadUncached,
        unpack_rar: false,
        rate_limit: '200/minute',
        repair_rate_limit: '60/minute',
        workers: 20,
      },
    ],
    arrs: [
      {
        name: 'sonarr',
        host: SERVICE_CATALOG.sonarr.internalUrl,
        token: input.sonarrApiKey,
        source: 'config',
      },
      {
        name: 'radarr',
        host: SERVICE_CATALOG.radarr.internalUrl,
        token: input.radarrApiKey,
        source: 'config',
      },
    ],
    mount: {
      type: 'rclone',
      mount_path: '/mnt/debrid',
      rclone: {
        vfs_cache_mode: 'writes',
        vfs_cache_max_size: '2G',
        vfs_cache_max_age: '24h',
        cache_dir: '/app/cache/rclone',
        uid: input.host.puid,
        gid: input.host.pgid,
        umask: '002',
      },
    },
    repair: {
      enabled: true,
      source: 'arr',
      schedule: '0 4 * * *',
      auto_repair: true,
      strategy: 'per_entry',
      stop_schedule: '06:00',
    },
    queue_cleanup: {
      rules: [
        'failed_download',
        'unable_to_parse',
        'no_eligible_files',
        'episodes_missing',
        'file_empty',
      ].map((id) => ({ id, action: 'blacklist_research' })),
    },
    hearsay: { disabled: true },
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function renderDecypharrAuth(input: DecypharrAuthInput): Promise<string> {
  if (!input.apiToken.trim()) {
    throw new Error('The Decypharr API token must not be empty');
  }
  const auth = {
    session_version: input.sessionVersion,
    username: input.adminUsername,
    password: await bcrypt.hash(input.adminPassword, BCRYPT_COST),
    api_token: input.apiToken,
    token_only: false,
  };
  return `${JSON.stringify(auth, null, 2)}\n`;
}

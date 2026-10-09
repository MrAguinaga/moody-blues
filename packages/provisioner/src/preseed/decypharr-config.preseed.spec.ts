import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';

import {
  readDecypharrAuthToken,
  readDecypharrConfigToken,
  renderDecypharrAuth,
  renderDecypharrConfig,
} from './decypharr-config.preseed';
import type { DecypharrSeedInput } from './preseed.types';
import { parseSizeBytes } from './size.preseed';

const input: DecypharrSeedInput = {
  rdApiToken: 'rd-token',
  apiToken: 'decypharr-token',
  sonarrApiKey: 'sonarr-key',
  radarrApiKey: 'radarr-key',
  downloadUncached: false,
  host: { puid: 1000, pgid: 1001 },
  sessionSecret: 'session-secret',
  strmSecret: 'strm-secret',
};

function render(overrides: Partial<DecypharrSeedInput> = {}): Record<string, any> {
  return JSON.parse(renderDecypharrConfig({ ...input, ...overrides }));
}

describe('renderDecypharrConfig', () => {
  it('emits the port as a string', () => {
    expect(render().port).toBe('8282');
  });

  it('never downloads files to disk (disk safeguard)', () => {
    expect(render().default_download_action).toBe('symlink');
  });

  it('bounds the VFS cache to 2 GiB with an explicit age (disk safeguard)', () => {
    const { rclone } = render().mount;

    expect(rclone.vfs_cache_mode).toBe('writes');
    expect(rclone.vfs_cache_max_size).toBe('2G');
    expect(parseSizeBytes(rclone.vfs_cache_max_size)).toBeLessThanOrEqual(2 * 1024 ** 3);
    expect(rclone.vfs_cache_max_age).toBe('24h');
  });

  it('sets explicit rate limits, workers and the Real-Debrid provider', () => {
    const [debrid, ...others] = render().debrids;

    expect(others).toEqual([]);
    expect(debrid).toMatchObject({
      provider: 'realdebrid',
      name: 'realdebrid',
      api_key: 'rd-token',
      rate_limit: '200/minute',
      repair_rate_limit: '60/minute',
      workers: 20,
      unpack_rar: false,
    });
  });

  it.each([true, false])('reflects downloadUncached=%s', (downloadUncached) => {
    expect(render({ downloadUncached }).debrids[0].download_uncached).toBe(downloadUncached);
  });

  it('disables hearsay', () => {
    expect(render().hearsay).toEqual({ disabled: true });
  });

  it('skips the cache warm-up read of completed downloads', () => {
    expect(render().skip_pre_cache).toBe(true);
  });

  it('points the arrs at internal urls without a trailing slash', () => {
    const { arrs } = render();

    expect(arrs).toEqual([
      { name: 'sonarr', host: 'http://sonarr:8989', token: 'sonarr-key', source: 'config' },
      { name: 'radarr', host: 'http://radarr:7878', token: 'radarr-key', source: 'config' },
    ]);
  });

  it('seeds both secrets, authentication and the mount identity', () => {
    const config = render();

    expect(config).toMatchObject({
      session_secret: 'session-secret',
      strm: { secret: 'strm-secret' },
      use_auth: true,
      enable_webdav_auth: false,
      download_folder: '/data/downloads',
      folder_naming: 'original_no_ext',
    });
    expect(config.mount).toMatchObject({ type: 'rclone', mount_path: '/mnt/debrid' });
    expect(config.mount.rclone).toMatchObject({ uid: 1000, gid: 1001, umask: '002' });
  });

  it('omits the 1.x keys and the discarded rclone keys', () => {
    const config = render();
    const legacy = [
      'check_cached',
      'use_webdav',
      'serve_from_rclone',
      'add_samples',
      'qbittorrent',
      'webdav',
    ];

    for (const key of legacy) {
      expect(config).not.toHaveProperty(key);
    }
    for (const key of ['dir_cache_time', 'log_level', 'port', 'vfs_cache_poll_interval']) {
      expect(config.mount.rclone).not.toHaveProperty(key);
    }
  });

  it('configures the queue cleanup rules', () => {
    const { rules } = render().queue_cleanup;

    expect(rules.map((rule: { id: string }) => rule.id)).toEqual([
      'failed_download',
      'unable_to_parse',
      'no_eligible_files',
      'episodes_missing',
      'file_empty',
    ]);
    expect(rules.every((rule: { action: string }) => rule.action === 'blacklist_research')).toBe(
      true,
    );
  });

  it('rejects empty credentials', () => {
    expect(() => renderDecypharrConfig({ ...input, rdApiToken: ' ' })).toThrow(/must not be empty/);
    expect(() => renderDecypharrConfig({ ...input, sonarrApiKey: '' })).toThrow(
      /must not be empty/,
    );
  });

  it('reads the Sonarr token back', () => {
    expect(readDecypharrConfigToken(renderDecypharrConfig(input))).toBe('sonarr-key');
  });
});

describe('renderDecypharrAuth', () => {
  const authInput = {
    adminUsername: 'admin',
    adminPassword: 'p@ss word',
    apiToken: 'decypharr-token',
    sessionVersion: 'abc123',
  };

  it('writes a bcrypt hash that verifies against the admin password', async () => {
    const auth = JSON.parse(await renderDecypharrAuth(authInput));

    expect(auth).toMatchObject({
      session_version: 'abc123',
      username: 'admin',
      api_token: 'decypharr-token',
      token_only: false,
    });
    expect(auth.password).not.toBe('p@ss word');
    expect(bcrypt.getRounds(auth.password)).toBe(10);
    expect(await bcrypt.compare('p@ss word', auth.password)).toBe(true);
    expect(await bcrypt.compare('wrong', auth.password)).toBe(false);
  });

  it('rejects an empty API token', async () => {
    await expect(renderDecypharrAuth({ ...authInput, apiToken: '' })).rejects.toThrow(
      /must not be empty/,
    );
  });

  it('reads the API token back', async () => {
    expect(readDecypharrAuthToken(await renderDecypharrAuth(authInput))).toBe('decypharr-token');
  });
});

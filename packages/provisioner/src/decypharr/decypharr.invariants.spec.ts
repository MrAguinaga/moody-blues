import { describe, expect, it } from 'vitest';

import { renderDecypharrConfig } from '../preseed/decypharr-config.preseed';
import { parseConfigView } from './decypharr.client';
import { evaluateInvariants, INVARIANT_DEFINITIONS } from './decypharr.invariants';
import {
  type DecypharrConfigView,
  type ExpectedSettings,
  INVARIANT_IDS,
  type InvariantId,
} from './decypharr.types';

type Raw = Record<string, unknown>;

const EXPECTED: ExpectedSettings = {
  downloadUncached: false,
  clientCategories: { sonarr: 'sonarr', radarr: 'radarr' },
};

function seeded(downloadUncached = false): Raw {
  return JSON.parse(
    renderDecypharrConfig({
      rdApiToken: 'rd-token',
      apiToken: 'decypharr-token',
      sonarrApiKey: 'sonarr-key',
      radarrApiKey: 'radarr-key',
      downloadUncached,
      host: { puid: 1000, pgid: 1000 },
      sessionSecret: 'session',
      strmSecret: 'strm',
    }),
  ) as Raw;
}

function viewOf(mutate: (config: Raw) => void = () => undefined, downloadUncached = false) {
  const config = seeded(downloadUncached);
  mutate(config);
  return parseConfigView(config);
}

function drifts(view: DecypharrConfigView, expected: ExpectedSettings = EXPECTED): InvariantId[] {
  return evaluateInvariants(view, expected)
    .filter(({ status }) => status === 'drift')
    .map(({ id }) => id);
}

const mount = (config: Raw) => config.mount as Raw;
const rclone = (config: Raw) => mount(config).rclone as Raw;
const debrid = (config: Raw) => (config.debrids as Raw[])[0]!;

describe('evaluateInvariants', () => {
  it('evaluates the fourteen invariants in a stable order', () => {
    const checks = evaluateInvariants(viewOf(), EXPECTED);

    expect(checks.map(({ id }) => id)).toEqual([...INVARIANT_IDS]);
    expect(INVARIANT_DEFINITIONS).toHaveLength(14);
  });

  it('finds no drift in the configuration the pre-seeding engine writes', () => {
    expect(
      evaluateInvariants(viewOf(), EXPECTED).filter(({ status }) => status === 'drift'),
    ).toEqual([]);
    expect(
      drifts(
        viewOf(() => undefined, true),
        { ...EXPECTED, downloadUncached: true },
      ),
    ).toEqual([]);
  });

  it('reports the key, the expected value and the observed value of a drift', () => {
    const check = evaluateInvariants(
      viewOf((config) => {
        config.default_download_action = 'download';
      }),
      EXPECTED,
    ).find(({ id }) => id === 'download-action');

    expect(check).toMatchObject({
      status: 'drift',
      expected: '"symlink"',
      actual: '"download"',
      adr: 'ADR-014',
    });
  });

  describe('ADR-014 safeguards', () => {
    it.each([
      ['download', 'download'],
      ['absent', undefined],
      ['copy', 'copy'],
    ])('fails when default_download_action is %s', (_label, value) => {
      const view = viewOf((config) => {
        if (value === undefined) delete config.default_download_action;
        else config.default_download_action = value;
      });

      expect(drifts(view)).toEqual(['download-action']);
    });

    it.each(['full', 'off', 'minimal'])('fails when vfs_cache_mode is %s', (mode) => {
      const view = viewOf((config) => {
        rclone(config).vfs_cache_mode = mode;
      });

      expect(drifts(view)).toEqual(['vfs-cache-mode']);
    });

    it('fails when vfs_cache_mode is absent', () => {
      const view = viewOf((config) => {
        delete rclone(config).vfs_cache_mode;
      });

      expect(drifts(view)).toEqual(['vfs-cache-mode']);
    });

    it('fails when vfs_cache_max_size is absent', () => {
      const view = viewOf((config) => {
        delete rclone(config).vfs_cache_max_size;
      });

      expect(drifts(view)).toEqual(['vfs-cache-size']);
    });

    it.each(['3G', '2049M', '1T'])('fails when vfs_cache_max_size is %s, above 2 GiB', (size) => {
      const view = viewOf((config) => {
        rclone(config).vfs_cache_max_size = size;
      });

      expect(drifts(view)).toEqual(['vfs-cache-size']);
    });

    it.each(['2G', '2GiB', '2048M', '512M'])('accepts vfs_cache_max_size %s', (size) => {
      const view = viewOf((config) => {
        rclone(config).vfs_cache_max_size = size;
      });

      expect(drifts(view)).toEqual([]);
    });

    it.each(['big', '2GB', '2048'])(
      'fails when vfs_cache_max_size is %s, which rclone cannot parse',
      (size) => {
        const view = viewOf((config) => {
          rclone(config).vfs_cache_max_size = size;
        });

        const check = evaluateInvariants(view, EXPECTED).find(({ id }) => id === 'vfs-cache-size');
        expect(check?.status).toBe('drift');
        expect(check?.actual).toContain('is not a valid rclone size');
      },
    );

    it('fails when vfs_cache_max_age is absent', () => {
      const view = viewOf((config) => {
        delete rclone(config).vfs_cache_max_age;
      });

      expect(drifts(view)).toEqual(['vfs-cache-size']);
    });
  });

  describe('ADR-004 cached-only', () => {
    it('fails when Decypharr downloads uncached torrents but the configuration forbids it', () => {
      const view = viewOf((config) => {
        debrid(config).download_uncached = true;
      });

      expect(drifts(view)).toEqual(['cached-only']);
    });

    it('fails when the configuration allows uncached downloads but Decypharr does not', () => {
      expect(drifts(viewOf(), { ...EXPECTED, downloadUncached: true })).toEqual(['cached-only']);
    });

    it('passes when both allow uncached downloads', () => {
      expect(
        drifts(
          viewOf(() => undefined, true),
          { ...EXPECTED, downloadUncached: true },
        ),
      ).toEqual([]);
    });

    it('treats an absent download_uncached as false', () => {
      const view = viewOf((config) => {
        delete debrid(config).download_uncached;
      });

      expect(drifts(view)).toEqual([]);
    });
  });

  describe('the remaining invariants', () => {
    it('fails when a category is missing', () => {
      const view = viewOf((config) => {
        config.categories = ['sonarr'];
      });

      expect(drifts(view)).toEqual(['categories']);
    });

    it('fails when the arr names differ from the download client categories', () => {
      const view = viewOf((config) => {
        (config.arrs as Raw[])[0]!.name = 'tv';
      });

      expect(drifts(view)).toEqual(['categories']);
    });

    it('fails when a download client category is unknown', () => {
      const expected = { ...EXPECTED, clientCategories: { sonarr: undefined, radarr: 'radarr' } };

      expect(drifts(viewOf(), expected)).toEqual(['categories']);
    });

    it('fails when the download folder differs', () => {
      const view = viewOf((config) => {
        config.download_folder = '/downloads';
      });

      expect(drifts(view)).toEqual(['download-folder']);
    });

    it.each([
      ['type', (config: Raw) => (mount(config).type = 'dfs')],
      ['mount_path', (config: Raw) => (mount(config).mount_path = '/mnt/other')],
    ])('fails when the mount %s differs', (_label, mutate) => {
      expect(drifts(viewOf(mutate))).toEqual(['mount']);
    });

    it('fails when authentication is off', () => {
      const view = viewOf((config) => {
        config.use_auth = false;
      });

      expect(drifts(view)).toEqual(['auth']);
    });

    it('fails when the WebDAV mount requires credentials', () => {
      const view = viewOf((config) => {
        config.enable_webdav_auth = true;
      });

      expect(drifts(view)).toEqual(['auth']);
    });

    it.each([
      ['active', (config: Raw) => (config.hearsay = { disabled: false })],
      ['absent', (config: Raw) => delete config.hearsay],
    ])('fails when hearsay is %s', (_label, mutate) => {
      expect(drifts(viewOf(mutate))).toEqual(['hearsay']);
    });

    it.each([
      ['enabled', (config: Raw) => (config.skip_pre_cache = false)],
      ['absent', (config: Raw) => delete config.skip_pre_cache],
    ])('fails when the cache warm-up is %s', (_label, mutate) => {
      expect(drifts(viewOf(mutate))).toEqual(['pre-cache']);
    });

    it.each(['', undefined])('fails when the rate limit is %j', (value) => {
      const view = viewOf((config) => {
        if (value === undefined) delete debrid(config).rate_limit;
        else debrid(config).rate_limit = value;
      });

      expect(drifts(view)).toEqual(['rate-limit']);
    });

    it.each([
      ['disabled', (config: Raw) => ((config.repair as Raw).enabled = false)],
      ['without a schedule', (config: Raw) => ((config.repair as Raw).schedule = '')],
      ['without auto repair', (config: Raw) => delete (config.repair as Raw).auto_repair],
    ])('fails when repair is %s', (_label, mutate) => {
      expect(drifts(viewOf(mutate))).toEqual(['repair']);
    });

    it('fails when a cleanup rule is missing', () => {
      const view = viewOf((config) => {
        const cleanup = config.queue_cleanup as { rules: Raw[] };
        cleanup.rules = cleanup.rules.filter((rule) => rule.id !== 'file_empty');
      });

      const check = evaluateInvariants(view, EXPECTED).find(({ id }) => id === 'queue-cleanup');
      expect(check?.status).toBe('drift');
      expect(check?.actual).toBe('file_empty missing');
    });

    it('fails when a cleanup rule has another action', () => {
      const view = viewOf((config) => {
        (config.queue_cleanup as { rules: Raw[] }).rules[0]!.action = 'remove';
      });

      expect(drifts(view)).toEqual(['queue-cleanup']);
    });

    it('fails when the port is a number', () => {
      const view = viewOf((config) => {
        config.port = 8282;
      });

      const check = evaluateInvariants(view, EXPECTED).find(({ id }) => id === 'port');
      expect(check).toMatchObject({ status: 'drift', expected: '"8282"', actual: '8282' });
    });
  });

  it('lists every drift together', () => {
    const view = viewOf((config) => {
      config.default_download_action = 'download';
      rclone(config).vfs_cache_mode = 'full';
      config.use_auth = false;
      config.port = 8282;
    });

    expect(drifts(view)).toEqual(['download-action', 'vfs-cache-mode', 'auth', 'port']);
  });

  it('never includes a secret in the expected or observed values', () => {
    const rendered = JSON.stringify(evaluateInvariants(viewOf(), EXPECTED));

    for (const secret of ['rd-token', 'decypharr-token', 'sonarr-key', 'radarr-key']) {
      expect(rendered).not.toContain(secret);
    }
  });
});

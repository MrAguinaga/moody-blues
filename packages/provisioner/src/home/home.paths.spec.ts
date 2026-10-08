import { describe, expect, it } from 'vitest';

import { createLayout, resolveMbHome } from './home.paths';
import { resolveHostIdentity } from './host-identity.utils';

describe('resolveMbHome', () => {
  it('prefers the explicit option over the environment', () => {
    expect(resolveMbHome({ explicit: '/srv/a', env: { MB_HOME: '/srv/b' } })).toBe('/srv/a');
  });

  it('uses MB_HOME when no option is given', () => {
    expect(resolveMbHome({ env: { MB_HOME: '/srv/b' } })).toBe('/srv/b');
  });

  it('falls back to a platform default', () => {
    expect(resolveMbHome({ env: {}, platform: 'linux' })).toBe('/opt/moody-blues');
    expect(resolveMbHome({ env: {}, platform: 'darwin', homeDir: '/Users/me' })).toBe(
      '/Users/me/.moody-blues',
    );
  });
});

describe('createLayout', () => {
  it('derives every path from the root', () => {
    const layout = createLayout('/x');
    expect(layout).toMatchObject({
      stateFile: '/x/moody-blues.json',
      envFile: '/x/.env',
      debridMountDir: '/x/mnt/debrid',
      downloadsDir: '/x/data/downloads',
      mediaDir: '/x/data/media',
    });
    expect(layout.configFor('sonarr')).toBe('/x/config/sonarr');
  });
});

describe('resolveHostIdentity', () => {
  it('prefers the sudo invoking user', () => {
    const identity = resolveHostIdentity({
      env: { SUDO_UID: '1001', SUDO_GID: '1002' },
      uid: 0,
      gid: 0,
    });
    expect(identity).toEqual({ puid: 1001, pgid: 1002 });
  });

  it('falls back to the current process ids', () => {
    expect(resolveHostIdentity({ env: {}, uid: 501, gid: 20 })).toEqual({ puid: 501, pgid: 20 });
  });

  it('ignores malformed sudo variables', () => {
    const identity = resolveHostIdentity({ env: { SUDO_UID: 'x', SUDO_GID: '1' }, uid: 5, gid: 6 });
    expect(identity).toEqual({ puid: 5, pgid: 6 });
  });
});

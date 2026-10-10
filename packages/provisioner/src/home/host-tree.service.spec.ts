import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayout } from './home.paths';
import { ensureHostTree } from './host-tree.service';

const identity = { puid: 1000, pgid: 1000 };

describe('ensureHostTree', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-tree-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('creates the full tree and reports what it created', () => {
    const layout = createLayout(join(sandbox, 'home'));
    const { created } = ensureHostTree(layout, identity, { runAsRoot: false });

    expect(created[0]).toBe(layout.root);
    for (const path of [
      layout.configFor('caddy'),
      join(layout.configFor('caddy'), 'data'),
      join(layout.configFor('caddy'), 'etc'),
      join(layout.cacheDir, 'jellyfin'),
      layout.debridMountDir,
      join(layout.downloadsDir, 'sonarr'),
      join(layout.mediaDir, 'movies'),
      join(layout.mediaDir, '.recycle'),
    ]) {
      expect(statSync(path).isDirectory()).toBe(true);
    }
    expect(statSync(layout.configFor('sonarr')).mode & 0o777).toBe(0o775);
  });

  it('is idempotent', () => {
    const layout = createLayout(join(sandbox, 'home'));
    ensureHostTree(layout, identity, { runAsRoot: false });
    expect(ensureHostTree(layout, identity, { runAsRoot: false }).created).toEqual([]);
  });

  it('only creates what is missing', () => {
    const layout = createLayout(sandbox);
    mkdirSync(layout.configDir);
    const { created } = ensureHostTree(layout, identity, { runAsRoot: false });
    expect(created).not.toContain(layout.root);
    expect(created).not.toContain(layout.configDir);
    expect(created).toContain(layout.mntDir);
  });

  it('chowns created directories only when running as root', () => {
    const chown = vi.fn();
    const layout = createLayout(join(sandbox, 'a'));
    const { created } = ensureHostTree(layout, identity, { runAsRoot: true, chown });
    expect(chown).toHaveBeenCalledTimes(created.length);
    expect(chown).toHaveBeenCalledWith(layout.root, 1000, 1000);

    const skipped = vi.fn();
    ensureHostTree(createLayout(join(sandbox, 'b')), identity, {
      runAsRoot: false,
      chown: skipped,
    });
    expect(skipped).not.toHaveBeenCalled();
  });
});

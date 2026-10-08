import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultConfig,
  createLayout,
  ensureHostTree,
  type MbHomeLayout,
  type ProvisionContext,
} from '@moody-blues/provisioner';

import { buildPurgePlan, createResetSteps, purgeManagedPaths } from './reset.service';

const identity = { puid: 1000, pgid: 1000 };

describe('reset', () => {
  let sandbox: string;
  let layout: MbHomeLayout;
  let caddyData: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-reset-'));
    layout = createLayout(join(sandbox, 'home'));
    ensureHostTree(layout, identity, { runAsRoot: false });
    caddyData = join(layout.configFor('caddy'), 'data');

    writeFileSync(layout.stateFile, '{}');
    writeFileSync(layout.envFile, 'MB_HOME=x\n');
    mkdirSync(join(layout.root, 'app', '.git'), { recursive: true });
    writeFileSync(join(layout.root, 'app', 'package.json'), '{}');
    writeFileSync(join(caddyData, 'certificate.crt'), 'cert');
    mkdirSync(join(caddyData, 'acme'), { recursive: true });
    writeFileSync(join(caddyData, 'acme', 'account.json'), '{}');
    writeFileSync(join(layout.configFor('caddy'), 'Caddyfile'), 'caddy');
    writeFileSync(join(layout.configFor('caddy'), 'config', 'autosave.json'), '{}');
    writeFileSync(join(layout.configFor('sonarr'), 'sonarr.db'), 'db');
    writeFileSync(join(layout.configFor('jellyfin'), 'config.xml'), '<x/>');
    writeFileSync(join(layout.cacheDir, 'jellyfin', 'cache.bin'), 'cache');
    writeFileSync(join(layout.mediaDir, 'movies', 'movie.mkv'), 'media');
    symlinkSync('/nonexistent/debrid/file', join(layout.downloadsDir, 'radarr', 'link'));
    writeFileSync(join(layout.debridMountDir, 'leftover'), 'x');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  describe('purgeManagedPaths', () => {
    it('removes the managed paths and keeps app, env, state and the Caddy certificates', async () => {
      const removed = await purgeManagedPaths(buildPurgePlan(layout));

      expect(removed).toBeGreaterThan(0);
      expect(existsSync(layout.stateFile)).toBe(true);
      expect(existsSync(layout.envFile)).toBe(true);
      expect(existsSync(join(layout.root, 'app', 'package.json'))).toBe(true);
      expect(existsSync(join(caddyData, 'certificate.crt'))).toBe(true);
      expect(existsSync(join(caddyData, 'acme', 'account.json'))).toBe(true);

      expect(existsSync(layout.configDir)).toBe(true);
      expect(existsSync(join(layout.configFor('caddy'), 'Caddyfile'))).toBe(false);
      expect(existsSync(join(layout.configFor('caddy'), 'config'))).toBe(false);
      expect(existsSync(layout.configFor('sonarr'))).toBe(false);
      expect(existsSync(layout.configFor('jellyfin'))).toBe(false);
      expect(existsSync(layout.cacheDir)).toBe(false);
      expect(existsSync(layout.dataDir)).toBe(false);
      expect(existsSync(layout.debridMountDir)).toBe(true);
      expect(existsSync(join(layout.debridMountDir, 'leftover'))).toBe(false);
    });

    it('can run twice and tolerates missing directories', async () => {
      await purgeManagedPaths(buildPurgePlan(layout));

      await expect(purgeManagedPaths(buildPurgePlan(layout))).resolves.toBeTypeOf('number');
      expect(existsSync(join(caddyData, 'certificate.crt'))).toBe(true);
    });

    it('never touches paths outside the explicit plan', async () => {
      const sibling = join(sandbox, 'home', 'extra');
      mkdirSync(sibling);
      writeFileSync(join(sibling, 'keep.txt'), 'keep');

      await purgeManagedPaths({
        clearDirectories: [layout.configDir],
        removePaths: [],
        preservePaths: [],
      });

      expect(existsSync(join(sibling, 'keep.txt'))).toBe(true);
      expect(existsSync(layout.dataDir)).toBe(true);
      expect(existsSync(layout.configFor('sonarr'))).toBe(false);
    });
  });

  describe('createResetSteps', () => {
    const context = (): ProvisionContext => ({
      config: createDefaultConfig({ host: identity }),
      secrets: { rdApiToken: 't', adminUsername: 'a', adminPassword: 'p' },
      layout,
      identity,
      runtime: { up: vi.fn(), waitHealthy: vi.fn(), reloadGateway: vi.fn() },
      flags: new Map(),
      cliVersion: '0.0.0',
    });
    const signal = new AbortController().signal;

    it('declares the three reset-only steps in order', () => {
      const steps = createResetSteps({ runner: { down: vi.fn() }, layout });

      expect(steps.map((step) => [step.id, step.scopes])).toEqual([
        ['reset-stop', ['reset']],
        ['reset-verify-unmounted', ['reset']],
        ['reset-purge', ['reset']],
      ]);
    });

    it('stops the containers with the pipeline signal', async () => {
      const down = vi.fn(async () => undefined);
      const [stop] = createResetSteps({ runner: { down }, layout });

      await stop!.run(context(), signal);

      expect(down).toHaveBeenCalledWith({ signal });
    });

    it('aborts with the umount suggestion while the debrid mount is active', async () => {
      const steps = createResetSteps({
        runner: { down: vi.fn() },
        layout,
        platform: 'linux',
        isMounted: async () => true,
      });

      await expect(steps[1]!.run(context(), signal)).rejects.toThrow(
        `sudo umount -l ${layout.debridMountDir}`,
      );
    });

    it('passes the mount verification when nothing is mounted or on other platforms', async () => {
      const unmounted = createResetSteps({
        runner: { down: vi.fn() },
        layout,
        platform: 'linux',
        isMounted: async () => false,
      });
      const macos = createResetSteps({ runner: { down: vi.fn() }, layout, platform: 'darwin' });

      await expect(unmounted[1]!.run(context(), signal)).resolves.toMatchObject({
        status: 'unchanged',
      });
      await expect(macos[1]!.run(context(), signal)).resolves.toMatchObject({ status: 'skipped' });
    });

    it('purges the managed paths', async () => {
      const steps = createResetSteps({ runner: { down: vi.fn() }, layout });

      const outcome = await steps[2]!.run(context(), signal);

      expect(outcome.status).toBe('changed');
      expect(existsSync(layout.dataDir)).toBe(false);
      expect(existsSync(join(caddyData, 'certificate.crt'))).toBe(true);
    });
  });
});

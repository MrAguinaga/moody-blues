import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig, createLayout, readState, writeState } from '@moody-blues/provisioner';

import { applyUpdate, inspectUpdate, type UpdateDeps } from './update.service';
import type { CommandRunner, ReleaseInfo } from './update.types';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const RELEASE: ReleaseInfo = {
  tag: 'v0.2.0',
  version: '0.2.0',
  url: 'https://example.test/v0.2.0',
  body: '- Notes',
};

describe('update service', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'mb-update-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const installState = () => {
    const layout = createLayout(home);
    writeState(layout.stateFile, createDefaultConfig());
    return layout;
  };

  describe('inspectUpdate', () => {
    const inspect = (deps: Partial<UpdateDeps>, useCache: boolean) =>
      inspectUpdate({
        home,
        currentVersion: '0.1.0',
        useCache,
        signal: new AbortController().signal,
        deps: { now: () => NOW, ...deps },
      });

    it('stores the release in moody-blues.json and reuses it for an hour', async () => {
      const layout = installState();
      const fetchRelease = vi.fn(async () => RELEASE);

      const first = await inspect({ fetchRelease }, true);
      const second = await inspect({ fetchRelease }, true);

      expect(first).toMatchObject({
        installed: true,
        check: { source: 'github', updateAvailable: true },
      });
      expect(second.check).toMatchObject({ source: 'cache', updateAvailable: true });
      expect(fetchRelease).toHaveBeenCalledTimes(1);
      expect(readState(layout.stateFile)?.updateCheck).toEqual({
        checkedAt: NOW.toISOString(),
        tag: 'v0.2.0',
        url: RELEASE.url,
        body: RELEASE.body,
      });
    });

    it('does not read the cache when it is not wanted', async () => {
      installState();
      const fetchRelease = vi.fn(async () => RELEASE);

      await inspect({ fetchRelease }, true);
      await inspect({ fetchRelease }, false);

      expect(fetchRelease).toHaveBeenCalledTimes(2);
    });

    it('does not cache the absence of releases', async () => {
      const layout = installState();

      const result = await inspect({ fetchRelease: async () => undefined }, true);

      expect(result.check.updateAvailable).toBe(false);
      expect(readState(layout.stateFile)?.updateCheck).toBeUndefined();
    });

    it('works before the setup without writing any state', async () => {
      const result = await inspect({ fetchRelease: async () => RELEASE }, true);

      expect(result).toMatchObject({ installed: false, check: { updateAvailable: true } });
      expect(readState(createLayout(home).stateFile)).toBeUndefined();
    });

    it('passes the CLI version to the release request', async () => {
      const fetchRelease = vi.fn(async () => RELEASE);

      await inspect({ fetchRelease }, true);

      expect(fetchRelease).toHaveBeenCalledWith('0.1.0', expect.any(AbortSignal));
    });
  });

  describe('applyUpdate', () => {
    function harness(options: { failRedeploy?: boolean } = {}) {
      const calls: { command: string; args: string[]; cwd: string }[] = [];
      const lines: string[] = [];
      const run: CommandRunner = async (command, args, runOptions) => {
        calls.push({ command, args: [...args], cwd: runOptions.cwd });
        if (command === process.execPath) {
          runOptions.onLine?.('redeploy line');
          if (options.failRedeploy) {
            throw new Error('exit 1');
          }
        }
        return command === 'git' && args[0] === 'symbolic-ref' ? 'main' : '';
      };
      const deps: Partial<UpdateDeps> = { run, findCodeDir: () => '/code', now: () => NOW };
      return { calls, lines, deps };
    }

    const apply = (
      deps: Partial<UpdateDeps>,
      patch: Partial<Parameters<typeof applyUpdate>[0]> = {},
    ) =>
      applyUpdate({
        release: RELEASE,
        installed: true,
        json: false,
        signal: new AbortController().signal,
        deps,
        ...patch,
      });

    it('updates the code and then redeploys with the freshly built CLI', async () => {
      const { calls, deps } = harness();
      const lines: string[] = [];

      const result = await apply(deps, { home: '/srv/mb', onLine: (line) => lines.push(line) });

      expect(result).toMatchObject({ success: true, codeUpdated: true, redeployed: true });
      expect(result.steps.map(({ id }) => id)).toEqual([
        'check-clean',
        'git-fetch',
        'git-checkout',
        'install',
        'build',
        'redeploy',
      ]);
      expect(calls.at(-1)).toEqual({
        command: process.execPath,
        args: [
          '/code/apps/cli/dist/main.js',
          'update',
          '--redeploy',
          '--headless',
          '--home',
          '/srv/mb',
        ],
        cwd: '/code',
      });
      expect(lines).toEqual(['redeploy line']);
    });

    it('asks the new CLI for JSON in json mode and does not stream its lines', async () => {
      const { calls, deps } = harness();
      const lines: string[] = [];

      await apply(deps, { json: true, onLine: (line) => lines.push(line) });

      expect(calls.at(-1)?.args).toEqual([
        '/code/apps/cli/dist/main.js',
        'update',
        '--redeploy',
        '--json',
      ]);
      expect(lines).toEqual([]);
    });

    it('stops after the code when the stack is not set up yet', async () => {
      const { calls, deps } = harness();

      const result = await apply(deps, { installed: false });

      expect(result).toMatchObject({ success: true, codeUpdated: true, redeployed: false });
      expect(calls.some(({ command }) => command === process.execPath)).toBe(false);
    });

    it('reports the code as updated when the redeploy fails, with the retry hint', async () => {
      const { deps } = harness({ failRedeploy: true });

      const result = await apply(deps);

      expect(result).toMatchObject({ success: false, codeUpdated: true, redeployed: false });
      expect(result.steps.at(-1)).toMatchObject({
        id: 'redeploy',
        status: 'failed',
        message: 'The redeploy failed. Repeat it with "moody-blues update --redeploy".',
      });
    });

    it('does not redeploy when the code update fails', async () => {
      const { calls } = harness();
      const run: CommandRunner = async (command, args) => {
        calls.push({ command, args: [...args], cwd: '' });
        if (args[0] === 'status') {
          return ' M package.json\n';
        }
        return '';
      };

      const result = await apply({ run, findCodeDir: () => '/code' });

      expect(result).toMatchObject({ success: false, codeUpdated: false, redeployed: false });
      expect(calls.some(({ command }) => command === process.execPath)).toBe(false);
    });
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ContainerRuntime,
  createDefaultConfig,
  createLayout,
  type ProvisionStep,
  writeState,
} from '@moody-blues/provisioner';

import type { CommandRunner, ReleaseInfo } from '../update';
import { UpdateCheckError } from '../update';
import { createUpdateCommand, executeUpdate, type UpdateSettings } from './update.command';

vi.mock('../utils/command.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/command.utils')>()),
  abortOnInterrupt: () => new AbortController(),
}));

const NOW = new Date('2026-10-10T12:00:00.000Z');
const RELEASE: ReleaseInfo = {
  tag: 'v0.2.0',
  version: '0.2.0',
  url: 'https://example.test/v0.2.0',
  body: '- Faster updates',
};
const ENV = {
  MB_HOME: '/srv/moody-blues',
  RD_API_TOKEN: 'rd-test-token',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'test-password',
};
const runtime: ContainerRuntime = {
  up: async () => undefined,
  waitHealthy: async () => undefined,
  reloadGateway: async () => undefined,
};

describe('update command', () => {
  let home: string;
  let output: string[];
  let errors: string[];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'mb-update-cmd-'));
    writeState(createLayout(home).stateFile, createDefaultConfig());
    output = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      output.push(message);
    });
    vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });
  });

  afterEach(async () => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  function harness(
    options: { release?: ReleaseInfo | undefined | Error; failRedeploy?: boolean } = {},
  ) {
    const commands: string[] = [];
    const run: CommandRunner = async (command, args, runOptions) => {
      commands.push([command === process.execPath ? 'node' : command, ...args].join(' '));
      if (command === process.execPath) {
        runOptions.onLine?.('Pulling the container images...');
        if (options.failRedeploy) {
          throw new Error('exit 1');
        }
      }
      return command === 'git' && args[0] === 'symbolic-ref' ? 'main' : '';
    };
    const release = 'release' in options ? options.release : RELEASE;
    const fetchRelease = vi.fn(async () => {
      if (release instanceof Error) {
        throw release;
      }
      return release;
    });
    return {
      commands,
      fetchRelease,
      deps: { run, fetchRelease, findCodeDir: () => '/code', now: () => NOW },
    };
  }

  const settings = (
    deps: UpdateSettings['deps'],
    patch: Partial<UpdateSettings> = {},
  ): UpdateSettings => ({
    check: false,
    refresh: false,
    redeploy: false,
    home,
    yes: false,
    mode: 'headless',
    version: '0.1.0',
    deps,
    ...patch,
  });

  it('declares the documented options and rejects incompatible ones', async () => {
    const command = createUpdateCommand('0.0.0');

    expect(command.options.map((option) => option.long)).toEqual([
      '--check',
      '--refresh',
      '--redeploy',
      '--home',
    ]);
    command.exitOverride().configureOutput({ writeErr: () => undefined });
    await expect(command.parseAsync(['--check', '--redeploy'], { from: 'user' })).rejects.toThrow(
      /cannot be used with/,
    );
  });

  describe('--check', () => {
    it('shows the update with its changelog and changes nothing', async () => {
      const { commands, deps } = harness();

      await executeUpdate(settings(deps, { check: true }));

      expect(output).toContain('Update available: v0.1.0 -> v0.2.0');
      expect(output).toContain('  - Faster updates');
      expect(commands).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });

    it('answers from the cache on the second call and ignores it with --refresh', async () => {
      const { deps, fetchRelease } = harness();

      await executeUpdate(settings(deps, { check: true }));
      await executeUpdate(settings(deps, { check: true }));
      await executeUpdate(settings(deps, { check: true, refresh: true }));

      expect(fetchRelease).toHaveBeenCalledTimes(2);
    });

    it('prints JSON', async () => {
      const { deps } = harness();

      await executeUpdate(settings(deps, { check: true, mode: 'json' }));

      expect(JSON.parse(output.join('\n'))).toMatchObject({
        success: true,
        current: '0.1.0',
        latest: 'v0.2.0',
        updateAvailable: true,
      });
    });

    it('reports up to date with exit code 0 when no release exists', async () => {
      const { deps } = harness({ release: undefined });

      await executeUpdate(settings(deps, { check: true }));

      expect(output).toContain(
        '✔ No release has been published yet. Moody Blues v0.1.0 is up to date.',
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('reports a GitHub failure clearly with exit code 1', async () => {
      const { deps } = harness({
        release: new UpdateCheckError('Could not reach GitHub to look for releases: offline.'),
      });

      await executeUpdate(settings(deps, { check: true }));

      expect(errors).toEqual(['✖ Could not reach GitHub to look for releases: offline.']);
      expect(process.exitCode).toBe(1);
    });

    it('reports a GitHub failure as JSON', async () => {
      const { deps } = harness({ release: new UpdateCheckError('offline') });

      await executeUpdate(settings(deps, { check: true, mode: 'json' }));

      expect(JSON.parse(output.join('\n'))).toEqual({ success: false, error: 'offline' });
      expect(process.exitCode).toBe(1);
    });
  });

  describe('update', () => {
    it('says up to date and exits 0 when the release is not newer', async () => {
      const { commands, deps } = harness({
        release: { ...RELEASE, tag: 'v0.1.0', version: '0.1.0' },
      });

      await executeUpdate(settings(deps, { yes: true }));

      expect(output).toContain('✔ Moody Blues v0.1.0 is up to date (latest release: v0.1.0).');
      expect(commands).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });

    it('does not update headless without --yes', async () => {
      const { commands, deps } = harness();

      await executeUpdate(settings(deps));

      expect(output).toContain('Update available: v0.1.0 -> v0.2.0');
      expect(errors).toEqual(['✖ Nothing was changed. Pass --yes to update non-interactively.']);
      expect(commands).toEqual([]);
      expect(process.exitCode).toBe(1);
    });

    it('refuses in JSON mode without --yes', async () => {
      const { commands, deps } = harness();

      await executeUpdate(settings(deps, { mode: 'json' }));

      expect(JSON.parse(output.join('\n'))).toMatchObject({
        success: false,
        updated: false,
        error: 'Nothing was changed. Pass --yes to update non-interactively.',
      });
      expect(commands).toEqual([]);
      expect(process.exitCode).toBe(1);
    });

    it('updates the code and redeploys with --yes', async () => {
      const { commands, deps } = harness();

      await executeUpdate(settings(deps, { yes: true }));

      expect(commands).toEqual([
        'git status --porcelain --untracked-files=no',
        'git symbolic-ref --quiet --short HEAD',
        'git fetch --tags --force origin',
        'git checkout --quiet --detach refs/tags/v0.2.0',
        'pnpm install --frozen-lockfile',
        'pnpm build',
        `node /code/apps/cli/dist/main.js update --redeploy --headless --home ${home}`,
      ]);
      expect(output).toContain('Fetch the release tags...');
      expect(output).toContain('      Pulling the container images...');
      expect(output.at(-1)).toBe(
        '✔ Moody Blues was updated to v0.2.0 and the stack was redeployed. Check it with "moody-blues status".',
      );
      expect(process.exitCode).toBe(0);
    });

    it('always asks GitHub when applying, even with a fresh cache', async () => {
      const { deps, fetchRelease } = harness();

      await executeUpdate(settings(deps, { check: true }));
      await executeUpdate(settings(deps, { yes: true }));

      expect(fetchRelease).toHaveBeenCalledTimes(2);
    });

    it('prints JSON with the steps', async () => {
      const { deps } = harness();

      await executeUpdate(settings(deps, { yes: true, mode: 'json' }));

      const report = JSON.parse(output.join('\n'));
      expect(report).toMatchObject({
        success: true,
        target: '0.2.0',
        updated: true,
        redeployed: true,
      });
      expect(report.steps.map((step: { id: string }) => step.id).at(-1)).toBe('redeploy');
    });

    it('exits 2 when the code is updated but the redeploy fails', async () => {
      const { deps } = harness({ failRedeploy: true });

      await executeUpdate(settings(deps, { yes: true }));

      expect(errors).toEqual([
        '✖ The code is now v0.2.0, but redeploying the stack failed. Repeat it with "moody-blues update --redeploy".',
      ]);
      expect(process.exitCode).toBe(2);
    });

    it('exits 1 and names the failed step when the code update fails', async () => {
      const { deps } = harness();
      const failing: CommandRunner = async (command, args, runOptions) => {
        if (command === 'pnpm' && args[0] === 'build' && !runOptions.env?.ROLLBACK) {
          throw new Error('tsup exploded');
        }
        return command === 'git' && args[0] === 'symbolic-ref' ? 'main' : '';
      };

      await executeUpdate(settings({ ...deps, run: failing }, { yes: true }));

      expect(errors[0]).toContain(
        'The update to v0.2.0 failed at "Build the packages and the CLI".',
      );
      expect(process.exitCode).toBe(1);
    });

    it('skips the redeploy and points to setup when nothing is installed yet', async () => {
      const { commands, deps } = harness();
      const empty = await mkdtemp(join(tmpdir(), 'mb-update-empty-'));

      try {
        await executeUpdate(settings(deps, { yes: true, home: empty }));
      } finally {
        await rm(empty, { recursive: true, force: true });
      }

      expect(commands.some((command) => command.startsWith('node '))).toBe(false);
      expect(output.at(-1)).toBe(
        '✔ The code was updated to v0.2.0. Run "moody-blues setup --env-file <path>" to provision it.',
      );
    });

    it('reports a dirty code directory without changing anything', async () => {
      const { deps } = harness();
      const run: CommandRunner = async (_command, args) =>
        args[0] === 'status' ? ' M package.json\n' : '';

      await executeUpdate(settings({ ...deps, run }, { yes: true }));

      expect(output.some((line) => line.includes('has local changes'))).toBe(true);
      expect(errors[0]).toContain('failed at "Check the code directory"');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('--redeploy', () => {
    const redeployDeps = (options: { pullFails?: boolean } = {}) => {
      const steps: ProvisionStep[] = [
        {
          id: 'containers-up',
          title: 'Start',
          scopes: ['setup'],
          run: async () => ({ status: 'changed' }),
        },
      ];
      return {
        load: () => ({
          layout: createLayout('/srv/moody-blues'),
          config: createDefaultConfig(),
          env: ENV,
        }),
        createRunner: () => ({
          pull: async () => {
            if (options.pullFails) {
              throw new Error('registry unreachable');
            }
          },
        }),
        createRuntime: () => runtime,
        detectCpus: async () => 2,
        pipeline: steps,
      };
    };

    it('pulls and reprovisions with the installed code', async () => {
      await executeUpdate(settings(undefined, { redeploy: true, redeployDeps: redeployDeps() }));

      expect(output).toContain('Pulling the container images...');
      expect(output.some((line) => line.includes('Start'))).toBe(true);
      expect(output.at(-1)).toBe(
        '✔ The stack is redeployed and provisioned. Check it with "moody-blues status".',
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('prints JSON', async () => {
      await executeUpdate(
        settings(undefined, { redeploy: true, mode: 'json', redeployDeps: redeployDeps() }),
      );

      expect(JSON.parse(output.join('\n'))).toMatchObject({ success: true, pulled: true });
    });

    it('exits 1 with the reason when the pull fails', async () => {
      await executeUpdate(
        settings(undefined, { redeploy: true, redeployDeps: redeployDeps({ pullFails: true }) }),
      );

      expect(errors).toEqual(['✖ registry unreachable']);
      expect(process.exitCode).toBe(1);
    });
  });
});

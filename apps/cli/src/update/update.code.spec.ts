import { describe, expect, it, vi } from 'vitest';

import { runCodeUpdate } from './update.code';
import type { CommandRunner, ReleaseInfo } from './update.types';

const RELEASE: ReleaseInfo = { tag: 'v0.2.0', version: '0.2.0', url: '', body: '' };

interface Call {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

function scriptedRunner(answers: Record<string, string | Error | (() => string | Error)> = {}): {
  run: CommandRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, env: options.env });
    const key = [command, ...args].join(' ');
    const answer = answers[key];
    const resolved = typeof answer === 'function' ? answer() : answer;
    if (resolved instanceof Error) {
      throw resolved;
    }
    return resolved ?? '';
  };
  return { run, calls };
}

const commands = (calls: Call[]) => calls.map(({ command, args }) => [command, ...args].join(' '));

describe('runCodeUpdate', () => {
  it('fetches the tags, checks out the tag, installs and builds in the code directory', async () => {
    const { run, calls } = scriptedRunner({ 'git symbolic-ref --quiet --short HEAD': 'main\n' });
    const titles: string[] = [];

    const result = await runCodeUpdate({
      codeDir: '/usr/local/lib/moody-blues',
      release: RELEASE,
      run,
      signal: new AbortController().signal,
      onStart: (title) => titles.push(title),
    });

    expect(result.success).toBe(true);
    expect(result.steps.map(({ id, status }) => [id, status])).toEqual([
      ['check-clean', 'ok'],
      ['git-fetch', 'ok'],
      ['git-checkout', 'ok'],
      ['install', 'ok'],
      ['build', 'ok'],
    ]);
    expect(commands(calls)).toEqual([
      'git status --porcelain --untracked-files=no',
      'git symbolic-ref --quiet --short HEAD',
      'git fetch --tags --force origin',
      'git checkout --quiet --detach refs/tags/v0.2.0',
      'pnpm install --frozen-lockfile',
      'pnpm build',
    ]);
    expect(calls.every(({ cwd }) => cwd === '/usr/local/lib/moody-blues')).toBe(true);
    expect(calls.at(-1)?.env).toMatchObject({ CI: 'true', HUSKY: '0' });
    expect(titles).toEqual(result.steps.map(({ title }) => title));
  });

  it('refuses to touch a code directory with local changes', async () => {
    const { run, calls } = scriptedRunner({
      'git status --porcelain --untracked-files=no': ' M apps/cli/src/cli.ts\n M package.json\n',
    });

    const result = await runCodeUpdate({
      codeDir: '/code',
      release: RELEASE,
      run,
      signal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.message).toContain('M apps/cli/src/cli.ts, M package.json');
    expect(commands(calls)).toEqual(['git status --porcelain --untracked-files=no']);
  });

  it('stops without a rollback when the fetch or the checkout fails', async () => {
    const { run, calls } = scriptedRunner({
      'git symbolic-ref --quiet --short HEAD': 'main',
      'git fetch --tags --force origin': new Error('network down'),
    });

    const result = await runCodeUpdate({
      codeDir: '/code',
      release: RELEASE,
      run,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ success: false, rolledBack: false });
    expect(result.steps.at(-1)).toMatchObject({
      id: 'git-fetch',
      status: 'failed',
      message: 'network down',
    });
    expect(commands(calls)).not.toContain('pnpm build');
  });

  it('rolls back to the previous branch and rebuilds when the build fails', async () => {
    let builds = 0;
    const { run, calls } = scriptedRunner({
      'git symbolic-ref --quiet --short HEAD': 'main',
      'pnpm build': () => (builds++ === 0 ? new Error('tsup exploded') : ''),
    });

    const result = await runCodeUpdate({
      codeDir: '/code',
      release: RELEASE,
      run,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ success: false, rolledBack: true });
    expect(result.steps.map(({ id, status }) => [id, status]).slice(-2)).toEqual([
      ['build', 'failed'],
      ['rollback', 'ok'],
    ]);
    expect(commands(calls).slice(-3)).toEqual([
      'git checkout --quiet main',
      'pnpm install --frozen-lockfile',
      'pnpm build',
    ]);
  });

  it('rolls back to the commit when the checkout was detached', async () => {
    const { run, calls } = scriptedRunner({
      'git symbolic-ref --quiet --short HEAD': new Error('not a symbolic ref'),
      'git rev-parse HEAD': 'abc123\n',
      'pnpm install --frozen-lockfile': (() => {
        let count = 0;
        return () => (count++ === 0 ? new Error('lockfile mismatch') : '');
      })(),
    });

    const result = await runCodeUpdate({
      codeDir: '/code',
      release: RELEASE,
      run,
      signal: new AbortController().signal,
    });

    expect(result.rolledBack).toBe(true);
    expect(commands(calls)).toContain('git checkout --quiet abc123');
  });

  it('reports a failed rollback with the manual recovery command', async () => {
    const { run } = scriptedRunner({
      'git symbolic-ref --quiet --short HEAD': 'main',
      'pnpm install --frozen-lockfile': new Error('registry unreachable'),
    });

    const result = await runCodeUpdate({
      codeDir: '/code',
      release: RELEASE,
      run,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ success: false, rolledBack: false });
    expect(result.steps.at(-1)).toMatchObject({ id: 'rollback', status: 'failed' });
    expect(result.steps.at(-1)?.message).toContain('git checkout main');
  });

  it('rethrows an interruption instead of recording a failure', async () => {
    const controller = new AbortController();
    const run = vi.fn<CommandRunner>(async (command, args) => {
      if (args[0] === 'fetch') {
        controller.abort();
        throw controller.signal.reason;
      }
      return command === 'git' && args[0] === 'symbolic-ref' ? 'main' : '';
    });

    await expect(
      runCodeUpdate({ codeDir: '/code', release: RELEASE, run, signal: controller.signal }),
    ).rejects.toBeDefined();
  });
});

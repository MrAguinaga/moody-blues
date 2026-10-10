import { errorMessage } from '../utils/command.utils';
import type {
  CommandOptions,
  CommandRunner,
  ReleaseInfo,
  UpdateStepId,
  UpdateStepResult,
} from './update.types';

const BUILD_ENV: NodeJS.ProcessEnv = {
  CI: 'true',
  HUSKY: '0',
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
};
const MAX_LISTED_CHANGES = 5;

type Runner = (
  command: string,
  args: readonly string[],
  extra?: Partial<CommandOptions>,
) => Promise<string>;

export interface RunCodeUpdateOptions {
  codeDir: string;
  release: ReleaseInfo;
  run: CommandRunner;
  signal: AbortSignal;
  now?: () => number;
  onStart?: (title: string) => void;
  onStep?: (step: UpdateStepResult) => void;
}

export interface CodeUpdateResult {
  success: boolean;
  steps: UpdateStepResult[];
  rolledBack: boolean;
}

async function resolvePreviousRef(run: Runner): Promise<string> {
  const branch = await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '');
  return branch.trim() || (await run('git', ['rev-parse', 'HEAD'])).trim();
}

async function assertCleanTree(run: Runner, codeDir: string): Promise<void> {
  const status = await run('git', ['status', '--porcelain', '--untracked-files=no']);
  const changes = status.split('\n').filter((line) => line.trim().length > 0);
  if (changes.length === 0) {
    return;
  }
  const listed = changes.slice(0, MAX_LISTED_CHANGES).map((line) => line.trim());
  const more =
    changes.length > MAX_LISTED_CHANGES ? ` and ${changes.length - MAX_LISTED_CHANGES} more` : '';
  throw new Error(
    `The code directory ${codeDir} has local changes (${listed.join(', ')}${more}). ` +
      'Commit or discard them before updating.',
  );
}

async function rebuild(run: Runner): Promise<void> {
  await run('pnpm', ['install', '--frozen-lockfile'], { env: BUILD_ENV });
  await run('pnpm', ['build'], { env: BUILD_ENV });
}

export async function runCodeUpdate(options: RunCodeUpdateOptions): Promise<CodeUpdateResult> {
  const { codeDir, release, signal } = options;
  const clock = options.now ?? Date.now;
  const steps: UpdateStepResult[] = [];
  const run: Runner = (command, args, extra = {}) =>
    options.run(command, args, { cwd: codeDir, signal, ...extra });

  let previousRef = '';
  let checkedOut = false;

  async function perform(
    id: UpdateStepId,
    title: string,
    action: () => Promise<void>,
  ): Promise<boolean> {
    options.onStart?.(title);
    const startedAt = clock();
    try {
      await action();
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const step: UpdateStepResult = {
        id,
        title,
        status: 'failed',
        message: errorMessage(error),
        durationMs: clock() - startedAt,
      };
      steps.push(step);
      options.onStep?.(step);
      return false;
    }
    const step: UpdateStepResult = {
      id,
      title,
      status: 'ok',
      durationMs: clock() - startedAt,
    };
    steps.push(step);
    options.onStep?.(step);
    return true;
  }

  const phases: [UpdateStepId, string, () => Promise<void>][] = [
    [
      'check-clean',
      'Check the code directory',
      async () => {
        await assertCleanTree(run, codeDir);
        previousRef = await resolvePreviousRef(run);
      },
    ],
    [
      'git-fetch',
      'Fetch the release tags',
      async () => {
        await run('git', ['fetch', '--tags', '--force', 'origin']);
      },
    ],
    [
      'git-checkout',
      `Check out ${release.tag}`,
      async () => {
        await run('git', ['checkout', '--quiet', '--detach', `refs/tags/${release.tag}`]);
        checkedOut = true;
      },
    ],
    [
      'install',
      'Install dependencies',
      async () => {
        await run('pnpm', ['install', '--frozen-lockfile'], { env: BUILD_ENV });
      },
    ],
    [
      'build',
      'Build the packages and the CLI',
      async () => {
        await run('pnpm', ['build'], { env: BUILD_ENV });
      },
    ],
  ];

  for (const [id, title, action] of phases) {
    if (!(await perform(id, title, action))) {
      const rolledBack = checkedOut
        ? await perform('rollback', `Roll back to ${previousRef}`, async () => {
            try {
              await run('git', ['checkout', '--quiet', previousRef]);
              await rebuild(run);
            } catch (error) {
              if (signal.aborted) {
                throw error;
              }
              throw new Error(
                `${errorMessage(error)} Restore it by hand in ${codeDir}: ` +
                  `git checkout ${previousRef} && pnpm install --frozen-lockfile && pnpm build`,
              );
            }
          })
        : false;
      return { success: false, steps, rolledBack };
    }
  }

  return { success: true, steps, rolledBack: false };
}

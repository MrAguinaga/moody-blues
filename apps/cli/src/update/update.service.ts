import { join } from 'node:path';

import { createLayout, resolveMbHome } from '@moody-blues/provisioner';

import { errorMessage } from '../utils/command.utils';
import { fetchLatestRelease } from './release.client';
import { cacheFromRelease, readInstalledState, storeUpdateCache } from './update.cache';
import { checkForUpdate } from './update.check';
import { runCodeUpdate } from './update.code';
import { CLI_ENTRYPOINT, findCodeDir } from './update.code-dir';
import { spawnCommand } from './update.exec';
import type { CommandRunner, ReleaseInfo, UpdateCheck, UpdateStepResult } from './update.types';

export const REDEPLOY_HINT = 'Repeat it with "moody-blues update --redeploy".';

export interface UpdateDeps {
  fetchRelease(cliVersion: string, signal: AbortSignal): Promise<ReleaseInfo | undefined>;
  run: CommandRunner;
  findCodeDir(): string;
  now(): Date;
}

const DEFAULT_DEPS: UpdateDeps = {
  fetchRelease: (cliVersion, signal) => fetchLatestRelease({ cliVersion, signal }),
  run: spawnCommand,
  findCodeDir: () => findCodeDir(),
  now: () => new Date(),
};

export interface InspectUpdateOptions {
  home?: string;
  currentVersion: string;
  useCache: boolean;
  signal: AbortSignal;
  deps?: Partial<UpdateDeps>;
}

export interface UpdateInspection {
  check: UpdateCheck;
  installed: boolean;
}

export async function inspectUpdate(options: InspectUpdateOptions): Promise<UpdateInspection> {
  const deps: UpdateDeps = { ...DEFAULT_DEPS, ...options.deps };
  const layout = createLayout(resolveMbHome({ explicit: options.home }));
  const state = readInstalledState(layout);
  const now = deps.now();

  const check = await checkForUpdate({
    currentVersion: options.currentVersion,
    cache: state?.updateCheck,
    useCache: options.useCache,
    now,
    fetchRelease: () => deps.fetchRelease(options.currentVersion, options.signal),
  });

  if (state && check.source === 'github' && check.latest) {
    storeUpdateCache(layout, state, cacheFromRelease(check.latest, now));
  }
  return { check, installed: state !== undefined };
}

export interface ApplyUpdateOptions {
  release: ReleaseInfo;
  installed: boolean;
  home?: string;
  json: boolean;
  signal: AbortSignal;
  deps?: Partial<UpdateDeps>;
  onStart?: (title: string) => void;
  onStep?: (step: UpdateStepResult) => void;
  onLine?: (line: string) => void;
}

export interface ApplyUpdateResult {
  success: boolean;
  codeUpdated: boolean;
  redeployed: boolean;
  rolledBack: boolean;
  steps: UpdateStepResult[];
}

async function redeployWithNewCode(
  options: ApplyUpdateOptions,
  deps: UpdateDeps,
  codeDir: string,
): Promise<UpdateStepResult> {
  const title = 'Pull the images and reapply the provisioning';
  const startedAt = Date.now();
  options.onStart?.(title);

  const args = [
    join(codeDir, CLI_ENTRYPOINT),
    'update',
    '--redeploy',
    options.json ? '--json' : '--headless',
    ...(options.home ? ['--home', options.home] : []),
  ];
  try {
    await deps.run(process.execPath, args, {
      cwd: codeDir,
      signal: options.signal,
      onLine: options.json ? undefined : options.onLine,
    });
    return { id: 'redeploy', title, status: 'ok', durationMs: Date.now() - startedAt };
  } catch (error) {
    if (options.signal.aborted) {
      throw error;
    }
    return {
      id: 'redeploy',
      title,
      status: 'failed',
      message: options.json ? errorMessage(error) : `The redeploy failed. ${REDEPLOY_HINT}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function applyUpdate(options: ApplyUpdateOptions): Promise<ApplyUpdateResult> {
  const deps: UpdateDeps = { ...DEFAULT_DEPS, ...options.deps };
  const codeDir = deps.findCodeDir();

  const code = await runCodeUpdate({
    codeDir,
    release: options.release,
    run: deps.run,
    signal: options.signal,
    onStart: options.onStart,
    onStep: options.onStep,
  });
  if (!code.success) {
    return {
      success: false,
      codeUpdated: false,
      redeployed: false,
      rolledBack: code.rolledBack,
      steps: code.steps,
    };
  }
  if (!options.installed) {
    return {
      success: true,
      codeUpdated: true,
      redeployed: false,
      rolledBack: false,
      steps: code.steps,
    };
  }

  const redeploy = await redeployWithNewCode(options, deps, codeDir);
  options.onStep?.(redeploy);
  return {
    success: redeploy.status === 'ok',
    codeUpdated: true,
    redeployed: redeploy.status === 'ok',
    rolledBack: false,
    steps: [...code.steps, redeploy],
  };
}

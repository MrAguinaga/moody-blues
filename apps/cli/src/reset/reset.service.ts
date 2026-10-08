import { readdir, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';

import {
  type ContainerRuntime,
  INFRASTRUCTURE_STEPS,
  type MbHomeLayout,
  parseUserSecrets,
  type PipelineEvent,
  type PipelineReport,
  type ProvisionStep,
  runPipeline,
} from '@moody-blues/provisioner';

import {
  type ComposeRunner,
  createComposeRunner,
  createComposeRuntime,
  isMountActive,
} from '../docker';
import { loadInstallation } from '../installation';

export interface PurgePlan {
  clearDirectories: string[];
  removePaths: string[];
  preservePaths: string[];
}

export function buildPurgePlan(layout: MbHomeLayout): PurgePlan {
  return {
    clearDirectories: [layout.configDir, layout.debridMountDir],
    removePaths: [layout.cacheDir, layout.dataDir],
    preservePaths: [join(layout.configFor('caddy'), 'data')],
  };
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM';
}

async function removeExcept(path: string, preserve: readonly string[]): Promise<number> {
  if (preserve.includes(path)) {
    return 0;
  }

  if (preserve.some((kept) => kept.startsWith(path + sep))) {
    let removed = 0;
    for (const entry of await readdir(path)) {
      removed += await removeExcept(join(path, entry), preserve);
    }
    return removed;
  }

  await rm(path, { recursive: true, force: true });
  return 1;
}

async function clearDirectory(path: string, preserve: readonly string[]): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    removed += await removeExcept(join(path, entry), preserve);
  }
  return removed;
}

export async function purgeManagedPaths(plan: PurgePlan): Promise<number> {
  const { clearDirectories, removePaths, preservePaths } = plan;
  let removed = 0;
  let current = '';

  try {
    for (const directory of clearDirectories) {
      current = directory;
      removed += await clearDirectory(directory, preservePaths);
    }
    for (const path of removePaths) {
      current = path;
      removed += await removeExcept(path, preservePaths);
    }
  } catch (error) {
    if (isPermissionError(error)) {
      throw new Error(
        `Permission denied while deleting ${current}. Check the ownership of the Moody Blues home tree ` +
          `(for example: sudo chown -R "$USER" ${current}) and run the reset again.`,
      );
    }
    throw error;
  }
  return removed;
}

export interface ResetStepDeps {
  runner: Pick<ComposeRunner, 'down'>;
  layout: MbHomeLayout;
  platform?: NodeJS.Platform;
  isMounted?: (path: string) => Promise<boolean>;
}

export function createResetSteps(deps: ResetStepDeps): ProvisionStep[] {
  const { runner, layout, platform = process.platform, isMounted = isMountActive } = deps;

  return [
    {
      id: 'reset-stop',
      title: 'Stop and remove containers',
      scopes: ['reset'],
      run: async (_ctx, signal) => {
        await runner.down({ signal });
        return { status: 'changed' };
      },
    },
    {
      id: 'reset-verify-unmounted',
      title: 'Verify the Real-Debrid mount is released',
      scopes: ['reset'],
      run: async () => {
        if (platform !== 'linux') {
          return { status: 'skipped', detail: 'FUSE mounts exist only on Linux' };
        }
        const mountPath = layout.debridMountDir;
        if (await isMounted(mountPath)) {
          throw new Error(
            `${mountPath} is still mounted. Release it with: sudo umount -l ${mountPath}`,
          );
        }
        return { status: 'unchanged' };
      },
    },
    {
      id: 'reset-purge',
      title: 'Delete managed configuration and data',
      scopes: ['reset'],
      run: async () => {
        const removed = await purgeManagedPaths(buildPurgePlan(layout));
        return { status: 'changed', detail: `${removed} paths removed` };
      },
    },
  ];
}

export interface ResetOptions {
  home?: string;
  cliVersion: string;
  signal: AbortSignal;
  onEvent?: (event: PipelineEvent) => void;
  runtime?: ContainerRuntime;
}

export async function runReset(options: ResetOptions): Promise<PipelineReport> {
  const installation = loadInstallation({ home: options.home });
  const { layout, config, env } = installation;

  const secrets = parseUserSecrets(env);
  if (!secrets.ok) {
    throw new Error(
      `The saved secrets in ${layout.envFile} are incomplete:\n- ${secrets.error.join('\n- ')}\n` +
        'Run "moody-blues setup" to provide them again.',
    );
  }

  const runner = createComposeRunner(installation, { requireHardware: false });
  const runtime = options.runtime ?? createComposeRuntime({ home: layout.root });

  return runPipeline(
    [...createResetSteps({ runner, layout }), ...INFRASTRUCTURE_STEPS],
    {
      config,
      secrets: secrets.value.secrets,
      layout,
      identity: config.host,
      runtime,
      flags: new Map(),
      cliVersion: options.cliVersion,
    },
    { scope: 'reset', signal: options.signal, onEvent: options.onEvent },
  );
}

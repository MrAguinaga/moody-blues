import { spawn } from 'node:child_process';

import { SERVICE_KEY_ENV_KEYS, USER_SECRET_ENV_KEYS } from '@moody-blues/provisioner';

import type { Installation } from '../installation';
import { buildComposeFiles, resolveComposeDir } from './compose.files';
import {
  COMPOSE_PROJECT_NAME,
  type ComposeOutput,
  type ComposeRunner,
  type KillOptions,
  type PullOptions,
  type RunOptions,
} from './compose.types';
import { buildStackStatus, parseComposePs } from './compose-ps.parser';
import {
  createHostProbe,
  detectHardwareAccel,
  type HardwareAccel,
  type HardwareProbe,
} from './hwaccel.utils';

const STDERR_TAIL_CHARS = 2000;
const MIN_SECRET_LENGTH = 4;
const REDACTED = '***';

export class ComposeCommandError extends Error {
  constructor(
    readonly subcommand: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    const exit = exitCode === null ? '' : ` (exit code ${exitCode})`;
    super(`docker compose ${subcommand} failed${exit}${stderr ? `: ${stderr}` : ''}`);
    this.name = 'ComposeCommandError';
  }
}

export interface CreateComposeRunnerOptions {
  composeDir?: string;
  requireHardware?: boolean;
  probe?: HardwareProbe;
}

function secretValues(env: Record<string, string>): string[] {
  return [...USER_SECRET_ENV_KEYS, ...SERVICE_KEY_ENV_KEYS]
    .map((key) => env[key])
    .filter((value): value is string => value !== undefined && value.length >= MIN_SECRET_LENGTH);
}

function sanitizeStderr(stderr: string, secrets: string[]): string {
  const redacted = secrets.reduce((text, secret) => text.split(secret).join(REDACTED), stderr);
  const trimmed = redacted.trim();
  return trimmed.length > STDERR_TAIL_CHARS ? `…${trimmed.slice(-STDERR_TAIL_CHARS)}` : trimmed;
}

function resolveHardware(
  installation: Installation,
  options: CreateComposeRunnerOptions,
): HardwareAccel | undefined {
  if (installation.config.transcoding !== 'hardware') {
    return undefined;
  }

  const hardware = detectHardwareAccel(options.probe ?? createHostProbe());
  if (!hardware && options.requireHardware !== false) {
    throw new Error(
      'Hardware transcoding is configured, but neither /dev/dri/renderD128 nor nvidia-smi was found. ' +
        'Install the GPU drivers or switch transcoding to "cpu".',
    );
  }
  return hardware;
}

export function createComposeRunner(
  installation: Installation,
  options: CreateComposeRunnerOptions = {},
): ComposeRunner {
  const hardware = resolveHardware(installation, options);
  const files = buildComposeFiles(options.composeDir ?? resolveComposeDir(), hardware);

  const baseArgs = [
    'compose',
    '-p',
    COMPOSE_PROJECT_NAME,
    ...files.flatMap((file) => ['-f', file]),
    '--env-file',
    installation.layout.envFile,
  ];
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...installation.env,
    ...(hardware?.kind === 'vaapi' ? { RENDER_GID: String(hardware.renderGid) } : {}),
  };
  const secrets = secretValues(installation.env);

  function invoke(args: string[], { signal }: RunOptions = {}): Promise<ComposeOutput> {
    const subcommand = args.join(' ');

    return new Promise((resolve, reject) => {
      const child = spawn('docker', [...baseArgs, ...args], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
      });
      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (signal?.aborted) {
          reject(signal.reason ?? error);
          return;
        }
        const detail =
          error.code === 'ENOENT' ? 'the docker executable was not found in PATH' : error.message;
        reject(new ComposeCommandError(subcommand, null, detail));
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new ComposeCommandError(subcommand, code, sanitizeStderr(stderr, secrets)));
      });
    });
  }

  let services: Promise<string[]> | undefined;

  const listServices: ComposeRunner['listServices'] = (runOptions) => {
    services ??= invoke(['config', '--services'], runOptions).then(
      ({ stdout }) =>
        stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .sort(),
      (error: unknown) => {
        services = undefined;
        throw error;
      },
    );
    return services;
  };

  return {
    files,
    listServices,
    up: async (runOptions) => {
      await invoke(['up', '-d', '--remove-orphans'], runOptions);
    },
    down: async (runOptions) => {
      await invoke(['--profile', '*', 'down', '--remove-orphans'], runOptions);
    },
    ps: async (runOptions) => {
      const expected = await listServices(runOptions);
      const { stdout } = await invoke(['ps', '--all', '--format', 'json'], runOptions);
      return buildStackStatus(COMPOSE_PROJECT_NAME, parseComposePs(stdout, expected));
    },
    pull: async ({ services: only = [], ...runOptions }: PullOptions = {}) => {
      await invoke(['pull', ...only], runOptions);
    },
    kill: async ({ services: only = [], unixSignal, ...runOptions }: KillOptions = {}) => {
      await invoke(['kill', ...(unixSignal ? ['-s', unixSignal] : []), ...only], runOptions);
    },
    exec: (service, command, runOptions) => invoke(['exec', '-T', service, ...command], runOptions),
    reloadGateway: async (runOptions) => {
      await invoke(
        ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
        runOptions,
      );
    },
  };
}

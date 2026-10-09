import { Command, InvalidArgumentError } from 'commander';

import { type ComposeRunner, createComposeRunner } from '../docker';
import { loadInstallation } from '../installation';
import { abortOnInterrupt, failWith, resolveOutputMode } from '../utils/command.utils';

export const DEFAULT_LOG_TAIL = 100;
export const MAX_LOG_TAIL = 5000;
const SINCE_PATTERN = /^\d+[smhd]$/;

export interface LogsSettings {
  service: string;
  home?: string;
  follow: boolean;
  tail: number;
  since?: string;
  timestamps: boolean;
  json: boolean;
}

export interface LogsStack {
  runner: Pick<ComposeRunner, 'listServices' | 'logs'>;
  storageEnabled: boolean;
}

export interface LogsDeps {
  openStack(home?: string): LogsStack;
  write(text: string): void;
  onOutputError(listener: (error: NodeJS.ErrnoException) => void): void;
}

export function parseTail(value: string): number {
  const text = value.trim();
  const lines = Number(text);
  if (!/^\d+$/.test(text) || lines > MAX_LOG_TAIL) {
    throw new InvalidArgumentError(
      `It must be a whole number of lines between 0 and ${MAX_LOG_TAIL}.`,
    );
  }
  return lines;
}

export function parseSince(value: string): string {
  const text = value.trim();
  if (!SINCE_PATTERN.test(text)) {
    throw new InvalidArgumentError(
      'It must be a number followed by s, m, h or d, such as 30m or 2h.',
    );
  }
  return text;
}

const DEFAULT_DEPS: LogsDeps = {
  openStack: (home) => {
    const installation = loadInstallation({ home });
    return {
      runner: createComposeRunner(installation, { requireHardware: false }),
      storageEnabled: installation.config.storage.enabled,
    };
  },
  write: (text) => {
    process.stdout.write(text);
  },
  onOutputError: (listener) => {
    process.stdout.on('error', listener);
  },
};

function unknownServiceMessage(service: string, available: string[], storageEnabled: boolean) {
  const storageNote =
    service === 'decypharr' && !storageEnabled
      ? ' Decypharr only runs when storage is enabled.'
      : '';
  return `Unknown service "${service}". Available: ${available.join(', ')}.${storageNote}`;
}

export async function executeLogs(
  settings: LogsSettings,
  deps: LogsDeps = DEFAULT_DEPS,
  controller: AbortController = abortOnInterrupt(),
): Promise<void> {
  try {
    const { runner, storageEnabled } = deps.openStack(settings.home);
    const available = await runner.listServices({ signal: controller.signal });
    if (!available.includes(settings.service)) {
      throw new Error(unknownServiceMessage(settings.service, available, storageEnabled));
    }

    deps.onOutputError((error) => {
      if (error.code === 'EPIPE') {
        controller.abort();
        return;
      }
      failWith(error);
      controller.abort();
    });

    await runner.logs(settings.service, {
      follow: settings.follow,
      tail: settings.tail,
      since: settings.since,
      timestamps: settings.timestamps,
      signal: controller.signal,
      onLine: (line) => {
        if (controller.signal.aborted) {
          return;
        }
        deps.write(
          settings.json ? `${JSON.stringify({ service: settings.service, line })}\n` : `${line}\n`,
        );
      },
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      failWith(error);
    }
  }
}

interface LogsCommandOptions {
  home?: string;
  follow?: boolean;
  tail: number;
  since?: string;
  timestamps?: boolean;
}

export function createLogsCommand(): Command {
  const logsCmd = new Command('logs');

  logsCmd
    .description('Print the logs of a service container, masking the stored secrets')
    .argument('<service>', 'Service to read (any service of the stack, such as radarr or caddy)')
    .option('-f, --follow', 'Follow the logs until Ctrl+C')
    .option(
      '-n, --tail <lines>',
      `Number of lines to show (0-${MAX_LOG_TAIL})`,
      parseTail,
      DEFAULT_LOG_TAIL,
    )
    .option('--since <duration>', 'Only logs newer than this, such as 30m, 2h or 1d', parseSince)
    .option('-t, --timestamps', 'Prefix each line with its timestamp')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (service: string, options: LogsCommandOptions) => {
      await executeLogs({
        service,
        home: options.home,
        follow: Boolean(options.follow),
        tail: options.tail,
        since: options.since,
        timestamps: Boolean(options.timestamps),
        json: resolveOutputMode(logsCmd.optsWithGlobals()) === 'json',
      });
    });

  return logsCmd;
}

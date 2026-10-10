import { Command, InvalidArgumentError } from 'commander';

import { createComposeRunner, HealthWaitError, type StackStatus, waitForHealthy } from '../docker';
import { loadInstallation } from '../installation';
import { errorMessage, failWith, type OutputMode, resolveOutputMode } from '../utils/command.utils';
import {
  createTransitionPrinter,
  formatStatusTable,
  mountStackStatusView,
  printJson,
} from './stack-output.utils';

const DEFAULT_TIMEOUT_SECONDS = 600;
const POLL_INTERVAL_MS = 3000;
const INTERRUPTED_EXIT_CODE = 130;
const INTERRUPTED_MESSAGE =
  'Interrupted. The containers keep running; check them with "moody-blues status".';

interface StartPresenter {
  starting(): void;
  waiting(onQuit: () => void): void;
  progress(status: StackStatus): void;
  notice(message: string): void;
  settled(status: StackStatus): void;
  failed(message: string, status?: StackStatus): void;
  interrupted(): void;
  close(): void;
}

function createInteractivePresenter(version: string, onExit: () => void): StartPresenter {
  const view = mountStackStatusView({
    version,
    heading: 'Starting Moody Blues',
    busy: 'Starting containers (pulling missing images can take several minutes)...',
  });
  let closed = false;
  void view.exited.then(() => {
    closed = true;
    onExit();
  });

  const update = (patch: Parameters<typeof view.update>[0]) => {
    if (!closed) {
      view.update(patch);
    }
  };
  const finish = (patch: Parameters<typeof view.update>[0]) => {
    update({ busy: undefined, onQuit: undefined, ...patch });
  };

  return {
    starting: () => undefined,
    waiting: (onQuit) => update({ busy: 'Waiting for healthchecks...', onQuit }),
    progress: (status) => update({ status }),
    notice: (message) => update({ busy: message }),
    settled: (status) => finish({ status }),
    failed: (message, status) => finish({ failure: message, status }),
    interrupted: () => finish({ failure: INTERRUPTED_MESSAGE }),
    close: () => {
      if (!closed) {
        closed = true;
        view.unmount();
      }
    },
  };
}

function createHeadlessPresenter(timeoutSeconds: number): StartPresenter {
  const printTransition = createTransitionPrinter();

  return {
    starting: () => console.log('Starting containers...'),
    waiting: () => console.log(`Waiting for healthchecks (timeout ${timeoutSeconds}s)...`),
    progress: printTransition,
    notice: (message) => console.log(message),
    settled: (status) => formatStatusTable(status).forEach((line) => console.log(line)),
    failed: (message, status) => {
      if (status) {
        formatStatusTable(status).forEach((line) => console.log(line));
      }
      console.error(`✖ ${message}`);
    },
    interrupted: () => console.error(INTERRUPTED_MESSAGE),
    close: () => undefined,
  };
}

function createJsonPresenter(): StartPresenter {
  return {
    starting: () => undefined,
    waiting: () => undefined,
    progress: () => undefined,
    notice: (message) => console.error(message),
    settled: (status) => printJson(status),
    failed: (message, status) => {
      if (status) {
        printJson(status);
      }
      console.error(`✖ ${message}`);
    },
    interrupted: () => console.error(INTERRUPTED_MESSAGE),
    close: () => undefined,
  };
}

function createPresenter(
  mode: OutputMode,
  version: string,
  timeoutSeconds: number,
  onExit: () => void,
): StartPresenter {
  switch (mode) {
    case 'interactive':
      return createInteractivePresenter(version, onExit);
    case 'json':
      return createJsonPresenter();
    case 'headless':
      return createHeadlessPresenter(timeoutSeconds);
  }
}

export interface StartSettings {
  home?: string;
  timeoutSeconds: number;
  wait: boolean;
  mode: OutputMode;
  version: string;
}

export async function executeStart(settings: StartSettings): Promise<void> {
  const { home, timeoutSeconds, wait, mode, version } = settings;
  const controller = new AbortController();
  const { signal } = controller;
  let presenter: StartPresenter | undefined;

  try {
    const installation = loadInstallation({ home });
    const runner = createComposeRunner(installation);

    presenter = createPresenter(mode, version, timeoutSeconds, () => controller.abort());
    presenter.starting();
    await runner.up({ signal });

    if (!wait) {
      presenter.settled(await runner.ps({ signal }));
      return;
    }

    presenter.waiting(() => controller.abort());
    const status = await waitForHealthy(runner, {
      timeoutMs: timeoutSeconds * 1000,
      intervalMs: POLL_INTERVAL_MS,
      signal,
      onUpdate: presenter.progress,
      onNotice: presenter.notice,
    });
    presenter.settled(status);
  } catch (error) {
    if (!presenter) {
      failWith(error);
      return;
    }
    if (signal.aborted) {
      presenter.interrupted();
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }
    const status = error instanceof HealthWaitError ? error.status : undefined;
    presenter.failed(errorMessage(error), status);
    process.exitCode = 1;
  } finally {
    presenter?.close();
  }
}

function parseTimeoutSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new InvalidArgumentError('Must be a positive integer number of seconds.');
  }
  return seconds;
}

export function createStartCommand(version: string): Command {
  const startCmd = new Command('start');

  startCmd
    .description('Start the container stack and wait until every service is healthy')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .option(
      '--timeout <seconds>',
      'Maximum time to wait for healthchecks',
      parseTimeoutSeconds,
      DEFAULT_TIMEOUT_SECONDS,
    )
    .option('--no-wait', 'Return as soon as the containers are started')
    .action(async (options: { home?: string; timeout: number; wait: boolean }) => {
      await executeStart({
        home: options.home,
        timeoutSeconds: options.timeout,
        wait: options.wait,
        mode: resolveOutputMode(startCmd.optsWithGlobals()),
        version,
      });
    });

  return startCmd;
}

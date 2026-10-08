import { Command } from 'commander';

import { type ComposeRunner, createComposeRunner } from '../docker';
import { loadInstallation } from '../installation';
import { delay } from '../utils/async.utils';
import { errorMessage, failWith, type OutputMode, resolveOutputMode } from '../utils/command.utils';
import { formatStatusTable, mountStackStatusView, printJson } from './stack-output.utils';

const REFRESH_INTERVAL_MS = 2000;

async function runLiveStatus(runner: ComposeRunner, version: string): Promise<void> {
  const controller = new AbortController();
  const { signal } = controller;
  const view = mountStackStatusView({
    version,
    heading: 'Stack status (refreshing every 2s)',
    busy: 'Querying Docker...',
    onQuit: () => controller.abort(),
  });
  void view.exited.then(() => controller.abort());

  while (!signal.aborted) {
    try {
      view.update({ status: await runner.ps({ signal }), busy: undefined, failure: undefined });
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      view.update({ busy: undefined, failure: errorMessage(error) });
    }
    await delay(REFRESH_INTERVAL_MS, signal);
  }

  view.unmount();
}

export interface StatusSettings {
  home?: string;
  mode: OutputMode;
  version: string;
}

export async function executeStatus(settings: StatusSettings): Promise<void> {
  const { home, mode, version } = settings;

  try {
    const installation = loadInstallation({ home });
    const runner = createComposeRunner(installation, { requireHardware: false });

    if (mode === 'interactive') {
      await runLiveStatus(runner, version);
      return;
    }

    const status = await runner.ps();
    if (mode === 'json') {
      printJson(status);
    } else {
      formatStatusTable(status).forEach((line) => console.log(line));
    }
  } catch (error) {
    failWith(error);
  }
}

export function createStatusCommand(version: string): Command {
  const statusCmd = new Command('status');

  statusCmd
    .description('Show the current state of every service')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (options: { home?: string }) => {
      await executeStatus({
        home: options.home,
        mode: resolveOutputMode(statusCmd.optsWithGlobals()),
        version,
      });
    });

  return statusCmd;
}

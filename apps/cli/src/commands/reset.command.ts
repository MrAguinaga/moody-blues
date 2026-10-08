import { Command } from 'commander';
import { createElement } from 'react';

import { loadInstallation } from '../installation';
import { runReset } from '../reset';
import { ConfirmView } from '../ui/views/ConfirmView';
import { PipelineView, type PipelineViewProps } from '../ui/views/PipelineView';
import {
  abortOnInterrupt,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import { applyPipelineEvent, formatPipelineEvent } from './pipeline-output.utils';
import { printJson } from './stack-output.utils';
import { createViewMount } from './view-mount.utils';

const INTERRUPTED_EXIT_CODE = 130;
const SUCCESS_MESSAGE = 'Reset complete: the stack was rebuilt from your saved settings.';
const INTERRUPTED_MESSAGE =
  'Interrupted. The stack may be partially reset; run "moody-blues reset --fresh" again.';

const DELETED_PATHS = [
  'config/* (service configuration and databases)',
  'cache/ and data/ (downloads and media links)',
  'mnt/debrid contents',
];
const PRESERVED_PATHS = [
  'app/, .env and moody-blues.json (settings, secrets and API keys)',
  'config/caddy/data (HTTPS certificates)',
];

export interface ResetSettings {
  home?: string;
  yes: boolean;
  mode: OutputMode;
  version: string;
}

function confirmInteractively(settings: ResetSettings): Promise<boolean> {
  return new Promise((settle) => {
    const view = createViewMount(() => settle(false));
    const answer = (confirmed: boolean) => {
      view.unmount();
      settle(confirmed);
    };
    view.show(
      createElement(ConfirmView, {
        version: settings.version,
        heading: 'Fresh reset',
        details: DELETED_PATHS.map((path) => `Deletes ${path}`),
        preserved: PRESERVED_PATHS.map((path) => `Keeps ${path}`),
        confirmLabel: 'Delete the managed data and reprovision the stack?',
        onConfirm: () => answer(true),
        onCancel: () => answer(false),
      }),
    );
  });
}

async function runInteractive(settings: ResetSettings): Promise<void> {
  if (!settings.yes && !(await confirmInteractively(settings))) {
    console.error('Reset cancelled.');
    process.exitCode = INTERRUPTED_EXIT_CODE;
    return;
  }

  const controller = new AbortController();
  const view = createViewMount(() => controller.abort());
  let progress: PipelineViewProps = {
    version: settings.version,
    heading: 'Resetting Moody Blues',
    steps: [],
    busy: 'Preparing the reset...',
  };
  const show = (patch: Partial<PipelineViewProps>) => {
    progress = { ...progress, ...patch };
    view.show(createElement(PipelineView, progress));
  };
  show({});

  try {
    const report = await runReset({
      home: settings.home,
      cliVersion: settings.version,
      signal: controller.signal,
      onEvent: (event) =>
        show({ steps: applyPipelineEvent(progress.steps, event), busy: undefined }),
    });
    show(
      report.success
        ? { busy: undefined, success: SUCCESS_MESSAGE }
        : { busy: undefined, failure: report.aborted ? INTERRUPTED_MESSAGE : report.error },
    );
    process.exitCode = report.success ? 0 : report.aborted ? INTERRUPTED_EXIT_CODE : 1;
  } catch (error) {
    show({ busy: undefined, failure: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    view.unmount();
  }
}

async function runNonInteractive(settings: ResetSettings): Promise<void> {
  const json = settings.mode === 'json';
  const controller = abortOnInterrupt();

  if (!json) {
    console.log(`Moody Blues CLI v${settings.version} — Fresh reset (Headless)`);
  }
  const report = await runReset({
    home: settings.home,
    cliVersion: settings.version,
    signal: controller.signal,
    onEvent: json
      ? undefined
      : (event) => formatPipelineEvent(event).forEach((line) => console.log(line)),
  });

  if (json) {
    printJson(report);
  } else if (report.success) {
    console.log(`✔ ${SUCCESS_MESSAGE}`);
  } else {
    console.error(`✖ ${report.aborted ? INTERRUPTED_MESSAGE : report.error}`);
  }
  process.exitCode = report.success ? 0 : report.aborted ? INTERRUPTED_EXIT_CODE : 1;
}

export async function executeReset(settings: ResetSettings): Promise<void> {
  try {
    loadInstallation({ home: settings.home });

    if (settings.mode !== 'interactive' && !settings.yes) {
      throw new Error(
        'Refusing to delete data without confirmation: pass --yes to run the reset non-interactively.',
      );
    }

    if (settings.mode === 'interactive') {
      await runInteractive(settings);
    } else {
      await runNonInteractive(settings);
    }
  } catch (error) {
    failWith(error);
  }
}

export function createResetCommand(version: string): Command {
  const resetCmd = new Command('reset');

  resetCmd
    .description('Delete the managed configuration and data and reprovision the stack')
    .requiredOption('--fresh', 'Purge the service state and rebuild from the saved settings')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (options: { home?: string }) => {
      const globals = resetCmd.optsWithGlobals();
      await executeReset({
        home: options.home,
        yes: Boolean(globals.yes),
        mode: resolveOutputMode(globals),
        version,
      });
    });

  return resetCmd;
}

import { Command, Option } from 'commander';
import { createElement } from 'react';

import { ConfirmView } from '../ui/views/ConfirmView';
import {
  applyUpdate,
  type ApplyUpdateResult,
  inspectUpdate,
  REDEPLOY_HINT,
  type RedeployDeps,
  runRedeploy,
  type UpdateCheck,
  type UpdateDeps,
  type UpdateInspection,
} from '../update';
import {
  abortOnInterrupt,
  errorMessage,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import { formatPipelineEvent } from './pipeline-output.utils';
import { printJson } from './stack-output.utils';
import {
  formatCheck,
  formatUpdateStart,
  formatUpdateStep,
  toApplyJson,
  toCheckJson,
} from './update-output.utils';
import { createViewMount } from './view-mount.utils';

const INTERRUPTED_EXIT_CODE = 130;
const REDEPLOY_FAILED_EXIT_CODE = 2;
const INTERRUPTED_HINT =
  'Interrupted. The code directory may be in an intermediate state; repeat "moody-blues update".';

export interface UpdateSettings {
  check: boolean;
  refresh: boolean;
  redeploy: boolean;
  home?: string;
  yes: boolean;
  mode: OutputMode;
  version: string;
  deps?: Partial<UpdateDeps>;
  redeployDeps?: Partial<RedeployDeps>;
}

function printHeader(settings: UpdateSettings, label: string): void {
  if (settings.mode !== 'json') {
    console.log(`Moody Blues CLI v${settings.version} — ${label}`);
  }
}

function exitCodeFor(result: ApplyUpdateResult): number {
  if (result.success) {
    return 0;
  }
  return result.codeUpdated ? REDEPLOY_FAILED_EXIT_CODE : 1;
}

function failureMessage(check: UpdateCheck, result: ApplyUpdateResult): string {
  const target = check.latest?.tag ?? 'the new version';
  if (result.codeUpdated) {
    return `The code is now ${target}, but redeploying the stack failed. ${REDEPLOY_HINT}`;
  }
  const failed = result.steps.find((step) => step.status === 'failed' && step.id !== 'rollback');
  const rollback = result.steps.find((step) => step.id === 'rollback');
  const restored = rollback?.status === 'ok' ? ' The previous version was restored.' : '';
  const stuck =
    rollback?.status === 'failed'
      ? ' The previous version could not be restored automatically.'
      : '';
  return `The update to ${target} failed at "${failed?.title ?? 'an unknown step'}".${restored}${stuck}`;
}

function confirmInteractively(
  settings: UpdateSettings,
  check: UpdateCheck,
  signal: AbortSignal,
  view: ReturnType<typeof createViewMount>,
): Promise<boolean> {
  return new Promise((settle) => {
    signal.addEventListener('abort', () => settle(false), { once: true });
    view.show(
      createElement(ConfirmView, {
        version: settings.version,
        heading: `Update v${check.current} -> ${check.latest?.tag ?? ''}`,
        details: [],
        confirmLabel: 'Update now? The stack is restarted briefly.',
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      }),
    );
  });
}

async function applyConfirmed(
  settings: UpdateSettings,
  inspection: UpdateInspection,
  signal: AbortSignal,
): Promise<void> {
  const { check, installed } = inspection;
  const json = settings.mode === 'json';
  const release = check.latest;
  if (!release) {
    return;
  }

  const result = await applyUpdate({
    release,
    installed,
    home: settings.home,
    json,
    signal,
    deps: settings.deps,
    onStart: json ? undefined : (title) => console.log(formatUpdateStart(title)),
    onStep: json
      ? undefined
      : (step) => formatUpdateStep(step).forEach((line) => console.log(line)),
    onLine: (line) => console.log(`      ${line}`),
  });

  if (json) {
    printJson(toApplyJson(check, result));
  } else if (!result.success) {
    console.error(`✖ ${failureMessage(check, result)}`);
  } else if (result.redeployed) {
    console.log(
      `✔ Moody Blues was updated to ${release.tag} and the stack was redeployed. Check it with "moody-blues status".`,
    );
  } else {
    console.log(
      `✔ The code was updated to ${release.tag}. Run "moody-blues setup --env-file <path>" to provision it.`,
    );
  }
  process.exitCode = exitCodeFor(result);
}

async function runApply(
  settings: UpdateSettings,
  inspection: UpdateInspection,
  controller: AbortController,
): Promise<void> {
  const { check } = inspection;
  const json = settings.mode === 'json';

  if (!check.updateAvailable) {
    if (json) {
      printJson(toApplyJson(check));
    } else {
      formatCheck(check).forEach((line) => console.log(line));
    }
    return;
  }

  if (!json) {
    formatCheck(check).forEach((line) => console.log(line));
  }

  if (!settings.yes) {
    if (settings.mode !== 'interactive') {
      const message = 'Nothing was changed. Pass --yes to update non-interactively.';
      if (json) {
        printJson(toApplyJson(check, undefined, message));
      } else {
        console.error(`✖ ${message}`);
      }
      process.exitCode = 1;
      return;
    }

    const view = createViewMount(() => controller.abort());
    const approved = await confirmInteractively(settings, check, controller.signal, view);
    view.unmount();
    if (!approved) {
      console.error('Update cancelled.');
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }
  }

  await applyConfirmed(settings, inspection, controller.signal);
}

async function runUpdate(settings: UpdateSettings): Promise<void> {
  const controller = abortOnInterrupt();
  const json = settings.mode === 'json';
  printHeader(settings, settings.check ? 'Update (check)' : 'Update');

  const inspection = await inspectUpdate({
    home: settings.home,
    currentVersion: settings.version,
    useCache: settings.check && !settings.refresh,
    signal: controller.signal,
    deps: settings.deps,
  });

  if (settings.check) {
    if (json) {
      printJson(toCheckJson(inspection.check));
    } else {
      formatCheck(inspection.check).forEach((line) => console.log(line));
    }
    return;
  }

  await runApply(settings, inspection, controller);
}

async function runRedeployMode(settings: UpdateSettings): Promise<void> {
  const controller = abortOnInterrupt();
  const json = settings.mode === 'json';
  printHeader(settings, 'Update (Redeploy)');

  const report = await runRedeploy({
    home: settings.home,
    cliVersion: settings.version,
    signal: controller.signal,
    deps: settings.redeployDeps,
    onStage: json ? undefined : (message) => console.log(message),
    onEvent: json
      ? undefined
      : (event) => formatPipelineEvent(event).forEach((line) => console.log(line)),
  });

  if (json) {
    printJson(report);
  } else if (report.success) {
    console.log('✔ The stack is redeployed and provisioned. Check it with "moody-blues status".');
  } else {
    console.error(
      `✖ ${report.aborted ? 'Interrupted.' : (report.error ?? 'The redeploy failed.')}`,
    );
  }
  if (!report.success) {
    process.exitCode = report.aborted ? INTERRUPTED_EXIT_CODE : 1;
  }
}

export async function executeUpdate(settings: UpdateSettings): Promise<void> {
  try {
    if (settings.redeploy) {
      await runRedeployMode(settings);
    } else {
      await runUpdate(settings);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`✖ ${INTERRUPTED_HINT}`);
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }
    if (settings.mode === 'json') {
      printJson({ success: false, error: errorMessage(error) });
      process.exitCode = 1;
      return;
    }
    failWith(error);
  }
}

interface UpdateCommandOptions {
  check?: boolean;
  refresh?: boolean;
  redeploy?: boolean;
  home?: string;
}

export function createUpdateCommand(version: string): Command {
  const updateCmd = new Command('update');

  updateCmd
    .description('Look for a new release on GitHub and update the code and the stack')
    .addOption(
      new Option('--check', 'Only look for a new release, without changing anything').conflicts(
        'redeploy',
      ),
    )
    .option('--refresh', 'Ignore the one-hour cache of the release check')
    .addOption(
      new Option(
        '--redeploy',
        'Pull the images and reapply the provisioning with the installed code',
      ).conflicts('check'),
    )
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (options: UpdateCommandOptions) => {
      const globals = updateCmd.optsWithGlobals();
      await executeUpdate({
        check: Boolean(options.check),
        refresh: Boolean(options.refresh),
        redeploy: Boolean(options.redeploy),
        home: options.home,
        yes: Boolean(globals.yes),
        mode: resolveOutputMode(globals),
        version,
      });
    });

  return updateCmd;
}

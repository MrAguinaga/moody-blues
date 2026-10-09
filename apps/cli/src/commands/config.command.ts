import { Command } from 'commander';
import { createElement } from 'react';

import {
  type ConfigDeps,
  type ConfigKey,
  type ConfigOutcome,
  type ConfigPlanView,
  type ConfigRunReport,
  parseConfigKey,
  parseSettingValue,
  readSettings,
  runConfigChange,
} from '../config';
import { loadInstallation } from '../installation';
import { ConfirmView } from '../ui/views/ConfirmView';
import { PipelineView, type PipelineViewProps } from '../ui/views/PipelineView';
import {
  abortOnInterrupt,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import {
  formatPlanLines,
  formatSettingsLines,
  toConfigRefusedJson,
  toConfigRunJson,
  toSettingsJson,
} from './config-output.utils';
import { applyPipelineEvent, formatPipelineEvent } from './pipeline-output.utils';
import { printJson } from './stack-output.utils';
import { createViewMount } from './view-mount.utils';

const INTERRUPTED_EXIT_CODE = 130;

export interface ConfigSettings {
  key?: string;
  value?: string;
  home?: string;
  yes: boolean;
  mode: OutputMode;
  version: string;
  deps?: Partial<ConfigDeps>;
}

interface ConfigChangeRequest extends ConfigSettings {
  key: ConfigKey;
  value: string;
}

function successMessage({ key, value }: ConfigRunReport): string {
  return `${key} is now "${value}".`;
}

function recoveryHint({ key, previous }: ConfigRunReport): string {
  return `Repeat the same command to repair it (the steps are idempotent), or set ${key} back to "${previous}".`;
}

function failureMessage(report: ConfigRunReport): string {
  if (report.pipeline.aborted) {
    return `Interrupted. ${recoveryHint(report)}`;
  }
  return `${report.pipeline.error ?? 'The change failed.'} ${recoveryHint(report)}`;
}

function exitCodeFor(report: ConfigRunReport): number {
  if (report.success) {
    return 0;
  }
  return report.pipeline.aborted ? INTERRUPTED_EXIT_CODE : 1;
}

function unconfirmedMessage(plan: ConfigPlanView): string {
  return `${plan.disruption ?? 'This change is disruptive.'} Pass --yes to apply it non-interactively.`;
}

function printQuery(settings: ConfigSettings): void {
  const installation = loadInstallation({ home: settings.home });
  const all = readSettings(installation.config);
  const selected = settings.key ? all.filter(({ key }) => key === settings.key) : all;

  if (settings.mode === 'json') {
    printJson(toSettingsJson(selected));
    return;
  }
  console.log(`Moody Blues CLI v${settings.version} — Configuration`);
  formatSettingsLines(selected).forEach((line) => console.log(line));
}

async function runNonInteractive(request: ConfigChangeRequest): Promise<void> {
  const json = request.mode === 'json';
  const controller = abortOnInterrupt();

  if (!json) {
    console.log(`Moody Blues CLI v${request.version} — Config (Headless)`);
  }
  const outcome = await runConfigChange({
    home: request.home,
    key: request.key,
    value: request.value,
    cliVersion: request.version,
    signal: controller.signal,
    deps: request.deps,
    confirm: async () => (request.yes ? 'approved' : 'unavailable'),
    onPlan: json ? undefined : (plan) => formatPlanLines(plan).forEach((line) => console.log(line)),
    onEvent: json
      ? undefined
      : (event) => formatPipelineEvent(event).forEach((line) => console.log(line)),
  });

  reportOutcome(outcome, json);
}

function reportOutcome(outcome: ConfigOutcome, json: boolean): void {
  if (outcome.kind === 'applied') {
    const { report } = outcome;
    if (json) {
      printJson(toConfigRunJson(report));
    } else if (report.success) {
      console.log(`✔ ${successMessage(report)}`);
    } else {
      console.error(`✖ ${failureMessage(report)}`);
    }
    process.exitCode = exitCodeFor(report);
    return;
  }

  const message = unconfirmedMessage(outcome.plan);
  if (json) {
    printJson(toConfigRefusedJson(outcome.plan, message));
  } else {
    console.error(`✖ ${message}`);
  }
  process.exitCode = 1;
}

async function runInteractive(request: ConfigChangeRequest): Promise<void> {
  const controller = new AbortController();
  const view = createViewMount(() => controller.abort());
  let progress: PipelineViewProps = {
    version: request.version,
    heading: `Changing ${request.key}`,
    steps: [],
    busy: 'Checking the installation...',
  };
  const show = (patch: Partial<PipelineViewProps>) => {
    progress = { ...progress, ...patch };
    view.show(createElement(PipelineView, progress));
  };
  const confirm = (plan: ConfigPlanView): Promise<'approved' | 'declined'> =>
    new Promise((settle) => {
      if (request.yes) {
        settle('approved');
        return;
      }
      const answer = (decision: 'approved' | 'declined') => {
        if (decision === 'approved') {
          show({ busy: 'Applying the change...' });
        }
        settle(decision);
      };
      controller.signal.addEventListener('abort', () => settle('declined'), { once: true });
      view.show(
        createElement(ConfirmView, {
          version: request.version,
          heading: `Change ${plan.key}: ${plan.previous} -> ${plan.value}`,
          details: [plan.disruption ?? 'This change is disruptive.'],
          confirmLabel: 'Apply the change?',
          onConfirm: () => answer('approved'),
          onCancel: () => answer('declined'),
        }),
      );
    });

  try {
    show({});
    const outcome = await runConfigChange({
      home: request.home,
      key: request.key,
      value: request.value,
      cliVersion: request.version,
      signal: controller.signal,
      deps: request.deps,
      confirm,
      onPlan: (plan) =>
        show({
          heading: `Changing ${plan.key}: ${plan.previous} -> ${plan.value}`,
          warnings: plan.notes,
        }),
      onEvent: (event) =>
        show({ steps: applyPipelineEvent(progress.steps, event), busy: undefined }),
    });

    if (outcome.kind !== 'applied') {
      view.unmount();
      console.error('Config change cancelled.');
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }
    const { report } = outcome;
    show(
      report.success
        ? { busy: undefined, success: successMessage(report) }
        : { busy: undefined, failure: failureMessage(report) },
    );
    process.exitCode = exitCodeFor(report);
  } finally {
    view.unmount();
  }
}

export async function executeConfig(settings: ConfigSettings): Promise<void> {
  try {
    const key = settings.key === undefined ? undefined : parseConfigKey(settings.key);

    if (key === undefined || settings.value === undefined) {
      printQuery({ ...settings, key });
      return;
    }
    const value = parseSettingValue(key, settings.value);
    const request: ConfigChangeRequest = { ...settings, key, value };

    if (settings.mode === 'interactive') {
      await runInteractive(request);
    } else {
      await runNonInteractive(request);
    }
  } catch (error) {
    failWith(error);
  }
}

interface ConfigCommandOptions {
  home?: string;
}

export function createConfigCommand(version: string): Command {
  const configCmd = new Command('config');

  configCmd
    .description('Show the operational settings or change one and reapply only the affected steps')
    .argument('[key]', 'Setting to show or change (transcoding or quality-cap)')
    .argument('[value]', 'New value for the setting')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(
      async (key: string | undefined, value: string | undefined, options: ConfigCommandOptions) => {
        const globals = configCmd.optsWithGlobals();
        await executeConfig({
          key,
          value,
          home: options.home,
          yes: Boolean(globals.yes),
          mode: resolveOutputMode(globals),
          version,
        });
      },
    );

  return configCmd;
}

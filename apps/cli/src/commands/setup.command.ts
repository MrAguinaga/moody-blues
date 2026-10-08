import { Command } from 'commander';
import { createElement } from 'react';

import { fuseCheck } from '../checks';
import { createComposeRuntime } from '../docker';
import {
  loadSetupSources,
  resolveSetupInput,
  runSetup,
  type SetupInput,
  type SetupIssue,
  type SetupReport,
  type SetupResolution,
  type SetupSources,
  type SetupValues,
} from '../setup';
import { PipelineView, type PipelineViewProps } from '../ui/views/PipelineView';
import { SetupWizardView } from '../ui/views/SetupWizardView';
import {
  abortOnInterrupt,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import { formatCheckLines } from './check-output.utils';
import { applyPipelineEvent, formatPipelineEvent } from './pipeline-output.utils';
import { printJson } from './stack-output.utils';
import { createViewMount } from './view-mount.utils';

const INTERRUPTED_EXIT_CODE = 130;
const PREFLIGHT_FAILURE =
  'Pre-flight checks failed. Resolve the errors above and run the setup again.';
const SUCCESS_MESSAGE =
  'Moody Blues is provisioned and healthy. Check it with "moody-blues status".';
const INTERRUPTED_MESSAGE =
  'Interrupted. The containers keep running; check them with "moody-blues status".';

export interface SetupSettings {
  flags: SetupValues;
  envFile?: string;
  home?: string;
  yes: boolean;
  mode: OutputMode;
  version: string;
}

interface SetupSession {
  home: string;
  sources: SetupSources;
  resolve: (answers?: SetupValues) => Promise<SetupResolution>;
}

type WizardOutcome =
  | { kind: 'confirmed'; input: SetupInput }
  | { kind: 'cancelled' }
  | { kind: 'failed'; issues: SetupIssue[] };

function createSession(settings: SetupSettings): SetupSession {
  const { layout, sources } = loadSetupSources({
    flags: settings.flags,
    envFile: settings.envFile,
    home: settings.home,
  });
  const deps = {
    detectStorage: async () => (await fuseCheck.run({ home: layout.root })).status === 'success',
  };

  return {
    home: layout.root,
    sources,
    resolve: (answers) => resolveSetupInput({ ...sources, answers }, deps),
  };
}

function printIssues(issues: SetupIssue[]): void {
  console.error('✖ The setup input is incomplete or invalid:');
  issues.forEach((issue) => console.error(`  - ${issue.message}`));
}

function failureMessage(report: SetupReport): string {
  if (report.pipeline?.aborted) {
    return INTERRUPTED_MESSAGE;
  }
  return report.pipeline?.error ?? PREFLIGHT_FAILURE;
}

function applyExitCode(report: SetupReport): void {
  if (!report.success) {
    process.exitCode = report.pipeline?.aborted ? INTERRUPTED_EXIT_CODE : 1;
  }
}

async function runNonInteractive(session: SetupSession, settings: SetupSettings): Promise<void> {
  const json = settings.mode === 'json';
  const resolution = await session.resolve();

  if (!resolution.complete) {
    if (json) {
      printJson({ success: false, issues: resolution.issues });
    } else {
      printIssues(resolution.issues);
    }
    process.exitCode = 1;
    return;
  }

  if (!json && resolution.ignoredKeys.length > 0) {
    console.warn(
      `⚠ Ignoring unsupported keys in the env file: ${resolution.ignoredKeys.join(', ')}`,
    );
  }
  if (!json) {
    console.log(`Moody Blues CLI v${settings.version} — Setup (Headless)`);
    console.log('Pre-flight checks:');
  }

  const controller = abortOnInterrupt();
  const report = await runSetup({
    input: resolution.input,
    home: session.home,
    cliVersion: settings.version,
    runtime: createComposeRuntime({ home: session.home }),
    signal: controller.signal,
    onCheckUpdate: json
      ? undefined
      : (_report, check) => formatCheckLines(check).forEach((line) => console.log(line)),
    onPipelineEvent: json
      ? undefined
      : (event) => {
          if (event.type === 'pipeline-start') {
            console.log('Provisioning:');
          }
          formatPipelineEvent(event).forEach((line) => console.log(line));
        },
  });

  if (json) {
    printJson(report);
  } else if (report.success) {
    console.log(`✔ ${SUCCESS_MESSAGE}`);
  } else {
    console.error(`✖ ${failureMessage(report)}`);
  }
  applyExitCode(report);
}

async function runInteractive(session: SetupSession, settings: SetupSettings): Promise<void> {
  const initial = await session.resolve();
  if (!initial.complete && initial.issues.some((issue) => issue.problem === 'invalid')) {
    printIssues(initial.issues);
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  let cancelWizard: (() => void) | undefined;
  const view = createViewMount(() => {
    controller.abort();
    cancelWizard?.();
  });

  let outcome: WizardOutcome;
  if (initial.complete && settings.yes) {
    outcome = { kind: 'confirmed', input: initial.input };
  } else {
    outcome = await new Promise<WizardOutcome>((settle) => {
      cancelWizard = () => settle({ kind: 'cancelled' });
      view.show(
        createElement(SetupWizardView, {
          version: settings.version,
          draft: initial.complete ? undefined : initial.draft,
          autoConfirm: settings.yes,
          resolve: session.resolve,
          onConfirm: (input) => settle({ kind: 'confirmed', input }),
          onCancel: () => settle({ kind: 'cancelled' }),
          onFailed: (issues) => settle({ kind: 'failed', issues }),
        }),
      );
    });
  }

  if (outcome.kind !== 'confirmed') {
    view.unmount();
    if (outcome.kind === 'failed') {
      printIssues(outcome.issues);
      process.exitCode = 1;
    } else {
      console.error('Setup cancelled.');
      process.exitCode = INTERRUPTED_EXIT_CODE;
    }
    return;
  }

  let progress: PipelineViewProps = {
    version: settings.version,
    heading: 'Provisioning Moody Blues',
    checks: [],
    steps: [],
    busy: 'Running pre-flight checks...',
  };
  const show = (patch: Partial<PipelineViewProps>) => {
    progress = { ...progress, ...patch };
    view.show(createElement(PipelineView, progress));
  };
  show({});

  const report = await runSetup({
    input: outcome.input,
    home: session.home,
    cliVersion: settings.version,
    runtime: createComposeRuntime({ home: session.home }),
    signal: controller.signal,
    onCheckUpdate: (checksReport) => show({ checks: [...checksReport.checks] }),
    onPipelineEvent: (event) =>
      show({ steps: applyPipelineEvent(progress.steps, event), busy: undefined }),
  });

  show({
    busy: undefined,
    ...(report.success ? { success: SUCCESS_MESSAGE } : { failure: failureMessage(report) }),
  });
  view.unmount();
  applyExitCode(report);
}

export async function executeSetup(settings: SetupSettings): Promise<void> {
  try {
    const session = createSession(settings);
    if (settings.mode === 'interactive') {
      await runInteractive(session, settings);
    } else {
      await runNonInteractive(session, settings);
    }
  } catch (error) {
    failWith(error);
  }
}

interface SetupCommandOptions {
  envFile?: string;
  home?: string;
  mode?: string;
  domain?: string;
  acmeEmail?: string;
  acmeStaging?: boolean;
  transcoding?: string;
}

export function createSetupCommand(version: string): Command {
  const setupCmd = new Command('setup');

  setupCmd
    .description('Collect the configuration, validate the host and provision the stack')
    .option('--env-file <path>', 'Read secrets and settings from an env file (unattended)')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .option('--mode <mode>', 'Deployment mode: local or remote')
    .option('--domain <domain>', 'Public domain (remote mode)')
    .option('--acme-email <email>', 'Email for HTTPS certificate notices (remote mode)')
    .option('--acme-staging', "Use the Let's Encrypt staging CA while testing")
    .option('--transcoding <mode>', 'Video transcoding: off, cpu or hardware')
    .action(async (options: SetupCommandOptions) => {
      const globals = setupCmd.optsWithGlobals();
      const requestedMode = resolveOutputMode(globals);

      await executeSetup({
        flags: {
          mode: options.mode,
          domain: options.domain,
          acmeEmail: options.acmeEmail,
          acmeStaging: options.acmeStaging,
          transcoding: options.transcoding,
        },
        envFile: options.envFile,
        home: options.home,
        yes: Boolean(globals.yes),
        mode: options.envFile && requestedMode === 'interactive' ? 'headless' : requestedMode,
        version,
      });
    });

  return setupCmd;
}

import { Command, InvalidArgumentError } from 'commander';
import { createElement } from 'react';

import {
  buildDoctorChecks,
  createDoctorContext,
  DEFAULT_STUCK_AFTER_MINUTES,
  describeFixPlan,
  type DoctorContext,
  type DoctorReport,
  type DoctorResult,
  FIX_ACTION,
  type FixDecision,
  type FixPlan,
  MAX_STUCK_AFTER_MINUTES,
  MIN_STUCK_AFTER_MINUTES,
  runDoctor,
} from '../doctor';
import { ConfirmView } from '../ui/views/ConfirmView';
import { DoctorView, type DoctorViewProps } from '../ui/views/DoctorView';
import {
  abortOnInterrupt,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import {
  formatDoctorLines,
  formatDoctorSummary,
  formatFixLines,
  toDoctorJson,
} from './doctor-output.utils';
import { printJson } from './stack-output.utils';
import { createViewMount } from './view-mount.utils';

const INTERRUPTED_EXIT_CODE = 130;
const MINUTE_MS = 60_000;
const SEPARATOR = '-'.repeat(60);
const NOTHING_TO_FIX = 'No stuck downloads to remove.';

export interface DoctorSettings {
  home?: string;
  fix: boolean;
  stuckAfterMinutes: number;
  realDebrid: boolean;
  yes: boolean;
  mode: OutputMode;
  version: string;
}

export function parseStuckAfter(value: string): number {
  const minutes = Number(value.trim());
  if (
    !/^\d+$/.test(value.trim()) ||
    minutes < MIN_STUCK_AFTER_MINUTES ||
    minutes > MAX_STUCK_AFTER_MINUTES
  ) {
    throw new InvalidArgumentError(
      `It must be a whole number of minutes between ${MIN_STUCK_AFTER_MINUTES} and ${MAX_STUCK_AFTER_MINUTES}.`,
    );
  }
  return minutes;
}

function exitCodeFor(report: DoctorReport, controller: AbortController): number {
  if (controller.signal.aborted) {
    return INTERRUPTED_EXIT_CODE;
  }
  return report.success ? 0 : 1;
}

function fixLines(report: DoctorReport): string[] {
  return report.fixes.flatMap(formatFixLines);
}

function planLines(plan: FixPlan): string[] {
  return [
    `Remediation plan: for each download below, ${FIX_ACTION}.`,
    ...describeFixPlan(plan).map((line) => `   ↳ ${line}`),
  ];
}

async function runNonInteractive(
  ctx: DoctorContext,
  settings: DoctorSettings,
  controller: AbortController,
): Promise<void> {
  const json = settings.mode === 'json';
  if (!json) {
    console.log(`Moody Blues CLI v${settings.version} — Doctor (Headless)`);
    console.log(SEPARATOR);
  }

  const report = await runDoctor({
    ctx,
    checks: buildDoctorChecks({ realDebrid: settings.realDebrid }),
    fix: settings.fix
      ? {
          confirm: async (plan): Promise<FixDecision> => {
            if (!json) {
              planLines(plan).forEach((line) => console.log(line));
            }
            return settings.yes ? 'approved' : 'unavailable';
          },
        }
      : undefined,
    onResult: json
      ? undefined
      : (result) => formatDoctorLines(result).forEach((line) => console.log(line)),
    onRemediation: json ? undefined : (message) => console.log(`${message}...`),
  });

  if (controller.signal.aborted) {
    if (!json) {
      console.error('Interrupted.');
    }
    process.exitCode = INTERRUPTED_EXIT_CODE;
    return;
  }

  if (json) {
    printJson(toDoctorJson(report));
  } else {
    console.log(SEPARATOR);
    if (settings.fix && report.fixes.length === 0) {
      console.log(NOTHING_TO_FIX);
    }
    fixLines(report).forEach((line) => console.log(line));
    console.log(formatDoctorSummary(report.counts));
  }
  process.exitCode = exitCodeFor(report, controller);
}

async function runInteractive(
  ctx: DoctorContext,
  settings: DoctorSettings,
  controller: AbortController,
): Promise<void> {
  const view = createViewMount(() => controller.abort());
  let progress: DoctorViewProps = { version: settings.version, results: [] };
  const show = (patch: Partial<DoctorViewProps>) => {
    progress = { ...progress, ...patch };
    view.show(createElement(DoctorView, progress));
  };
  const upsert = (result: DoctorResult) => {
    const known = progress.results.some((previous) => previous.id === result.id);
    return known
      ? progress.results.map((previous) => (previous.id === result.id ? result : previous))
      : [...progress.results, result];
  };
  const confirm = (plan: FixPlan): Promise<FixDecision> =>
    new Promise((settle) => {
      if (settings.yes) {
        settle('approved');
        return;
      }
      const answer = (decision: FixDecision) => {
        show({});
        settle(decision);
      };
      controller.signal.addEventListener('abort', () => settle('declined'), { once: true });
      view.show(
        createElement(ConfirmView, {
          version: settings.version,
          heading: 'Remove the stuck downloads',
          details: describeFixPlan(plan),
          confirmLabel: `For each download above, ${FIX_ACTION}. Continue?`,
          onConfirm: () => answer('approved'),
          onCancel: () => answer('declined'),
        }),
      );
    });

  try {
    show({ busy: 'Starting the diagnosis...' });
    const report = await runDoctor({
      ctx,
      checks: buildDoctorChecks({ realDebrid: settings.realDebrid }),
      fix: settings.fix ? { confirm } : undefined,
      onCheckStart: (check) => show({ busy: `Checking ${check.name}...` }),
      onResult: (result) => show({ results: upsert(result) }),
      onRemediation: (message) => show({ busy: `${message}...` }),
    });

    if (controller.signal.aborted) {
      view.unmount();
      console.error('Interrupted.');
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }

    const { counts } = report;
    show({
      busy: undefined,
      results: report.checks,
      notes: [
        ...(settings.fix && report.fixes.length === 0 ? [NOTHING_TO_FIX] : []),
        ...fixLines(report),
      ],
      summary: {
        text: formatDoctorSummary(counts),
        tone: counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'success',
      },
    });
    process.exitCode = exitCodeFor(report, controller);
  } finally {
    view.unmount();
  }
}

export async function executeDoctor(settings: DoctorSettings): Promise<void> {
  try {
    const controller = abortOnInterrupt();
    const ctx = createDoctorContext({
      home: settings.home,
      version: settings.version,
      stuckAfterMs: settings.stuckAfterMinutes * MINUTE_MS,
      signal: controller.signal,
    });

    if (settings.mode === 'interactive') {
      await runInteractive(ctx, settings, controller);
    } else {
      await runNonInteractive(ctx, settings, controller);
    }
  } catch (error) {
    failWith(error);
  }
}

interface DoctorCommandOptions {
  home?: string;
  fix?: boolean;
  stuckAfter: number;
  realdebrid?: boolean;
}

export function createDoctorCommand(version: string): Command {
  const doctorCmd = new Command('doctor');

  doctorCmd
    .description('Diagnose the stack and remove stuck downloads')
    .option(
      '--fix',
      'Remove stuck downloads from the queues, blocklist their releases and search again',
    )
    .option(
      '--stuck-after <minutes>',
      'Minutes after the grab before a queued import counts as stuck (1-1440)',
      parseStuckAfter,
      DEFAULT_STUCK_AFTER_MINUTES,
    )
    .option(
      '--realdebrid',
      'Also read the Real-Debrid account to verify the subscription (one request to api.real-debrid.com)',
    )
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (options: DoctorCommandOptions) => {
      const globals = doctorCmd.optsWithGlobals();
      await executeDoctor({
        home: options.home,
        fix: Boolean(options.fix),
        stuckAfterMinutes: options.stuckAfter,
        realDebrid: Boolean(options.realdebrid),
        yes: Boolean(globals.yes),
        mode: resolveOutputMode(globals),
        version,
      });
    });

  return doctorCmd;
}

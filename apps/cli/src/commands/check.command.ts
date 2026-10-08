import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';

import {
  type CheckContext,
  DEFAULT_CHECKS,
  loadCheckContext,
  runPreflightChecks,
  type SystemReport,
} from '../checks';
import { App } from '../ui/App';
import { isInteractiveTerminal } from '../utils/system.utils';
import { formatCheckLines } from './check-output.utils';

export async function executeHeadlessCheck(
  version: string,
  asJson = false,
  context: CheckContext = loadCheckContext(),
): Promise<void> {
  if (asJson) {
    const report = await runPreflightChecks(undefined, DEFAULT_CHECKS, context);
    console.log(JSON.stringify(report, null, 2));
    if (report.hasErrors) {
      process.exit(1);
    }
    return;
  }

  console.log(`Moody Blues CLI v${version} — Pre-flight Checks (Headless)`);
  console.log('-'.repeat(60));

  const report = await runPreflightChecks(
    (_rep, current) => {
      formatCheckLines(current).forEach((line) => console.log(line));
    },
    DEFAULT_CHECKS,
    context,
  );

  console.log('-'.repeat(60));
  if (report.hasErrors) {
    console.error('✖ ERROR: Host environment does not meet the requirements.');
    process.exit(1);
  } else if (report.hasWarnings) {
    console.log('⚠ NOTICE: System is ready, but warnings were detected.');
  } else {
    console.log('✔ SUCCESS: All pre-flight checks passed successfully.');
  }
}

export async function startInteractiveCheck(
  version: string,
  context: CheckContext = loadCheckContext(),
): Promise<void> {
  let exitCode = 0;

  const appInstance = render(
    React.createElement(App, {
      mode: 'check',
      version,
      context,
      onCompleted: (report: SystemReport) => {
        if (report.hasErrors) {
          exitCode = 1;
        }
      },
    }),
  );

  await appInstance.waitUntilExit();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export function createCheckCommand(version: string): Command {
  const checkCmd = new Command('check');

  checkCmd
    .description('Run host pre-flight health checks')
    .option('--headless', 'Output plain text report without interactive UI')
    .option('--json', 'Output check results as structured JSON')
    .action(async (cmdOptions) => {
      const opts = checkCmd.optsWithGlobals();
      const headless =
        cmdOptions.headless ||
        opts.headless ||
        cmdOptions.json ||
        opts.json ||
        !isInteractiveTerminal();
      const asJson = Boolean(cmdOptions.json || opts.json);

      if (headless) {
        await executeHeadlessCheck(version, asJson);
      } else {
        await startInteractiveCheck(version);
      }
    });

  return checkCmd;
}

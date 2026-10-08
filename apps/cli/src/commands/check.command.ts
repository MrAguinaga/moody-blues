import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';

import { runPreflightChecks, type SystemReport } from '../checks';
import { App } from '../ui/App';
import { isInteractiveTerminal } from '../utils/system.utils';

export async function executeHeadlessCheck(version: string, asJson = false): Promise<void> {
  if (asJson) {
    const report = await runPreflightChecks();
    console.log(JSON.stringify(report, null, 2));
    if (report.hasErrors) {
      process.exit(1);
    }
    return;
  }

  console.log(`Moody Blues CLI v${version} — Pre-flight Checks (Headless)`);
  console.log('-'.repeat(60));

  const report = await runPreflightChecks((_rep, current) => {
    if (current.status !== 'running' && current.status !== 'pending') {
      const badge =
        current.status === 'success' ? '[OK]' : current.status === 'warning' ? '[WARN]' : '[FAIL]';

      console.log(`${badge} ${current.name} — ${current.message ?? ''}`);
      if (current.error) {
        console.log(`   ↳ Detail: ${current.error}`);
      }
      if (current.suggestion) {
        console.log(`   ↳ Suggestion: ${current.suggestion}`);
      }
    }
  });

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

export async function startInteractiveCheck(version: string): Promise<void> {
  let exitCode = 0;

  const appInstance = render(
    React.createElement(App, {
      mode: 'check',
      version,
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

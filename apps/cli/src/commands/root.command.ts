import { render } from 'ink';
import React from 'react';

import type { SystemReport } from '../checks';
import { App } from '../ui/App';
import { isInteractiveTerminal } from '../utils/system.utils';
import { executeHeadlessCheck } from './check.command';

export interface RootActionOptions {
  headless?: boolean;
  json?: boolean;
}

export async function startInteractiveWelcome(version: string): Promise<void> {
  let exitCode = 0;

  const appInstance = render(
    React.createElement(App, {
      mode: 'welcome',
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

export async function handleRootAction(options: RootActionOptions, version: string): Promise<void> {
  const headless = options.headless || options.json || !isInteractiveTerminal();

  if (headless) {
    await executeHeadlessCheck(version, Boolean(options.json));
  } else {
    await startInteractiveWelcome(version);
  }
}

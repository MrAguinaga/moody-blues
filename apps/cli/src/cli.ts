import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import {
  createCheckCommand,
  createConfigCommand,
  createDoctorCommand,
  createLogsCommand,
  createRemoveCommand,
  createResetCommand,
  createRetryCommand,
  createSetupCommand,
  createStartCommand,
  createStatusCommand,
  createStopCommand,
  createTunnelCommand,
  createUpdateCommand,
  handleRootAction,
} from './commands';

export const CLI_VERSION: string = pkg.version;

export function buildCliProgram(): Command {
  const program = new Command();

  program
    .name('moody-blues')
    .description('Autonomous personal media suite')
    .version(CLI_VERSION, '-v, --version', 'Display installed version')
    .option('--headless', 'Disable interactive TTY and run in headless mode')
    .option('--json', 'Output report as structured JSON')
    .option('-y, --yes', 'Automatically confirm prompts');

  program.addCommand(createCheckCommand(CLI_VERSION));
  program.addCommand(createSetupCommand(CLI_VERSION));
  program.addCommand(createStartCommand(CLI_VERSION));
  program.addCommand(createStopCommand());
  program.addCommand(createStatusCommand(CLI_VERSION));
  program.addCommand(createResetCommand(CLI_VERSION));
  program.addCommand(createDoctorCommand(CLI_VERSION));
  program.addCommand(createTunnelCommand(CLI_VERSION));
  program.addCommand(createLogsCommand());
  program.addCommand(createConfigCommand(CLI_VERSION));
  program.addCommand(createRemoveCommand(CLI_VERSION));
  program.addCommand(createRetryCommand(CLI_VERSION));
  program.addCommand(createUpdateCommand(CLI_VERSION));

  program.action(async () => {
    const globalOpts = program.opts();
    await handleRootAction(globalOpts, CLI_VERSION);
  });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildCliProgram();
  await program.parseAsync(argv);
}

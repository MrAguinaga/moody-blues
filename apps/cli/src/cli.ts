import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { createCheckCommand, handleRootAction } from './commands';

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

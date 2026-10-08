import { Command } from 'commander';

import { COMPOSE_PROJECT_NAME, createComposeRunner, isMountActive } from '../docker';
import { loadInstallation } from '../installation';
import { failWith, resolveOutputMode } from '../utils/command.utils';
import { printJson } from './stack-output.utils';

export interface StopSettings {
  home?: string;
  json: boolean;
}

export async function executeStop(settings: StopSettings): Promise<void> {
  const { home, json } = settings;

  try {
    const installation = loadInstallation({ home });
    const runner = createComposeRunner(installation, { requireHardware: false });

    if (!json) {
      console.log('Stopping containers...');
    }
    await runner.down();

    const warnings: string[] = [];
    const debridMount = installation.layout.debridMountDir;
    if (process.platform === 'linux' && (await isMountActive(debridMount))) {
      warnings.push(
        `${debridMount} is still mounted after the containers stopped. Release it with: sudo umount -l ${debridMount}`,
      );
    }

    if (json) {
      printJson({ project: COMPOSE_PROJECT_NAME, stopped: true, warnings });
      return;
    }
    console.log('✔ Containers stopped. Data and configuration were kept.');
    warnings.forEach((warning) => console.warn(`⚠ ${warning}`));
  } catch (error) {
    failWith(error);
  }
}

export function createStopCommand(): Command {
  const stopCmd = new Command('stop');

  stopCmd
    .description('Stop and remove the containers without deleting any data')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (options: { home?: string }) => {
      await executeStop({
        home: options.home,
        json: resolveOutputMode(stopCmd.optsWithGlobals()) === 'json',
      });
    });

  return stopCmd;
}

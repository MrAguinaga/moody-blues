import { Command } from 'commander';

import { MB_SSH_TARGET_ENV, resolveSshTarget, runTunnel } from '../tunnel';
import {
  abortOnInterrupt,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import { printJson } from './stack-output.utils';
import { formatTunnelLines, toTunnelJson } from './tunnel-output.utils';

export interface TunnelSettings {
  target?: string;
  mode: OutputMode;
  version: string;
}

export async function executeTunnel(settings: TunnelSettings): Promise<void> {
  const json = settings.mode === 'json';

  try {
    const target = resolveSshTarget(settings.target, process.env);
    const controller = abortOnInterrupt();

    if (!json) {
      console.log(`Moody Blues CLI v${settings.version} — Tunnel to ${target}`);
    }

    await runTunnel({
      target,
      signal: controller.signal,
      onConnecting: () => {
        if (!json) {
          console.log('Connecting... (press Ctrl+C to close the tunnel)');
        }
      },
      onReady: (report) => {
        if (json) {
          printJson(toTunnelJson(report));
        } else {
          formatTunnelLines(report).forEach((line) => console.log(line));
        }
      },
    });

    if (!json) {
      console.log('Tunnel closed.');
    }
  } catch (error) {
    failWith(error);
  }
}

export function createTunnelCommand(version: string): Command {
  const tunnelCmd = new Command('tunnel');

  tunnelCmd
    .description(
      'Open SSH port forwards to the administration panels of the server (Sonarr, Radarr, Prowlarr, Bazarr, Decypharr)',
    )
    .argument(
      '[target]',
      `Destination accepted by ssh, such as user@host or an ssh config alias (defaults to ${MB_SSH_TARGET_ENV})`,
    )
    .action(async (target: string | undefined) => {
      await executeTunnel({
        target,
        mode: resolveOutputMode(tunnelCmd.optsWithGlobals()),
        version,
      });
    });

  return tunnelCmd;
}

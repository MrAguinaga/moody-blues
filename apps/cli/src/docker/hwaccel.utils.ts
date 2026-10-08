import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const RENDER_DEVICE_PATH = '/dev/dri/renderD128';

export type HardwareAccel = { kind: 'vaapi'; renderGid: number } | { kind: 'nvidia' };

export interface HardwareProbe {
  renderDeviceGid(): number | undefined;
  hasExecutable(name: string): boolean;
}

export function createHostProbe(env: NodeJS.ProcessEnv = process.env): HardwareProbe {
  return {
    renderDeviceGid: () => {
      try {
        return statSync(RENDER_DEVICE_PATH).gid;
      } catch {
        return undefined;
      }
    },
    hasExecutable: (name) =>
      (env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .some((directory) => {
          try {
            accessSync(join(directory, name), constants.X_OK);
            return true;
          } catch {
            return false;
          }
        }),
  };
}

export function detectHardwareAccel(
  probe: HardwareProbe = createHostProbe(),
): HardwareAccel | undefined {
  const renderGid = probe.renderDeviceGid();
  if (renderGid !== undefined) {
    return { kind: 'vaapi', renderGid };
  }
  if (probe.hasExecutable('nvidia-smi')) {
    return { kind: 'nvidia' };
  }
  return undefined;
}

import { describe, expect, it } from 'vitest';

import { detectHardwareAccel, type HardwareProbe } from './hwaccel.utils';

function probe(overrides: Partial<HardwareProbe>): HardwareProbe {
  return { renderDeviceGid: () => undefined, hasExecutable: () => false, ...overrides };
}

describe('detectHardwareAccel', () => {
  it('prefers VAAPI and reports the gid of the render device', () => {
    const result = detectHardwareAccel(
      probe({ renderDeviceGid: () => 105, hasExecutable: () => true }),
    );

    expect(result).toEqual({ kind: 'vaapi', renderGid: 105 });
  });

  it('falls back to NVIDIA when nvidia-smi is available', () => {
    const result = detectHardwareAccel(probe({ hasExecutable: (name) => name === 'nvidia-smi' }));

    expect(result).toEqual({ kind: 'nvidia' });
  });

  it('returns undefined when no accelerator is present', () => {
    expect(detectHardwareAccel(probe({}))).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  detectContextHardware,
  detectHardwareAccel,
  type HardwareProbe,
  toHardwareKind,
} from './hwaccel.utils';

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

describe('toHardwareKind', () => {
  it.each([
    [{ kind: 'vaapi', renderGid: 105 } as const, 'vaapi'],
    [{ kind: 'nvidia' } as const, 'nvidia'],
    [undefined, undefined],
  ])('maps %j to %s', (hardware, expected) => {
    expect(toHardwareKind(hardware)).toBe(expected);
  });
});

describe('detectContextHardware', () => {
  it.each(['off', 'cpu'] as const)('does not probe the host in %s mode', (transcoding) => {
    const renderDeviceGid = vi.fn(() => 105);
    const hasExecutable = vi.fn(() => true);

    const result = detectContextHardware({ transcoding }, { renderDeviceGid, hasExecutable });

    expect(result).toBeUndefined();
    expect(renderDeviceGid).not.toHaveBeenCalled();
    expect(hasExecutable).not.toHaveBeenCalled();
  });

  it('returns the kind of the detected accelerator in hardware mode', () => {
    expect(
      detectContextHardware({ transcoding: 'hardware' }, probe({ renderDeviceGid: () => 105 })),
    ).toBe('vaapi');
    expect(
      detectContextHardware(
        { transcoding: 'hardware' },
        probe({ hasExecutable: (name) => name === 'nvidia-smi' }),
      ),
    ).toBe('nvidia');
  });

  it('returns undefined in hardware mode without a GPU', () => {
    expect(detectContextHardware({ transcoding: 'hardware' }, probe({}))).toBeUndefined();
  });
});

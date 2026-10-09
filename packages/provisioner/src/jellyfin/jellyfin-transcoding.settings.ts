import type { HardwareAccelKind, TranscodingMode } from '../config';
import { VAAPI_DEVICE_PATH } from './jellyfin.constants';
import type { EncodingOptions, PlaybackPolicy } from './jellyfin.types';

const HARDWARE_ACCELERATION_TYPES = { vaapi: 'vaapi', nvidia: 'nvenc' } as const;

export class HardwareAccelerationMissingError extends Error {
  constructor() {
    super(
      'Hardware transcoding is configured but no GPU was detected (/dev/dri/renderD128 or nvidia-smi)',
    );
    this.name = 'HardwareAccelerationMissingError';
  }
}

export function buildPlaybackPolicy(mode: TranscodingMode): PlaybackPolicy {
  return {
    EnableVideoPlaybackTranscoding: mode !== 'off',
    EnableAudioPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
  };
}

export function buildEncodingSettings(
  mode: TranscodingMode,
  hardware?: HardwareAccelKind,
): Partial<EncodingOptions> {
  if (mode !== 'hardware') {
    return { HardwareAccelerationType: 'none' };
  }
  if (!hardware) {
    throw new HardwareAccelerationMissingError();
  }
  return {
    HardwareAccelerationType: HARDWARE_ACCELERATION_TYPES[hardware],
    ...(hardware === 'vaapi' ? { VaapiDevice: VAAPI_DEVICE_PATH } : {}),
    EnableHardwareEncoding: true,
  };
}

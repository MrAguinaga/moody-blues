import { describe, expect, it } from 'vitest';

import { TRANSCODING_MODES } from '../config';
import {
  buildEncodingSettings,
  buildPlaybackPolicy,
  HardwareAccelerationMissingError,
} from './jellyfin-transcoding.settings';

describe('buildPlaybackPolicy', () => {
  it('withdraws only the video permission in off mode', () => {
    expect(buildPlaybackPolicy('off')).toEqual({
      EnableVideoPlaybackTranscoding: false,
      EnableAudioPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
    });
  });

  it.each(['cpu', 'hardware'] as const)('allows every kind of playback in %s mode', (mode) => {
    expect(buildPlaybackPolicy(mode)).toEqual({
      EnableVideoPlaybackTranscoding: true,
      EnableAudioPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
    });
  });

  it('only ever sets the three playback keys', () => {
    for (const mode of TRANSCODING_MODES) {
      expect(Object.keys(buildPlaybackPolicy(mode)).sort()).toEqual([
        'EnableAudioPlaybackTranscoding',
        'EnablePlaybackRemuxing',
        'EnableVideoPlaybackTranscoding',
      ]);
    }
  });
});

describe('buildEncodingSettings', () => {
  it.each(['off', 'cpu'] as const)('only resets the accelerator in %s mode', (mode) => {
    expect(buildEncodingSettings(mode)).toEqual({ HardwareAccelerationType: 'none' });
  });

  it.each(['off', 'cpu'] as const)('ignores a detected accelerator in %s mode', (mode) => {
    expect(buildEncodingSettings(mode, 'vaapi')).toEqual({ HardwareAccelerationType: 'none' });
  });

  it('maps VAAPI to the render node and hardware encoding', () => {
    expect(buildEncodingSettings('hardware', 'vaapi')).toEqual({
      HardwareAccelerationType: 'vaapi',
      VaapiDevice: '/dev/dri/renderD128',
      EnableHardwareEncoding: true,
    });
  });

  it('maps NVIDIA to nvenc without a device path', () => {
    expect(buildEncodingSettings('hardware', 'nvidia')).toEqual({
      HardwareAccelerationType: 'nvenc',
      EnableHardwareEncoding: true,
    });
  });

  it('fails with a typed error in hardware mode without an accelerator', () => {
    expect(() => buildEncodingSettings('hardware')).toThrow(HardwareAccelerationMissingError);
    expect(() => buildEncodingSettings('hardware')).toThrow(/no GPU was detected/);
  });

  it('never touches the disk safeguards', () => {
    for (const mode of TRANSCODING_MODES) {
      const keys = Object.keys(buildEncodingSettings(mode, 'vaapi'));
      expect(keys).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/TranscodingTempPath|Segment|EnableThrottling/),
        ]),
      );
    }
  });
});

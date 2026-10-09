import type { MoodyBluesConfig } from './config.types';

export const CONFIG_KEYS = ['transcoding', 'quality-cap'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const CONFIG_PRECONDITIONS = ['gpu', 'jellyfin-running', 'arr-running'] as const;
export type Precondition = (typeof CONFIG_PRECONDITIONS)[number];

export interface ConfigChange {
  key: ConfigKey;
  value: string;
  current: MoodyBluesConfig;
  next: MoodyBluesConfig;
}

export interface ConfigChangePlan {
  stepIds: string[];
  disruptive: boolean;
  disruption?: string;
  preconditions: Precondition[];
  warnings: string[];
}

export const HARDWARE_CROSSING_DISRUPTION =
  'Jellyfin will be recreated and active playback sessions will be interrupted.';
export const OFF_MODE_WARNING =
  'Video is never re-encoded by policy; remux and audio transcoding are allowed. ' +
  'Clients that cannot decode the original video will not play it.';

const TRANSCODING_STEPS = ['persist-state', 'jellyfin-transcoding'];
const HARDWARE_CROSSING_STEPS = [
  'persist-state',
  'containers-up',
  'wait-healthy',
  'jellyfin-transcoding',
];
const QUALITY_CAP_STEPS = ['persist-state', 'master-profile'];

function planTranscoding({ current, next }: ConfigChange): ConfigChangePlan {
  const crossesHardware =
    (current.transcoding === 'hardware') !== (next.transcoding === 'hardware');
  const needsGpu = next.transcoding === 'hardware';

  return {
    stepIds: crossesHardware ? [...HARDWARE_CROSSING_STEPS] : [...TRANSCODING_STEPS],
    disruptive: crossesHardware,
    ...(crossesHardware ? { disruption: HARDWARE_CROSSING_DISRUPTION } : {}),
    preconditions: [
      ...(needsGpu ? (['gpu'] as const) : []),
      ...(crossesHardware ? [] : (['jellyfin-running'] as const)),
    ],
    warnings: next.transcoding === 'off' ? [OFF_MODE_WARNING] : [],
  };
}

export function planConfigChange(change: ConfigChange): ConfigChangePlan {
  switch (change.key) {
    case 'transcoding':
      return planTranscoding(change);
    case 'quality-cap':
      return {
        stepIds: [...QUALITY_CAP_STEPS],
        disruptive: false,
        preconditions: ['arr-running'],
        warnings: [],
      };
  }
}

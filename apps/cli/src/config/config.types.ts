import type { ConfigKey, PipelineReport } from '@moody-blues/provisioner';

export type { ConfigKey };

export interface SettingView {
  key: ConfigKey;
  value: string;
  allowed: string[];
  writable: boolean;
}

export interface ConfigRunReport {
  success: boolean;
  key: ConfigKey;
  previous: string;
  value: string;
  changed: boolean;
  steps: string[];
  pipeline: PipelineReport;
}

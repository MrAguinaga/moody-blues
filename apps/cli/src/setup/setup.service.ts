import {
  type ContainerRuntime,
  createLayout,
  INFRASTRUCTURE_STEPS,
  type PipelineEvent,
  type PipelineReport,
  runPipeline,
} from '@moody-blues/provisioner';

import {
  type CheckUpdateCallback,
  DEFAULT_CHECKS,
  runPreflightChecks,
  type SystemReport,
} from '../checks';
import type { SetupInput } from './setup.types';

export interface SetupRunOptions {
  input: SetupInput;
  home: string;
  cliVersion: string;
  runtime: ContainerRuntime;
  signal: AbortSignal;
  onCheckUpdate?: CheckUpdateCallback;
  onPipelineEvent?: (event: PipelineEvent) => void;
}

export interface SetupReport {
  success: boolean;
  checks: SystemReport;
  pipeline?: PipelineReport;
}

export async function runSetup(options: SetupRunOptions): Promise<SetupReport> {
  const { input, home, cliVersion, runtime, signal } = options;
  const { config, secrets } = input;

  const checks = await runPreflightChecks(options.onCheckUpdate, DEFAULT_CHECKS, {
    mode: config.mode,
    domain: config.domain,
    home,
  });
  if (checks.hasErrors) {
    return { success: false, checks };
  }

  const pipeline = await runPipeline(
    INFRASTRUCTURE_STEPS,
    {
      config,
      secrets,
      layout: createLayout(home),
      identity: config.host,
      runtime,
      flags: new Map(),
      cliVersion,
    },
    { scope: 'setup', signal, onEvent: options.onPipelineEvent },
  );

  return { success: pipeline.success, checks, pipeline };
}

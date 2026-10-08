import type { HostIdentity, MoodyBluesConfig } from '../config';
import type { MbHomeLayout } from '../home';
import type { UserSecrets } from '../state';

export const PROVISION_SCOPES = ['setup', 'reset', 'update', 'config'] as const;
export type ProvisionScope = (typeof PROVISION_SCOPES)[number];

export interface RuntimeCallOptions {
  signal: AbortSignal;
}

export interface WaitHealthyOptions extends RuntimeCallOptions {
  onProgress?: (message: string) => void;
}

export interface ContainerRuntime {
  up(options: RuntimeCallOptions): Promise<void>;
  waitHealthy(options: WaitHealthyOptions): Promise<void>;
  reloadGateway(options: RuntimeCallOptions): Promise<void>;
}

export type PipelineFlags = Map<string, boolean>;

export interface ProvisionContext {
  config: MoodyBluesConfig;
  secrets: UserSecrets;
  layout: MbHomeLayout;
  identity: HostIdentity;
  runtime: ContainerRuntime;
  flags: PipelineFlags;
  cliVersion: string;
  reportProgress?: (message: string) => void;
}

export type StepStatus = 'changed' | 'unchanged' | 'skipped';

export interface StepOutcome {
  status: StepStatus;
  detail?: string;
}

export interface ProvisionStep {
  id: string;
  title: string;
  scopes: readonly ProvisionScope[];
  run(ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome>;
}

export interface StepDescriptor {
  id: string;
  title: string;
}

export type PipelineEvent =
  | { type: 'pipeline-start'; scope: ProvisionScope; steps: StepDescriptor[] }
  | ({ type: 'step-start'; index: number; total: number } & StepDescriptor)
  | ({ type: 'step-progress'; message: string } & StepDescriptor)
  | ({ type: 'step-done'; outcome: StepOutcome; durationMs: number } & StepDescriptor)
  | ({ type: 'step-failed'; error: string; durationMs: number } & StepDescriptor);

export type StepResultStatus = StepStatus | 'failed';

export interface StepResult extends StepDescriptor {
  status: StepResultStatus;
  detail?: string;
  durationMs: number;
}

export interface PipelineReport {
  scope: ProvisionScope;
  success: boolean;
  aborted: boolean;
  steps: StepResult[];
  error?: string;
}

export interface RunPipelineOptions {
  scope: ProvisionScope;
  signal?: AbortSignal;
  onEvent?: (event: PipelineEvent) => void;
}

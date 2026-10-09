import {
  type ConfigChangePlan,
  type ContainerRuntime,
  type MoodyBluesConfig,
  parseUserSecrets,
  type PipelineEvent,
  planConfigChange,
  type Precondition,
  PROVISIONING_PIPELINE,
  type ProvisionStep,
  runPipeline,
  selectConfigSteps,
} from '@moody-blues/provisioner';

import { evaluateTranscoding } from '../checks';
import {
  type ComposeRunner,
  createComposeRunner,
  createComposeRuntime,
  createHostProbe,
  detectContextHardware,
  detectHardwareAccel,
  type HardwareProbe,
  isServiceHealthy,
} from '../docker';
import { type Installation, loadInstallation } from '../installation';
import { CONFIG_SETTINGS } from './config.settings';
import type { ConfigKey, ConfigRunReport } from './config.types';

const STACK_HINT =
  'Start the stack with "moody-blues start" or diagnose it with "moody-blues doctor".';

const PRECONDITION_SERVICES: Readonly<Record<Exclude<Precondition, 'gpu'>, readonly string[]>> = {
  'jellyfin-running': ['jellyfin'],
  'arr-running': ['sonarr', 'radarr'],
};

export type ConfigDecision = 'approved' | 'declined' | 'unavailable';

export interface ConfigPlanView {
  key: ConfigKey;
  previous: string;
  value: string;
  stepIds: string[];
  disruptive: boolean;
  disruption?: string;
  notes: string[];
}

export type ConfigOutcome =
  | { kind: 'applied'; report: ConfigRunReport }
  | { kind: 'declined'; plan: ConfigPlanView }
  | { kind: 'unconfirmed'; plan: ConfigPlanView };

export interface ConfigDeps {
  load(home?: string): Installation;
  createRunner(installation: Installation): Pick<ComposeRunner, 'ps'>;
  createRuntime(home: string): ContainerRuntime;
  probe: HardwareProbe;
  pipeline: readonly ProvisionStep[];
}

export interface ConfigChangeOptions {
  home?: string;
  key: ConfigKey;
  value: string;
  cliVersion: string;
  signal: AbortSignal;
  confirm?: (plan: ConfigPlanView) => Promise<ConfigDecision>;
  onPlan?: (plan: ConfigPlanView) => void;
  onEvent?: (event: PipelineEvent) => void;
  deps?: Partial<ConfigDeps>;
}

const DEFAULT_DEPS: ConfigDeps = {
  load: (home) => loadInstallation({ home }),
  createRunner: (installation) => createComposeRunner(installation, { requireHardware: false }),
  createRuntime: (home) => createComposeRuntime({ home }),
  probe: createHostProbe(),
  pipeline: PROVISIONING_PIPELINE,
};

async function requireServices(
  runner: Pick<ComposeRunner, 'ps'>,
  precondition: Exclude<Precondition, 'gpu'>,
  signal: AbortSignal,
): Promise<void> {
  const status = await runner.ps({ signal });
  const required = PRECONDITION_SERVICES[precondition];

  for (const name of required) {
    const service = status.services.find((candidate) => candidate.service === name);
    if (!service || !isServiceHealthy(service)) {
      const state = service ? `${service.state}, health ${service.health}` : 'not found';
      throw new Error(`The service "${name}" is not running and healthy (${state}). ${STACK_HINT}`);
    }
  }
}

function checkGpu(next: MoodyBluesConfig, probe: HardwareProbe): string[] {
  const result = evaluateTranscoding({
    mode: next.transcoding,
    hardware: detectHardwareAccel(probe),
  });

  const message = result.message ?? '';
  if (result.status === 'error') {
    throw new Error(`${message}. ${result.suggestion ?? ''}`.trim());
  }
  return result.status === 'warning' ? [message] : [];
}

async function checkPreconditions(
  plan: ConfigChangePlan,
  change: { key: ConfigKey; next: MoodyBluesConfig },
  context: { runner: Pick<ComposeRunner, 'ps'>; probe: HardwareProbe; signal: AbortSignal },
): Promise<string[]> {
  const notes = change.key === 'transcoding' ? checkGpu(change.next, context.probe) : [];

  for (const precondition of plan.preconditions) {
    if (precondition !== 'gpu') {
      await requireServices(context.runner, precondition, context.signal);
    }
  }
  return notes;
}

export async function runConfigChange(options: ConfigChangeOptions): Promise<ConfigOutcome> {
  const { key, value, signal } = options;
  const deps: ConfigDeps = { ...DEFAULT_DEPS, ...options.deps };

  const installation = deps.load(options.home);
  const { layout, config, env } = installation;

  const secrets = parseUserSecrets(env);
  if (!secrets.ok) {
    throw new Error(
      `The saved secrets in ${layout.envFile} are incomplete:\n- ${secrets.error.join('\n- ')}\n` +
        'Run "moody-blues setup" to provide them again.',
    );
  }

  const setting = CONFIG_SETTINGS[key];
  const previous = setting.read(config);
  const next = setting.apply(config, value);
  const plan = planConfigChange({ key, value, current: config, next });

  const preconditionNotes = await checkPreconditions(
    plan,
    { key, next },
    {
      runner: deps.createRunner(installation),
      probe: deps.probe,
      signal,
    },
  );

  const view: ConfigPlanView = {
    key,
    previous,
    value,
    stepIds: plan.stepIds,
    disruptive: plan.disruptive,
    ...(plan.disruption ? { disruption: plan.disruption } : {}),
    notes: [...plan.warnings, ...preconditionNotes],
  };
  options.onPlan?.(view);

  if (plan.disruptive) {
    const decision = (await options.confirm?.(view)) ?? 'unavailable';
    if (decision === 'declined') {
      return { kind: 'declined', plan: view };
    }
    if (decision === 'unavailable') {
      return { kind: 'unconfirmed', plan: view };
    }
  }

  const pipeline = await runPipeline(
    selectConfigSteps(deps.pipeline, plan.stepIds),
    {
      config: next,
      secrets: secrets.value.secrets,
      layout,
      identity: next.host,
      runtime: deps.createRuntime(layout.root),
      flags: new Map(),
      cliVersion: options.cliVersion,
      hardware: detectContextHardware(next, deps.probe),
    },
    { scope: 'config', signal, onEvent: options.onEvent },
  );

  return {
    kind: 'applied',
    report: {
      success: pipeline.success,
      key,
      previous,
      value,
      changed: previous !== value,
      steps: plan.stepIds,
      pipeline,
    },
  };
}

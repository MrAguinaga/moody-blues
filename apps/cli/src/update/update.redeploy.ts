import {
  type ContainerRuntime,
  parseUserSecrets,
  type PipelineEvent,
  type PipelineReport,
  PROVISIONING_PIPELINE,
  type ProvisionStep,
  runPipeline,
} from '@moody-blues/provisioner';

import {
  type ComposeRunner,
  createComposeRunner,
  createComposeRuntime,
  detectContextHardware,
  detectDockerCpus,
} from '../docker';
import { type Installation, loadInstallation } from '../installation';
import { errorMessage } from '../utils/command.utils';

export interface RedeployDeps {
  load(home?: string): Installation;
  createRunner(installation: Installation): Pick<ComposeRunner, 'pull'>;
  createRuntime(home: string): ContainerRuntime;
  detectCpus(): Promise<number | undefined>;
  pipeline: readonly ProvisionStep[];
}

export interface RedeployOptions {
  home?: string;
  cliVersion: string;
  signal: AbortSignal;
  onStage?: (message: string) => void;
  onEvent?: (event: PipelineEvent) => void;
  deps?: Partial<RedeployDeps>;
}

export interface RedeployReport {
  success: boolean;
  aborted: boolean;
  pulled: boolean;
  pipeline?: PipelineReport;
  error?: string;
}

const DEFAULT_DEPS: RedeployDeps = {
  load: (home) => loadInstallation({ home }),
  createRunner: (installation) => createComposeRunner(installation),
  createRuntime: (home) => createComposeRuntime({ home }),
  detectCpus: detectDockerCpus,
  pipeline: PROVISIONING_PIPELINE,
};

export async function runRedeploy(options: RedeployOptions): Promise<RedeployReport> {
  const { signal } = options;
  const deps: RedeployDeps = { ...DEFAULT_DEPS, ...options.deps };
  const installation = deps.load(options.home);
  const { layout, config, env } = installation;

  const secrets = parseUserSecrets(env);
  if (!secrets.ok) {
    throw new Error(
      `The saved secrets in ${layout.envFile} are incomplete:\n- ${secrets.error.join('\n- ')}\n` +
        'Run "moody-blues setup" to provide them again.',
    );
  }

  options.onStage?.('Pulling the container images...');
  try {
    await deps.createRunner(installation).pull({ signal });
  } catch (error) {
    if (signal.aborted) {
      return { success: false, aborted: true, pulled: false, error: 'Interrupted.' };
    }
    return { success: false, aborted: false, pulled: false, error: errorMessage(error) };
  }

  options.onStage?.('Starting the stack and reapplying the provisioning...');
  const pipeline = await runPipeline(
    deps.pipeline,
    {
      config,
      secrets: secrets.value.secrets,
      layout,
      identity: config.host,
      runtime: deps.createRuntime(layout.root),
      flags: new Map(),
      cliVersion: options.cliVersion,
      hardware: detectContextHardware(config),
      dockerCpus: await deps.detectCpus(),
    },
    { scope: 'setup', signal, onEvent: options.onEvent },
  );

  return {
    success: pipeline.success,
    aborted: pipeline.aborted,
    pulled: true,
    pipeline,
    ...(pipeline.error ? { error: pipeline.error } : {}),
  };
}

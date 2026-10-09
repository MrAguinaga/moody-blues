export const COMPOSE_PROJECT_NAME = 'moody-blues';

export type ServiceState = 'running' | 'restarting' | 'exited' | 'created' | 'paused' | 'missing';

export type ServiceHealth = 'healthy' | 'unhealthy' | 'starting' | 'none';

export interface ServiceStatus {
  service: string;
  state: ServiceState;
  health: ServiceHealth;
  exitCode: number;
  publishedPorts: string[];
}

export interface StackStatus {
  project: string;
  timestamp: string;
  allHealthy: boolean;
  services: ServiceStatus[];
}

export interface RunOptions {
  signal?: AbortSignal;
}

export interface PullOptions extends RunOptions {
  services?: string[];
}

export interface KillOptions extends RunOptions {
  services?: string[];
  unixSignal?: string;
}

export interface LogsOptions extends RunOptions {
  follow?: boolean;
  tail?: number;
  since?: string;
  timestamps?: boolean;
  onLine: (line: string) => void;
}

export interface ComposeOutput {
  stdout: string;
  stderr: string;
}

export interface ComposeRunner {
  readonly files: readonly string[];
  up(options?: RunOptions): Promise<void>;
  down(options?: RunOptions): Promise<void>;
  ps(options?: RunOptions): Promise<StackStatus>;
  listServices(options?: RunOptions): Promise<string[]>;
  pull(options?: PullOptions): Promise<void>;
  kill(options?: KillOptions): Promise<void>;
  exec(service: string, command: string[], options?: RunOptions): Promise<ComposeOutput>;
  reloadGateway(options?: RunOptions): Promise<void>;
  logs(service: string, options: LogsOptions): Promise<void>;
}

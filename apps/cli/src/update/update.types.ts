export interface ReleaseInfo {
  tag: string;
  version: string;
  url: string;
  body: string;
}

export type UpdateSource = 'github' | 'cache';

export interface UpdateCheck {
  current: string;
  latest?: ReleaseInfo;
  updateAvailable: boolean;
  source: UpdateSource;
  checkedAt: string;
}

export type UpdateStepId =
  'check-clean' | 'git-fetch' | 'git-checkout' | 'install' | 'build' | 'rollback' | 'redeploy';

export type UpdateStepStatus = 'ok' | 'failed' | 'skipped';

export interface UpdateStepResult {
  id: UpdateStepId;
  title: string;
  status: UpdateStepStatus;
  message?: string;
  durationMs: number;
}

export interface CommandOptions {
  cwd: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<string>;

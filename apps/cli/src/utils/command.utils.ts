import { isInteractiveTerminal } from './system.utils';

export type OutputMode = 'interactive' | 'headless' | 'json';

export interface OutputOptions {
  headless?: boolean;
  json?: boolean;
}

export function resolveOutputMode(options: OutputOptions): OutputMode {
  if (options.json) {
    return 'json';
  }
  return options.headless || !isInteractiveTerminal() ? 'headless' : 'interactive';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failWith(error: unknown): void {
  console.error(`✖ ${errorMessage(error)}`);
  process.exitCode = 1;
}

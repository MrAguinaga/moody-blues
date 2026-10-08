export type CheckStatus = 'pending' | 'running' | 'success' | 'warning' | 'error';

export interface CheckResult {
  id: string;
  name: string;
  description: string;
  status: CheckStatus;
  message?: string;
  error?: string;
  suggestion?: string;
}

export interface SystemReport {
  timestamp: string;
  allPassed: boolean;
  hasWarnings: boolean;
  hasErrors: boolean;
  checks: CheckResult[];
}

export type CheckUpdateCallback = (report: SystemReport, currentCheck: CheckResult) => void;

export interface CheckDefinition {
  id: string;
  name: string;
  description: string;
  run: () => Promise<CheckResult>;
}

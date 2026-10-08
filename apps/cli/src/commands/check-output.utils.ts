import type { CheckResult } from '../checks';

const BADGES: Partial<Record<CheckResult['status'], string>> = {
  success: '[OK]',
  warning: '[WARN]',
  error: '[FAIL]',
};

export function formatCheckLines(check: CheckResult): string[] {
  const badge = BADGES[check.status];
  if (!badge) {
    return [];
  }

  const lines = [`${badge} ${check.name} — ${check.message ?? ''}`];
  if (check.error) {
    lines.push(`   ↳ Detail: ${check.error}`);
  }
  if (check.suggestion) {
    lines.push(`   ↳ Suggestion: ${check.suggestion}`);
  }
  return lines;
}

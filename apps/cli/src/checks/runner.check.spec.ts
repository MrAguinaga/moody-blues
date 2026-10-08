import { describe, expect, it, vi } from 'vitest';

import type { CheckContext, CheckDefinition } from './checks.types';
import { runPreflightChecks } from './runner.check';

function createCheck(id: string, status: 'success' | 'warning' | 'error'): CheckDefinition {
  const definition = { id, name: id, description: id };
  return { ...definition, run: vi.fn(async () => ({ ...definition, status })) };
}

describe('runPreflightChecks', () => {
  it('passes the context to every check', async () => {
    const context: CheckContext = { mode: 'remote', domain: 'example.com', home: '/opt/mb' };
    const checks = [createCheck('a', 'success'), createCheck('b', 'success')];

    await runPreflightChecks(undefined, checks, context);

    for (const check of checks) {
      expect(check.run).toHaveBeenCalledWith(context);
    }
  });

  it('runs without a context', async () => {
    const check = createCheck('a', 'success');

    const report = await runPreflightChecks(undefined, [check]);

    expect(check.run).toHaveBeenCalledWith({});
    expect(report.allPassed).toBe(true);
  });

  it('summarizes warnings and errors', async () => {
    const report = await runPreflightChecks(undefined, [
      createCheck('a', 'warning'),
      createCheck('b', 'error'),
    ]);

    expect(report).toMatchObject({ hasWarnings: true, hasErrors: true, allPassed: false });
  });
});

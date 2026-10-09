import type {
  CheckContext,
  CheckDefinition,
  CheckResult,
  CheckUpdateCallback,
  SystemReport,
} from './checks.types';
import { composeCheck } from './compose.check';
import { diskSpaceCheck } from './disk-space.check';
import { dnsCheck } from './dns.check';
import { dockerCheck } from './docker.check';
import { dockerGroupCheck } from './docker-group.check';
import { fuseCheck } from './fuse.check';
import { portsCheck } from './ports.check';
import { transcodingCheck } from './transcoding.check';

export const DEFAULT_CHECKS: CheckDefinition[] = [
  dockerCheck,
  dockerGroupCheck,
  composeCheck,
  portsCheck,
  fuseCheck,
  transcodingCheck,
  dnsCheck,
  diskSpaceCheck,
];

export async function runPreflightChecks(
  onUpdate?: CheckUpdateCallback,
  checks: CheckDefinition[] = DEFAULT_CHECKS,
  context: CheckContext = {},
): Promise<SystemReport> {
  const initialChecks: CheckResult[] = checks.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: 'pending',
  }));

  const report: SystemReport = {
    timestamp: new Date().toISOString(),
    allPassed: false,
    hasWarnings: false,
    hasErrors: false,
    checks: initialChecks,
  };

  for (let i = 0; i < checks.length; i++) {
    const checkDef = checks[i]!;

    report.checks[i] = {
      ...report.checks[i]!,
      status: 'running',
    };
    onUpdate?.(report, report.checks[i]!);

    const result = await checkDef.run(context);
    report.checks[i] = result;
    onUpdate?.(report, result);
  }

  report.hasErrors = report.checks.some((c) => c.status === 'error');
  report.hasWarnings = report.checks.some((c) => c.status === 'warning');
  report.allPassed = !report.hasErrors;

  return report;
}

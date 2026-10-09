import { delay } from '../utils/async.utils';
import { REMEDIATION_CHECKS } from './checks';
import { readReinsertions } from './checks/reinsertion.check';
import { CHECK_TIMEOUT_MS } from './doctor.constants';
import type {
  DoctorCheck,
  DoctorContext,
  DoctorCounts,
  DoctorReport,
  DoctorResult,
  FixDecision,
  FixOutcome,
  FixPlan,
} from './doctor.types';
import { applyFixes, buildFixPlan, unappliedOutcome } from './doctor-fix.service';

export interface FixSettings {
  confirm(plan: FixPlan): Promise<FixDecision>;
}

export interface RunDoctorOptions {
  ctx: DoctorContext;
  checks: readonly DoctorCheck[];
  fix?: FixSettings;
  onCheckStart?: (check: DoctorCheck) => void;
  onResult?: (result: DoctorResult) => void;
  onRemediation?: (message: string) => void;
  checkTimeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  settle?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const TIMED_OUT = Symbol('timed out');

export function summarize(results: readonly Pick<DoctorResult, 'status'>[]): DoctorCounts {
  const counts: DoctorCounts = { ok: 0, warning: 0, error: 0, skipped: 0 };
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

function sanitize(result: DoctorResult, redact: (text: string) => string): DoctorResult {
  return {
    ...result,
    message: redact(result.message),
    ...(result.details ? { details: result.details.map(redact) } : {}),
    ...(result.suggestion ? { suggestion: redact(result.suggestion) } : {}),
    ...(result.stuckItems
      ? {
          stuckItems: result.stuckItems.map((item) => ({
            ...item,
            title: redact(item.title),
            ...(item.message ? { message: redact(item.message) } : {}),
          })),
        }
      : {}),
  };
}

async function runCheck(check: DoctorCheck, options: RunDoctorOptions): Promise<DoctorResult> {
  const { ctx } = options;
  const timeoutMs = options.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  const sleep = options.sleep ?? delay;
  const timer = new AbortController();
  const identity = { id: check.id, name: check.name };

  try {
    const outcome = await Promise.race([
      check.run(ctx),
      sleep(timeoutMs, timer.signal).then((): typeof TIMED_OUT => TIMED_OUT),
    ]);
    return sanitize(
      outcome === TIMED_OUT
        ? {
            ...identity,
            status: 'error',
            message: `The check timed out after ${timeoutMs / 1000} s`,
          }
        : { ...identity, ...outcome },
      ctx.redact,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return sanitize(
      { ...identity, status: 'error', message: `The check failed unexpectedly: ${reason}` },
      ctx.redact,
    );
  } finally {
    timer.abort();
  }
}

async function runChecks(
  checks: readonly DoctorCheck[],
  options: RunDoctorOptions,
): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  for (const check of checks) {
    if (options.ctx.signal.aborted) {
      break;
    }
    options.onCheckStart?.(check);
    const result = await runCheck(check, options);
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}

async function countReinsertions(ctx: DoctorContext): Promise<number> {
  ctx.forget('decypharr-log');
  if (!ctx.provision.config.storage.enabled) {
    return 0;
  }
  const reading = await readReinsertions(ctx);
  return reading.readable ? reading.scan.count : 0;
}

async function remediate(
  results: DoctorResult[],
  options: RunDoctorOptions,
  fix: FixSettings,
): Promise<FixOutcome[]> {
  const { ctx } = options;
  const plan = buildFixPlan(results);
  if (!plan) {
    return [];
  }

  const reinsertionsBefore = await countReinsertions(ctx);
  const decision = await fix.confirm(plan);
  if (decision !== 'approved') {
    return [
      unappliedOutcome(
        plan,
        reinsertionsBefore,
        decision === 'unavailable'
          ? 'Confirmation is required: pass --yes to apply the fix without a terminal.'
          : 'The fix was declined.',
      ),
    ];
  }

  options.onRemediation?.('Removing the stuck downloads');
  const outcome = await applyFixes(plan, {
    clients: ctx.clients,
    reinsertionsBefore,
    settle: (ms) => (options.settle ?? delay)(ms, ctx.signal),
    countReinsertions: () => countReinsertions(ctx),
    redact: ctx.redact,
  });

  options.onRemediation?.('Checking the downloads again');
  const ids = new Set(REMEDIATION_CHECKS.map((check) => check.id));
  const rerun = await runChecks(
    options.checks.filter((check) => ids.has(check.id)),
    options,
  );
  for (const result of rerun) {
    const index = results.findIndex((previous) => previous.id === result.id);
    results[index] = result;
  }
  return [outcome];
}

export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReport> {
  const { ctx, fix } = options;
  const results = await runChecks(options.checks, options);
  const fixes = fix && !ctx.signal.aborted ? await remediate(results, options, fix) : [];

  const counts = summarize(results);
  return {
    timestamp: new Date(ctx.now()).toISOString(),
    version: ctx.provision.cliVersion,
    home: ctx.installation.layout.root,
    success:
      counts.error === 0 &&
      fixes.every(
        (outcome) => outcome.applied && outcome.loopStopped && outcome.failed.length === 0,
      ),
    counts,
    checks: results,
    fixes,
  };
}

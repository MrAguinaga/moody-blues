import { describe, expect, it } from 'vitest';

import type { CheckResult } from '../../checks';
import { createTestContext } from '../doctor-context.testing';
import { PREFLIGHT_CHECKS, toDoctorOutcome } from './preflight.check';

const base = { id: 'x', name: 'X', description: 'x' };

describe('toDoctorOutcome', () => {
  it('maps success to ok', () => {
    const result: CheckResult = { ...base, status: 'success', message: 'fine' };

    expect(toDoctorOutcome(result)).toEqual({ status: 'ok', message: 'fine' });
  });

  it('keeps the warning, the detail and the suggestion', () => {
    const result: CheckResult = {
      ...base,
      status: 'warning',
      message: 'careful',
      error: 'because',
      suggestion: 'do this',
    };

    expect(toDoctorOutcome(result)).toEqual({
      status: 'warning',
      message: 'careful',
      details: ['because'],
      suggestion: 'do this',
    });
  });

  it('maps error to error', () => {
    const result: CheckResult = { ...base, status: 'error', message: 'broken' };

    expect(toDoctorOutcome(result).status).toBe('error');
  });
});

describe('PREFLIGHT_CHECKS', () => {
  it('reuses the seven pre-flight checks in order, without the docker group check', () => {
    expect(PREFLIGHT_CHECKS.map((check) => check.id)).toEqual([
      'docker-daemon',
      'docker-compose',
      'ports-availability',
      'fuse',
      'transcoding',
      'dns',
      'disk-space',
    ]);
  });

  it('skips the FUSE check when the storage profile is off', async () => {
    const { ctx } = createTestContext({ storage: false });
    const fuse = PREFLIGHT_CHECKS.find((check) => check.id === 'fuse');

    const outcome = await fuse?.run(ctx);

    expect(outcome?.status).toBe('skipped');
  });
});

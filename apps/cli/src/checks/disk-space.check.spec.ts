import { describe, expect, it } from 'vitest';

import { evaluateDiskSpace } from './disk-space.check';

const GIB = 1024 ** 3;

describe('evaluateDiskSpace', () => {
  it.each([0, 1 * GIB, 3 * GIB - 1])('fails below 3 GiB (%d bytes)', (free) => {
    expect(evaluateDiskSpace(free, '/opt').status).toBe('error');
  });

  it.each([3 * GIB, 6 * GIB, 10 * GIB - 1])('warns between 3 and 10 GiB (%d bytes)', (free) => {
    expect(evaluateDiskSpace(free, '/opt').status).toBe('warning');
  });

  it.each([10 * GIB, 38 * GIB])('succeeds from 10 GiB (%d bytes)', (free) => {
    expect(evaluateDiskSpace(free, '/opt').status).toBe('success');
  });

  it('names the inspected path and the free space', () => {
    const result = evaluateDiskSpace(2.5 * GIB, '/opt/moody-blues');

    expect(result.message).toContain('2.5 GiB');
    expect(result.message).toContain('/opt/moody-blues');
  });
});

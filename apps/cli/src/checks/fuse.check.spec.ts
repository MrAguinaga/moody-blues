import { describe, expect, it } from 'vitest';

import { evaluateFuse, parsePropagation } from './fuse.check';

describe('parsePropagation', () => {
  it.each([
    ['shared', ['shared']],
    ['private,slave', ['private', 'slave']],
    ['shared,slave\n', ['shared', 'slave']],
    ['', []],
  ])('parses %j', (output, expected) => {
    expect(parsePropagation(output)).toEqual(expected);
  });
});

describe('evaluateFuse', () => {
  it('warns on macOS because FUSE is unsupported', () => {
    const result = evaluateFuse({ platform: 'darwin', hasFuseDevice: false });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('macOS');
    expect(result.message).toContain('storage profile will be disabled');
  });

  it('warns on Linux without /dev/fuse', () => {
    const result = evaluateFuse({ platform: 'linux', hasFuseDevice: false });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('/dev/fuse');
  });

  it.each(['private', 'slave', 'private,slave', undefined])(
    'warns when the propagation is %s and suggests rshared',
    (propagation) => {
      const result = evaluateFuse({ platform: 'linux', hasFuseDevice: true, propagation });

      expect(result.status).toBe('warning');
      expect(result.suggestion).toContain('sudo mount --make-rshared /');
    },
  );

  it.each(['shared', 'shared,slave'])('succeeds with %s propagation', (propagation) => {
    const result = evaluateFuse({ platform: 'linux', hasFuseDevice: true, propagation });

    expect(result.status).toBe('success');
  });
});

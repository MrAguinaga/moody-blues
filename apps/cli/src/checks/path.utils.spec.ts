import { describe, expect, it } from 'vitest';

import { findNearestExistingPath } from './path.utils';

describe('findNearestExistingPath', () => {
  it('returns the path itself when it exists', () => {
    expect(findNearestExistingPath('/opt/moody-blues/mnt', () => true)).toBe(
      '/opt/moody-blues/mnt',
    );
  });

  it('walks up to the closest existing ancestor', () => {
    const existing = new Set(['/', '/opt']);

    expect(findNearestExistingPath('/opt/moody-blues/mnt', (path) => existing.has(path))).toBe(
      '/opt',
    );
  });

  it('stops at the filesystem root when nothing exists', () => {
    expect(findNearestExistingPath('/a/b', () => false)).toBe('/');
  });
});

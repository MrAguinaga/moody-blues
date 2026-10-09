import { describe, expect, it } from 'vitest';

import { parseSizeBytes } from './size.preseed';

describe('parseSizeBytes', () => {
  it.each([
    ['10B', 10],
    ['1K', 1024],
    ['1Ki', 1024],
    ['1KiB', 1024],
    ['500M', 500 * 1024 ** 2],
    ['2G', 2 * 1024 ** 3],
    ['2g', 2 * 1024 ** 3],
    ['2GiB', 2 * 1024 ** 3],
    ['1.5G', 1.5 * 1024 ** 3],
    ['1T', 1024 ** 4],
  ])('parses %s', (input, expected) => {
    expect(parseSizeBytes(input)).toBe(expected);
  });

  it.each(['', 'G', '512', '2GB', '500MB', '1.5 G', '2 apples', '-1G', '1X'])(
    'rejects %j',
    (input) => {
      expect(() => parseSizeBytes(input)).toThrow(/Invalid size/);
    },
  );
});

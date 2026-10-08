import { describe, expect, it } from 'vitest';

import { parseSizeBytes } from './size.preseed';

describe('parseSizeBytes', () => {
  it.each([
    ['512', 512],
    ['10B', 10],
    ['1K', 1024],
    ['1KiB', 1024],
    ['500MB', 500 * 1024 ** 2],
    ['2GB', 2 * 1024 ** 3],
    ['2g', 2 * 1024 ** 3],
    ['1.5 GB', 1.5 * 1024 ** 3],
    ['1TB', 1024 ** 4],
  ])('parses %s', (input, expected) => {
    expect(parseSizeBytes(input)).toBe(expected);
  });

  it.each(['', 'GB', '2 apples', '-1GB', '1XB'])('rejects %j', (input) => {
    expect(() => parseSizeBytes(input)).toThrow(/Invalid size/);
  });
});

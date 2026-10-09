import { describe, expect, it } from 'vitest';

import { createDoctorCommand, parseStuckAfter } from './doctor.command';

describe('parseStuckAfter', () => {
  it.each(['1', '10', '1440', ' 30 '])('accepts %j', (value) => {
    expect(parseStuckAfter(value)).toBe(Number(value.trim()));
  });

  it.each(['0', '1441', '-5', '1.5', 'abc', '', '10m', '1e2'])('rejects %j', (value) => {
    expect(() => parseStuckAfter(value)).toThrow(/between 1 and 1440/);
  });
});

describe('createDoctorCommand', () => {
  it('declares the documented flags', () => {
    const flags = createDoctorCommand('0.0.0').options.map((option) => option.long);

    expect(flags).toEqual(['--fix', '--stuck-after', '--realdebrid', '--home']);
  });

  it('defaults the threshold to 10 minutes', () => {
    const option = createDoctorCommand('0.0.0').options.find((o) => o.long === '--stuck-after');

    expect(option?.defaultValue).toBe(10);
  });
});

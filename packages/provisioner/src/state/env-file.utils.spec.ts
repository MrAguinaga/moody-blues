import { describe, expect, it } from 'vitest';

import { parseEnvFile, serializeEnvFile } from './env-file.utils';

describe('parseEnvFile', () => {
  it('handles comments, export, quotes and blank lines', () => {
    const record = parseEnvFile(
      [
        '# comment',
        '',
        'A=1',
        'export B="two words"',
        "C='it''s'",
        'D=value # trailing',
        'E="line\\nbreak"',
        'F=',
      ].join('\n'),
    );
    expect(record).toMatchObject({
      A: '1',
      B: 'two words',
      D: 'value',
      E: 'line\nbreak',
      F: '',
    });
  });

  it('rejects malformed lines with the line number', () => {
    expect(() => parseEnvFile('A=1\nnot valid')).toThrow('line 2');
    expect(() => parseEnvFile('A="open')).toThrow('Unterminated');
  });
});

describe('serializeEnvFile', () => {
  it('orders known keys first, then unknown keys sorted', () => {
    const text = serializeEnvFile({
      ZED: '1',
      SONARR_API_KEY: 'k',
      MB_HOME: '/x',
      ALPHA: '2',
      PUID: '1',
    });
    expect(text).toBe('MB_HOME=/x\nPUID=1\nSONARR_API_KEY=k\nALPHA=2\nZED=1\n');
  });

  it('quotes only when needed', () => {
    expect(serializeEnvFile({ A: 'plain', B: 'has space', C: 'p$ss' })).toBe(
      "A=plain\nB='has space'\nC='p$ss'\n",
    );
  });

  it('round-trips awkward values', () => {
    const record = {
      MB_HOME: '/opt/moody-blues',
      ADMIN_PASSWORD: `p@ss w"or'd $x # \\ end`,
      RD_API_TOKEN: 'a\nb',
      OPENSUBTITLES_USERNAME: '',
      EXTRA: "it's",
    };
    expect(parseEnvFile(serializeEnvFile(record))).toEqual(record);
  });

  it('is deterministic', () => {
    const a = serializeEnvFile({ B: '1', A: '2' });
    const b = serializeEnvFile({ A: '2', B: '1' });
    expect(a).toBe(b);
  });
});

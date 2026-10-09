import { describe, expect, it } from 'vitest';

import { createLineSplitter } from './line-splitter.utils';

function collect() {
  const lines: string[] = [];
  return { lines, splitter: createLineSplitter((line) => lines.push(line)) };
}

describe('createLineSplitter', () => {
  it('emits one line per newline', () => {
    const { lines, splitter } = collect();

    splitter.push('first\nsecond\n');

    expect(lines).toEqual(['first', 'second']);
  });

  it('joins a line split between two chunks', () => {
    const { lines, splitter } = collect();

    splitter.push('par');
    splitter.push('tial\nrest');

    expect(lines).toEqual(['partial']);
  });

  it('emits the last line without a trailing newline on flush', () => {
    const { lines, splitter } = collect();

    splitter.push('one\ntwo');
    splitter.flush();
    splitter.flush();

    expect(lines).toEqual(['one', 'two']);
  });

  it('strips the carriage return of CRLF lines and keeps empty lines', () => {
    const { lines, splitter } = collect();

    splitter.push('a\r\n\nb\r\n');

    expect(lines).toEqual(['a', '', 'b']);
  });
});

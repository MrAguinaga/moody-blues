import { describe, expect, it } from 'vitest';

import { logsSuggestion } from './check-gate.utils';

describe('logsSuggestion', () => {
  it('points to the logs command of the CLI', () => {
    expect(logsSuggestion('radarr')).toBe('Inspect the container with "moody-blues logs radarr".');
  });
});

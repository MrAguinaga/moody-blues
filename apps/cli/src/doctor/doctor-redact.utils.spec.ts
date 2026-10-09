import { describe, expect, it } from 'vitest';

import { collectSecrets, redactSecrets } from './doctor-redact.utils';

describe('redactSecrets', () => {
  it('replaces every occurrence of a known secret', () => {
    expect(redactSecrets('key abc12345 and again abc12345', ['abc12345'])).toBe(
      'key *** and again ***',
    );
  });

  it('ignores secrets shorter than four characters', () => {
    expect(redactSecrets('a short ab value', ['ab'])).toBe('a short ab value');
  });

  it('hides the value of every JSON field named like a credential', () => {
    const body = JSON.stringify({
      apiKey: 'plain-value',
      token: 'another',
      clientSecret: 'x1',
      Password: 'pw',
      cookies: ['a', 'b'],
      name: 'visible',
    });

    const redacted = redactSecrets(body, []);

    expect(redacted).not.toMatch(/plain-value|another|x1|pw|"a"|"b"/);
    expect(redacted).toContain('"name":"visible"');
    expect(redacted).toContain('"cookies":"***"');
  });

  it('hides bearer credentials and quoted tokens', () => {
    const redacted = redactSecrets(
      'sent Authorization: Bearer s3cr3tvalue and MediaBrowser Client="x", Token="jellyfinkey"',
      [],
    );

    expect(redacted).not.toContain('s3cr3tvalue');
    expect(redacted).not.toContain('jellyfinkey');
    expect(redacted).toContain('Client="x"');
  });

  it('prefers the longest secret when one contains another', () => {
    expect(redactSecrets('value abcdef', collectSecrets(['abcd', 'abcdef']))).toBe('value ***');
  });
});

describe('collectSecrets', () => {
  it('drops missing and short values and removes duplicates', () => {
    expect(collectSecrets([undefined, 'abc', 'secret1', 'secret1', ''])).toEqual(['secret1']);
  });
});

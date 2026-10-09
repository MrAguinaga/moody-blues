import { describe, expect, it } from 'vitest';

import { collectSecretValues, maskSecrets, normalizeSecrets } from './redact.utils';

describe('maskSecrets', () => {
  it('replaces every occurrence of every secret', () => {
    expect(
      maskSecrets('a=secret-one b=secret-two c=secret-one', ['secret-one', 'secret-two']),
    ).toBe('a=*** b=*** c=***');
  });

  it('ignores secrets shorter than four characters', () => {
    expect(maskSecrets('value ab here', ['ab'])).toBe('value ab here');
  });

  it('leaves the text alone without secrets', () => {
    expect(maskSecrets('nothing to hide', [])).toBe('nothing to hide');
  });
});

describe('normalizeSecrets', () => {
  it('drops missing and short values, removes duplicates and sorts the longest first', () => {
    expect(normalizeSecrets([undefined, 'abc', 'abcd', 'abcdef', 'abcd', ''])).toEqual([
      'abcdef',
      'abcd',
    ]);
  });
});

describe('collectSecretValues', () => {
  it('reads the user secrets, the generated keys and the issued keys', () => {
    const secrets = collectSecretValues({
      RD_API_TOKEN: 'rd-token-value',
      ADMIN_PASSWORD: 'admin-password-value',
      SONARR_API_KEY: 'sonarr-key-value',
      JELLYFIN_API_KEY: 'jellyfin-key-value',
      MB_HOME: '/opt/moody-blues',
      PUID: '1000',
    });

    expect(secrets).toEqual(
      expect.arrayContaining([
        'rd-token-value',
        'admin-password-value',
        'sonarr-key-value',
        'jellyfin-key-value',
      ]),
    );
    expect(secrets).not.toContain('/opt/moody-blues');
    expect(secrets).not.toContain('1000');
  });

  it('skips keys that are absent from the environment', () => {
    expect(collectSecretValues({})).toEqual([]);
  });
});

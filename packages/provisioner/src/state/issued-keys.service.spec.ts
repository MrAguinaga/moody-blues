import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serializeEnvFile } from './env-file.utils';
import { ENV_KEY_ORDER, ISSUED_KEY_ENV_KEYS } from './env-keys.constants';
import { persistIssuedKey, readIssuedKey } from './issued-keys.service';

describe('issued keys', () => {
  let sandbox: string;
  let envFile: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-issued-keys-'));
    envFile = join(sandbox, '.env');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('lists the keys a service issues and orders them after the generated ones', () => {
    expect(ISSUED_KEY_ENV_KEYS).toEqual(['JELLYFIN_API_KEY']);
    expect(ENV_KEY_ORDER.at(-1)).toBe('JELLYFIN_API_KEY');
    expect(ENV_KEY_ORDER.indexOf('JELLYFIN_API_KEY')).toBeGreaterThan(
      ENV_KEY_ORDER.indexOf('SEERR_API_KEY'),
    );
  });

  it('serializes the issued key at its fixed position, before unknown keys', () => {
    const text = serializeEnvFile({ ZZ_OTHER: '1', JELLYFIN_API_KEY: 'abc', SEERR_API_KEY: 'def' });

    expect(text).toBe('SEERR_API_KEY=def\nJELLYFIN_API_KEY=abc\nZZ_OTHER=1\n');
  });

  it('reads nothing when the file or the key is missing', () => {
    expect(readIssuedKey(envFile, 'JELLYFIN_API_KEY')).toBeUndefined();

    writeFileSync(envFile, 'JELLYFIN_API_KEY=\nOTHER=1\n');

    expect(readIssuedKey(envFile, 'JELLYFIN_API_KEY')).toBeUndefined();
  });

  it('persists a key with private permissions and reads it back', () => {
    expect(persistIssuedKey(envFile, 'JELLYFIN_API_KEY', 'key-value')).toBe(true);

    expect(readIssuedKey(envFile, 'JELLYFIN_API_KEY')).toBe('key-value');
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it('keeps every other entry of the file', () => {
    writeFileSync(envFile, 'MB_HOME=/srv/mb\nCUSTOM=1\n');

    persistIssuedKey(envFile, 'JELLYFIN_API_KEY', 'key-value');

    expect(readFileSync(envFile, 'utf8')).toBe(
      'MB_HOME=/srv/mb\nJELLYFIN_API_KEY=key-value\nCUSTOM=1\n',
    );
  });

  it('does not write when the value is the same', () => {
    writeFileSync(envFile, 'JELLYFIN_API_KEY=key-value\n', { mode: 0o644 });
    const modified = statSync(envFile).mtimeMs;

    expect(persistIssuedKey(envFile, 'JELLYFIN_API_KEY', 'key-value')).toBe(false);

    expect(statSync(envFile).mtimeMs).toBe(modified);
    expect(statSync(envFile).mode & 0o777).toBe(0o644);
  });

  it('replaces a different value', () => {
    persistIssuedKey(envFile, 'JELLYFIN_API_KEY', 'old');

    expect(persistIssuedKey(envFile, 'JELLYFIN_API_KEY', 'new')).toBe(true);
    expect(readIssuedKey(envFile, 'JELLYFIN_API_KEY')).toBe('new');
  });
});

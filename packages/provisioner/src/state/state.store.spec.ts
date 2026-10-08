import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '../config/config.defaults';
import { readEnv, writeEnv } from './env-store.service';
import { readState, writeState } from './state.store';

describe('state and env stores', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-state-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('round-trips the state with 0600 permissions and no temp leftovers', () => {
    const file = join(sandbox, 'moody-blues.json');
    const config = createDefaultConfig({ host: { puid: 1000, pgid: 1000 } });

    writeState(file, config);
    writeState(file, config);

    expect(readState(file)).toEqual(config);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(sandbox)).toEqual(['moody-blues.json']);
  });

  it('returns undefined when the state does not exist', () => {
    expect(readState(join(sandbox, 'missing.json'))).toBeUndefined();
  });

  it('fails on invalid JSON or invalid schema', () => {
    const file = join(sandbox, 'moody-blues.json');
    writeFileSync(file, '{nope');
    expect(() => readState(file)).toThrow('not valid JSON');
    writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => readState(file)).toThrow('invalid');
  });

  it('refuses to write an invalid state', () => {
    const config = { ...createDefaultConfig(), schemaVersion: 2 as never };
    expect(() => writeState(join(sandbox, 's.json'), config)).toThrow('invalid state');
  });

  it('writes the env file atomically with 0600 and reads it back', () => {
    const file = join(sandbox, '.env');
    const record = { MB_HOME: '/x', ADMIN_PASSWORD: 'p w' };

    writeEnv(file, record);
    const before = readEnv(file);
    writeEnv(file, before);

    expect(before).toEqual(record);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readEnv(join(sandbox, 'none.env'))).toEqual({});
  });

  it('applies ownership when requested as root', () => {
    const chown = vi.fn();
    writeEnv(
      join(sandbox, '.env'),
      { A: '1' },
      {
        identity: { puid: 7, pgid: 8 },
        runAsRoot: true,
        chown,
      },
    );
    expect(chown).toHaveBeenCalledWith(expect.any(String), 7, 8);
  });
});

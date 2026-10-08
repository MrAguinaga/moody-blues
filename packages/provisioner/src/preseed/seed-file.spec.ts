import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSeedFile, SeedConflictError } from './seed-file';

const expectedKey = {
  label: 'ApiKey',
  value: 'key-a',
  read: (content: string) => /key=(\S+)/.exec(content)?.[1],
};

describe('ensureSeedFile', () => {
  let sandbox: string;
  let target: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-seed-'));
    target = join(sandbox, 'nested', 'dir', 'file.conf');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('creates the file and its parent directories with mode 0600', () => {
    const outcome = ensureSeedFile(target, 'key=key-a\n', { expectedKey });

    expect(outcome).toEqual({ status: 'created', path: target });
    expect(readFileSync(target, 'utf8')).toBe('key=key-a\n');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('applies ownership to the file and to the directories it creates', () => {
    const chown = vi.fn();

    ensureSeedFile(target, 'key=key-a\n', {
      expectedKey,
      ownership: { identity: { puid: 1234, pgid: 5678 }, runAsRoot: true, chown },
    });

    const chowned = chown.mock.calls.map(([path]) => path);
    expect(chowned).toEqual(
      expect.arrayContaining([join(sandbox, 'nested'), join(sandbox, 'nested', 'dir')]),
    );
    expect(chowned.some((path) => String(path).includes('file.conf'))).toBe(true);
    expect(chown.mock.calls.every(([, uid, gid]) => uid === 1234 && gid === 5678)).toBe(true);
  });

  it('does not overwrite an existing file with the same key', () => {
    ensureSeedFile(target, 'key=key-a\n', { expectedKey });
    writeFileSync(target, 'key=key-a\nextra=1\n');

    const outcome = ensureSeedFile(target, 'key=key-a\n', { expectedKey });

    expect(outcome.status).toBe('unchanged');
    expect(readFileSync(target, 'utf8')).toBe('key=key-a\nextra=1\n');
  });

  it('throws a conflict suggesting reset --fresh when the key differs', () => {
    ensureSeedFile(target, 'key=other\n', { expectedKey });

    const attempt = () => ensureSeedFile(target, 'key=key-a\n', { expectedKey });

    expect(attempt).toThrow(SeedConflictError);
    expect(attempt).toThrow(/reset --fresh/);
    expect(readFileSync(target, 'utf8')).toBe('key=other\n');
  });

  it('treats an unreadable key as a conflict', () => {
    ensureSeedFile(target, 'garbage', { expectedKey });

    expect(() => ensureSeedFile(target, 'key=key-a\n', { expectedKey })).toThrow(SeedConflictError);
  });
});

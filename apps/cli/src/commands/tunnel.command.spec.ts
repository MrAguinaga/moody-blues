import { spawn } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTunnelCommand, executeTunnel } from './tunnel.command';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((message: string) => {
    errors.push(message);
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubEnv('MB_SSH_TARGET', '');
});

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createTunnelCommand', () => {
  it('takes an optional target and no options of its own', () => {
    const command = createTunnelCommand('0.0.0');

    expect(
      command.registeredArguments.map((argument) => [argument.name(), argument.required]),
    ).toEqual([['target', false]]);
    expect(command.options).toEqual([]);
  });
});

describe('executeTunnel', () => {
  it('exits with 1 and a usage message without a target', async () => {
    await executeTunnel({ mode: 'headless', version: '0.0.0' });

    expect(errors).toEqual(['✖ Missing SSH target. Pass it as an argument or set MB_SSH_TARGET.']);
    expect(process.exitCode).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['-oProxyCommand=x', 'a b', 'host;reboot'])(
    'exits with 1 without launching ssh for the target %j',
    async (target) => {
      await executeTunnel({ target, mode: 'headless', version: '0.0.0' });

      expect(errors).toEqual([`✖ Invalid SSH target "${target}".`]);
      expect(process.exitCode).toBe(1);
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});

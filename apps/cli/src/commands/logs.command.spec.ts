import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultConfig,
  createLayout,
  ISSUED_KEY_ENV_KEYS,
  SERVICE_KEY_ENV_KEYS,
  USER_SECRET_ENV_KEYS,
} from '@moody-blues/provisioner';

import { createComposeRunner } from '../docker';
import {
  createLogsCommand,
  executeLogs,
  type LogsDeps,
  type LogsSettings,
  type LogsStack,
  parseSince,
  parseTail,
} from './logs.command';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

const SERVICES = ['bazarr', 'caddy', 'flaresolverr', 'jellyfin', 'prowlarr', 'radarr', 'sonarr'];

const settings = (patch: Partial<LogsSettings> = {}): LogsSettings => ({
  service: 'radarr',
  follow: false,
  tail: 100,
  timestamps: false,
  json: false,
  ...patch,
});

function fakeDeps(stack: Partial<LogsStack> = {}, lines: string[] = []) {
  const written: string[] = [];
  let outputError: ((error: NodeJS.ErrnoException) => void) | undefined;
  const logs = vi.fn(
    async (_service: string, options: Parameters<LogsStack['runner']['logs']>[1]) => {
      lines.forEach((line) => options.onLine(line));
    },
  );
  const deps: LogsDeps = {
    openStack: () => ({
      runner: { listServices: async () => SERVICES, logs },
      storageEnabled: false,
      ...stack,
    }),
    write: (text) => written.push(text),
    onOutputError: (listener) => {
      outputError = listener;
    },
  };
  return {
    deps,
    written,
    logs,
    emitOutputError: (error: NodeJS.ErrnoException) => outputError?.(error),
  };
}

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((message: string) => {
    errors.push(message);
  });
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('parseTail', () => {
  it.each(['0', '100', '5000', ' 20 '])('accepts %j', (value) => {
    expect(parseTail(value)).toBe(Number(value.trim()));
  });

  it.each(['5001', '-1', '1.5', 'abc', '', '1e2', '10 lines'])('rejects %j', (value) => {
    expect(() => parseTail(value)).toThrow(/between 0 and 5000/);
  });
});

describe('parseSince', () => {
  it.each(['30s', '30m', '2h', '1d', '0m'])('accepts %j', (value) => {
    expect(parseSince(value)).toBe(value);
  });

  it.each(['30', 'm', '2w', '1.5h', '-5m', '10m5s', 'abc', ''])('rejects %j', (value) => {
    expect(() => parseSince(value)).toThrow(/followed by s, m, h or d/);
  });
});

describe('createLogsCommand', () => {
  it('declares the documented flags and the service argument', () => {
    const command = createLogsCommand();

    expect(command.options.map((option) => option.long)).toEqual([
      '--follow',
      '--tail',
      '--since',
      '--timestamps',
      '--home',
    ]);
    expect(command.registeredArguments.map((argument) => argument.name())).toEqual(['service']);
  });

  it('defaults to the last 100 lines', () => {
    const option = createLogsCommand().options.find((o) => o.long === '--tail');

    expect(option?.defaultValue).toBe(100);
  });
});

describe('executeLogs', () => {
  it('prints each line of the service and leaves a zero exit code', async () => {
    const { deps, written, logs } = fakeDeps({}, ['one', 'two']);

    await executeLogs(settings({ tail: 50, since: '5m', timestamps: true }), deps);

    expect(written).toEqual(['one\n', 'two\n']);
    expect(logs).toHaveBeenCalledWith(
      'radarr',
      expect.objectContaining({ follow: false, tail: 50, since: '5m', timestamps: true }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints one JSON object per line with --json', async () => {
    const { deps, written } = fakeDeps({}, ['plain text', 'with "quotes" and \\ backslash']);

    await executeLogs(settings({ json: true }), deps);

    const parsed = written.map((text) => JSON.parse(text) as unknown);
    expect(parsed).toEqual([
      { service: 'radarr', line: 'plain text' },
      { service: 'radarr', line: 'with "quotes" and \\ backslash' },
    ]);
    expect(written.every((text) => text.endsWith('\n') && !text.slice(0, -1).includes('\n'))).toBe(
      true,
    );
  });

  it('lists the available services for an unknown one and exits with 1', async () => {
    const { deps, written, logs } = fakeDeps();

    await executeLogs(settings({ service: 'nada' }), deps);

    expect(errors).toEqual([`✖ Unknown service "nada". Available: ${SERVICES.join(', ')}.`]);
    expect(process.exitCode).toBe(1);
    expect(written).toEqual([]);
    expect(logs).not.toHaveBeenCalled();
  });

  it('explains that Decypharr needs the storage profile', async () => {
    const { deps } = fakeDeps({ storageEnabled: false });

    await executeLogs(settings({ service: 'decypharr' }), deps);

    expect(errors[0]).toContain('Unknown service "decypharr".');
    expect(errors[0]).toContain('Decypharr only runs when storage is enabled.');
    expect(process.exitCode).toBe(1);
  });

  it('accepts Decypharr when Compose lists it', async () => {
    const { deps, logs } = fakeDeps({
      storageEnabled: true,
      runner: {
        listServices: async () => [...SERVICES, 'decypharr'],
        logs: vi.fn(async () => undefined),
      },
    });

    await executeLogs(settings({ service: 'decypharr' }), deps);

    expect(errors).toEqual([]);
    expect(logs).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a Compose failure with exit code 1', async () => {
    const { deps } = fakeDeps({
      runner: {
        listServices: async () => SERVICES,
        logs: async () => {
          throw new Error('docker compose logs failed (exit code 1): boom');
        },
      },
    });

    await executeLogs(settings(), deps);

    expect(errors).toEqual(['✖ docker compose logs failed (exit code 1): boom']);
    expect(process.exitCode).toBe(1);
  });

  it('reports a missing installation with exit code 1', async () => {
    const { deps } = fakeDeps();
    deps.openStack = () => {
      throw new Error('Moody Blues is not set up yet. Run "moody-blues setup" first.');
    };

    await executeLogs(settings(), deps);

    expect(errors[0]).toContain('not set up yet');
    expect(process.exitCode).toBe(1);
  });

  it('ends quietly when the output closes (EPIPE)', async () => {
    const controller = new AbortController();
    const { deps, written, emitOutputError } = fakeDeps();
    deps.openStack = () => ({
      storageEnabled: false,
      runner: {
        listServices: async () => SERVICES,
        logs: async (_service, options) => {
          options.onLine('first');
          emitOutputError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
          options.onLine('second');
        },
      },
    });

    await executeLogs(settings(), deps, controller);

    expect(written).toEqual(['first\n']);
    expect(controller.signal.aborted).toBe(true);
    expect(errors).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('ends without error when the interrupt aborts a followed stream', async () => {
    const controller = new AbortController();
    const { deps, written } = fakeDeps();
    deps.openStack = () => ({
      storageEnabled: false,
      runner: {
        listServices: async () => SERVICES,
        logs: async (_service, options) => {
          options.onLine('live');
          controller.abort();
          throw new Error('stream interrupted');
        },
      },
    });

    await executeLogs(settings({ follow: true }), deps, controller);

    expect(written).toEqual(['live\n']);
    expect(errors).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});

describe('executeLogs secret masking', () => {
  const ENV: Record<string, string> = {};
  [...USER_SECRET_ENV_KEYS, ...SERVICE_KEY_ENV_KEYS, ...ISSUED_KEY_ENV_KEYS].forEach(
    (key, index) => {
      ENV[key] = `value-of-${key.toLowerCase()}-${index}-0123456789`;
    },
  );

  function fakeCompose(logText: string): void {
    vi.mocked(spawn).mockImplementation(((_file: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      queueMicrotask(() => {
        child.stdout.write(args.includes('logs') ? logText : 'radarr\n');
        child.emit('close', 0);
      });
      return child;
    }) as unknown as typeof spawn);
  }

  it.each([false, true])('prints none of the .env secrets (json: %s)', async (json) => {
    const noisy = Object.values(ENV).map(
      (value, index) => `GET /api/v3/system/status?apikey=${value} request ${index}`,
    );
    fakeCompose(`${noisy.join('\n')}\n`);
    const written: string[] = [];
    const deps: LogsDeps = {
      openStack: () => ({
        runner: createComposeRunner(
          {
            layout: createLayout('/opt/mb'),
            config: createDefaultConfig({ host: { puid: 1000, pgid: 1000 } }),
            env: ENV,
          },
          { composeDir: new URL('../../../../compose', import.meta.url).pathname },
        ),
        storageEnabled: false,
      }),
      write: (text) => written.push(text),
      onOutputError: () => undefined,
    };

    await executeLogs(settings({ json }), deps);

    const output = written.join('');
    expect(errors).toEqual([]);
    expect(written).toHaveLength(noisy.length);
    expect(output).toContain('request 0');
    expect(output).toContain('apikey=***');
    for (const value of Object.values(ENV)) {
      expect(output).not.toContain(value);
    }
  });
});

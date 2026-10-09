import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig, createLayout } from '@moody-blues/provisioner';

import type { Installation } from '../installation';
import { ComposeCommandError, createComposeRunner } from './compose.runner';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const ISSUED_KEY = 'jellyfin-issued-key-0123456789';

function installation(env: Record<string, string>): Installation {
  return {
    layout: createLayout('/opt/mb'),
    config: createDefaultConfig({ host: { puid: 1000, pgid: 1000 } }),
    env,
  };
}

function failWith(stderr: string): void {
  vi.mocked(spawn).mockImplementation((() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    queueMicrotask(() => {
      child.stderr.write(stderr);
      child.emit('close', 1);
    });
    return child;
  }) as unknown as typeof spawn);
}

async function stderrOf(env: Record<string, string>): Promise<string> {
  const runner = createComposeRunner(installation(env), {
    composeDir: new URL('../../../../compose', import.meta.url).pathname,
  });
  try {
    await runner.up({});
  } catch (error) {
    return (error as ComposeCommandError).stderr;
  }
  throw new Error('Expected the compose command to fail');
}

describe('createComposeRunner stderr redaction', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('masks the API key issued by Jellyfin', async () => {
    failWith(`pull failed for token ${ISSUED_KEY} while contacting the registry`);

    const stderr = await stderrOf({ JELLYFIN_API_KEY: ISSUED_KEY });

    expect(stderr).toBe('pull failed for token *** while contacting the registry');
  });

  it('keeps masking the user secrets and the generated service keys', async () => {
    failWith('RD_API_TOKEN=rd-secret-value SONARR_API_KEY=sonarr-secret-value');

    const stderr = await stderrOf({
      RD_API_TOKEN: 'rd-secret-value',
      SONARR_API_KEY: 'sonarr-secret-value',
    });

    expect(stderr).toBe('RD_API_TOKEN=*** SONARR_API_KEY=***');
  });
});

const COMPOSE_DIR = new URL('../../../../compose', import.meta.url).pathname;
const LOG_KEY = 'radarr-logged-key-0123456789';

interface FakeLogProcess {
  stdout: PassThrough;
  stderr: PassThrough;
  emitter: EventEmitter;
}

function streamLogs(): FakeLogProcess {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  vi.mocked(spawn).mockImplementation(((_file: string, _args: string[], options?: object) => {
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
    signal?.addEventListener('abort', () => {
      emitter.emit('error', Object.assign(new Error('aborted'), { name: 'AbortError' }));
      emitter.emit('close', null);
    });
    return Object.assign(emitter, { stdout, stderr });
  }) as unknown as typeof spawn);
  return { stdout, stderr, emitter };
}

function logsRunner(env: Record<string, string> = {}) {
  return createComposeRunner(installation(env), { composeDir: COMPOSE_DIR });
}

function spawnedArgs(): string[] {
  const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
  return args.slice(args.indexOf('logs'));
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('createComposeRunner logs', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('asks for a plain dump without follow by default', async () => {
    const process = streamLogs();
    const lines: string[] = [];

    const done = logsRunner().logs('radarr', { tail: 50, onLine: (line) => lines.push(line) });
    process.stdout.write('one\ntwo\n');
    process.emitter.emit('close', 0);
    await done;

    expect(spawnedArgs()).toEqual([
      'logs',
      '--no-color',
      '--no-log-prefix',
      '--tail',
      '50',
      'radarr',
    ]);
    expect(lines).toEqual(['one', 'two']);
  });

  it('passes since, timestamps and follow in the documented order', async () => {
    const process = streamLogs();

    const done = logsRunner().logs('caddy', {
      tail: 0,
      since: '10m',
      timestamps: true,
      follow: true,
      onLine: () => undefined,
    });
    process.emitter.emit('close', 0);
    await done;

    expect(spawnedArgs()).toEqual([
      'logs',
      '--no-color',
      '--no-log-prefix',
      '--tail',
      '0',
      '--since',
      '10m',
      '--timestamps',
      '--follow',
      'caddy',
    ]);
  });

  it('masks a secret split between two reads of the stream', async () => {
    const process = streamLogs();
    const lines: string[] = [];

    const done = logsRunner({ SONARR_API_KEY: LOG_KEY }).logs('radarr', {
      onLine: (line) => lines.push(line),
    });
    process.stdout.write(`GET /api?apikey=${LOG_KEY.slice(0, 10)}`);
    await tick();
    process.stdout.write(`${LOG_KEY.slice(10)} 200\nnext line\n`);
    process.emitter.emit('close', 0);
    await done;

    expect(lines).toEqual(['GET /api?apikey=*** 200', 'next line']);
  });

  it('emits the last line even without a trailing newline', async () => {
    const process = streamLogs();
    const lines: string[] = [];

    const done = logsRunner().logs('radarr', { onLine: (line) => lines.push(line) });
    process.stdout.write('first\nlast without newline');
    process.emitter.emit('close', 0);
    await done;

    expect(lines).toEqual(['first', 'last without newline']);
  });

  it('fails with the masked stderr of Compose', async () => {
    const process = streamLogs();

    const done = logsRunner({ RD_API_TOKEN: 'rd-secret-value' }).logs('radarr', {
      onLine: () => undefined,
    });
    process.stderr.write('no such service while using rd-secret-value');
    process.emitter.emit('close', 1);

    await expect(done).rejects.toMatchObject({
      name: 'ComposeCommandError',
      exitCode: 1,
      stderr: 'no such service while using ***',
    });
  });

  it('ends without error when the signal aborts a followed stream', async () => {
    const process = streamLogs();
    const controller = new AbortController();
    const lines: string[] = [];

    const done = logsRunner().logs('radarr', {
      follow: true,
      signal: controller.signal,
      onLine: (line) => lines.push(line),
    });
    process.stdout.write('before abort\npartial');
    await tick();
    controller.abort();

    await expect(done).resolves.toBeUndefined();
    expect(lines).toEqual(['before abort', 'partial']);
  });

  it('treats an interrupt of a followed stream as a normal end', async () => {
    const process = streamLogs();

    const done = logsRunner().logs('radarr', { follow: true, onLine: () => undefined });
    process.emitter.emit('close', 130);

    await expect(done).resolves.toBeUndefined();
  });

  it('fails when the docker executable is missing', async () => {
    const process = streamLogs();

    const done = logsRunner().logs('radarr', { onLine: () => undefined });
    process.emitter.emit('error', Object.assign(new Error('spawn docker'), { code: 'ENOENT' }));

    await expect(done).rejects.toThrow('the docker executable was not found in PATH');
  });
});

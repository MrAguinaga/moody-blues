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

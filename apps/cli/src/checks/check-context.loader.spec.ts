import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDefaultConfig,
  createLayout,
  type MbHomeLayout,
  writeState,
} from '@moody-blues/provisioner';

import { loadCheckContext } from './check-context.loader';

describe('loadCheckContext', () => {
  let sandbox: string;
  let layout: MbHomeLayout;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-check-context-'));
    layout = createLayout(join(sandbox, 'home'));
    mkdirSync(dirname(layout.stateFile), { recursive: true });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('returns only the home before the first setup', () => {
    expect(loadCheckContext(layout.root)).toEqual({ home: layout.root });
  });

  it('brings the saved mode, domain and transcoding mode', () => {
    const config = {
      ...createDefaultConfig({ host: { puid: 1000, pgid: 1000 }, domain: 'example.org' }),
      mode: 'remote' as const,
      transcoding: 'hardware' as const,
    };
    writeState(layout.stateFile, config);

    expect(loadCheckContext(layout.root)).toEqual({
      mode: 'remote',
      domain: 'example.org',
      transcoding: 'hardware',
      home: layout.root,
    });
  });

  it('falls back to the home when the state is unreadable', () => {
    writeFileSync(layout.stateFile, '{not json');

    expect(loadCheckContext(layout.root)).toEqual({ home: layout.root });
  });
});

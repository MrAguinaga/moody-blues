import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig, createLayout, writeEnv, writeState } from '@moody-blues/provisioner';

import { loadInstallation } from './installation.loader';

describe('loadInstallation', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mb-installation-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('fails with guidance when setup has not run', () => {
    expect(() => loadInstallation({ home })).toThrow(
      'Moody Blues is not set up yet. Run "moody-blues setup" first.',
    );
  });

  it('fails when the environment file is missing', () => {
    const layout = createLayout(home);
    writeState(layout.stateFile, createDefaultConfig({ host: { puid: 1000, pgid: 1000 } }));

    expect(() => loadInstallation({ home })).toThrow(/missing or incomplete/);
  });

  it('loads the layout, configuration and environment', () => {
    const layout = createLayout(home);
    const config = createDefaultConfig({ host: { puid: 1000, pgid: 1000 } });
    writeState(layout.stateFile, config);
    writeEnv(layout.envFile, { MB_HOME: home, PUID: '1000' });

    const installation = loadInstallation({ home });

    expect(installation.layout.root).toBe(home);
    expect(installation.config).toEqual(config);
    expect(installation.env).toEqual({ MB_HOME: home, PUID: '1000' });
  });
});

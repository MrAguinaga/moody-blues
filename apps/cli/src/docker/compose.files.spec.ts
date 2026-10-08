import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildComposeFiles, resolveComposeDir } from './compose.files';

describe('resolveComposeDir', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mb-compose-dir-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function createComposeDir(parent: string): string {
    const dir = join(parent, 'compose');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'compose.yaml'), 'name: moody-blues\n');
    return dir;
  }

  it('prefers MB_COMPOSE_DIR', () => {
    const custom = createComposeDir(join(root, 'custom'));

    expect(resolveComposeDir({ env: { MB_COMPOSE_DIR: custom }, startDir: root })).toBe(custom);
  });

  it('fails when MB_COMPOSE_DIR has no compose.yaml', () => {
    expect(() => resolveComposeDir({ env: { MB_COMPOSE_DIR: root } })).toThrow(
      /does not contain compose\.yaml/,
    );
  });

  it('walks up from the start directory until it finds compose/compose.yaml', () => {
    const compose = createComposeDir(root);
    const nested = join(root, 'apps', 'cli', 'dist');
    mkdirSync(nested, { recursive: true });

    expect(resolveComposeDir({ env: {}, startDir: nested })).toBe(compose);
  });

  it('fails with guidance when nothing is found', () => {
    expect(() => resolveComposeDir({ env: {}, startDir: root })).toThrow(/MB_COMPOSE_DIR/);
  });

  it('finds the manifests of this repository from the module location', () => {
    expect(resolveComposeDir({ env: {} })).toMatch(/compose$/);
  });
});

describe('buildComposeFiles', () => {
  it('uses only compose.yaml without hardware acceleration', () => {
    expect(buildComposeFiles('/srv/compose')).toEqual(['/srv/compose/compose.yaml']);
  });

  it('adds the VAAPI override', () => {
    expect(buildComposeFiles('/srv/compose', { kind: 'vaapi', renderGid: 105 })).toEqual([
      '/srv/compose/compose.yaml',
      '/srv/compose/overrides/jellyfin-vaapi.yaml',
    ]);
  });

  it('adds the NVIDIA override', () => {
    expect(buildComposeFiles('/srv/compose', { kind: 'nvidia' })).toEqual([
      '/srv/compose/compose.yaml',
      '/srv/compose/overrides/jellyfin-nvidia.yaml',
    ]);
  });
});

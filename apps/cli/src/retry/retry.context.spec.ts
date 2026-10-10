import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listPackFiles, toHostPath } from './retry.context';

describe('toHostPath', () => {
  it('maps a path of the containers onto the data directory of the host', () => {
    expect(toHostPath('/srv/mb/data', '/data/downloads/sonarr/Show')).toBe(
      '/srv/mb/data/downloads/sonarr/Show',
    );
    expect(toHostPath('/srv/mb/data', '/data')).toBe('/srv/mb/data');
  });

  it.each(['/mnt/debrid/x', '/database/x', 'data/x', '/dat'])('rejects %s', (path) => {
    expect(() => toHostPath('/srv/mb/data', path)).toThrow(/outside \/data/);
  });
});

describe('listPackFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'retry-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists files and symlinks, also inside subfolders, as container paths', async () => {
    mkdirSync(join(root, 'Season 1'));
    writeFileSync(join(root, 'Season 1', 'Show - 02.mkv'), '');
    symlinkSync('/nonexistent/target.mkv', join(root, 'Show - 01.mkv'));
    writeFileSync(join(root, 'cover.jpg'), '');

    const files = await listPackFiles(root, '/data/downloads/sonarr/Show');

    expect(files.sort()).toEqual([
      '/data/downloads/sonarr/Show/Season 1/Show - 02.mkv',
      '/data/downloads/sonarr/Show/Show - 01.mkv',
      '/data/downloads/sonarr/Show/cover.jpg',
    ]);
  });

  it('fails when the folder does not exist', async () => {
    await expect(listPackFiles(join(root, 'missing'), '/data/x')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

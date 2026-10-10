import { describe, expect, it } from 'vitest';

import { findCodeDir } from './update.code-dir';

describe('findCodeDir', () => {
  const exists = (present: string[]) => (path: string) => present.includes(path);

  it('finds the git checkout above the module', () => {
    const dir = findCodeDir({
      startDir: '/usr/local/lib/moody-blues/apps/cli/dist',
      exists: exists([
        '/usr/local/lib/moody-blues/.git',
        '/usr/local/lib/moody-blues/pnpm-workspace.yaml',
      ]),
    });

    expect(dir).toBe('/usr/local/lib/moody-blues');
  });

  it('requires both the git metadata and the workspace file', () => {
    expect(() =>
      findCodeDir({ startDir: '/opt/app/dist', exists: exists(['/opt/app/.git']) }),
    ).toThrow('not a git checkout');
  });

  it('explains how installations are supported when nothing is found', () => {
    expect(() => findCodeDir({ startDir: '/srv/x/y', exists: () => false })).toThrow('install.sh');
  });
});

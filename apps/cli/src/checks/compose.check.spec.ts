import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../utils/system.utils';
import { composeCheck } from './compose.check';

vi.mock('../utils/system.utils', () => ({ runCommand: vi.fn() }));

function mockComposeVersion(stdout: string, exitCode = 0): void {
  vi.mocked(runCommand).mockResolvedValue({ stdout, stderr: '', exitCode });
}

describe('composeCheck', () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockReset();
  });

  it.each(['2.20.2', 'v2.29.1-desktop.1', '5.1.0', '2.21'])('accepts %s', async (version) => {
    mockComposeVersion(version);

    const result = await composeCheck.run();

    expect(result.status).toBe('success');
  });

  it.each(['2.20.1', '2.19.9', '1.29.2', '2.0.0'])('rejects %s', async (version) => {
    mockComposeVersion(version);

    const result = await composeCheck.run();

    expect(result.status).toBe('error');
    expect(result.message).toContain('2.20.2');
  });

  it('reports an error when Compose is unavailable', async () => {
    mockComposeVersion('', 1);

    expect((await composeCheck.run()).status).toBe('error');
  });

  it('warns when the version cannot be parsed', async () => {
    mockComposeVersion('unknown');

    expect((await composeCheck.run()).status).toBe('warning');
  });
});

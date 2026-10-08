import { describe, expect, it } from 'vitest';

import { isDockerPermissionDenied } from './docker-group.check';

describe('isDockerPermissionDenied', () => {
  it('detects the socket permission error', () => {
    expect(
      isDockerPermissionDenied(
        'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
      ),
    ).toBe(true);
    expect(isDockerPermissionDenied('Got permission denied while trying to connect')).toBe(true);
  });

  it.each([
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    '',
  ])('ignores unrelated failures: %j', (stderr) => {
    expect(isDockerPermissionDenied(stderr)).toBe(false);
  });
});

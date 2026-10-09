import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TUNNEL_SERVICES } from './tunnel.constants';
import { buildTunnelPlan, resolveSshTarget, validateSshTarget } from './tunnel.plan';

const COMPOSE_DIR = new URL('../../../../compose/', import.meta.url);

describe('TUNNEL_SERVICES', () => {
  it('forwards the five administration panels with the catalog ports', () => {
    expect(TUNNEL_SERVICES.map(({ id, port }) => [id, port])).toEqual([
      ['sonarr', 8989],
      ['radarr', 7878],
      ['prowlarr', 9696],
      ['bazarr', 6767],
      ['decypharr', 8282],
    ]);
  });

  it('publishes every port on the server loopback in the Compose manifests', () => {
    const manifests = ['automation.yaml', 'storage.yaml']
      .map((file) => readFileSync(new URL(file, COMPOSE_DIR), 'utf8'))
      .join('\n');

    for (const { port } of TUNNEL_SERVICES) {
      expect(manifests).toMatch(new RegExp(`'127\\.0\\.0\\.1:${port}:${port}'`));
    }
  });
});

describe('validateSshTarget', () => {
  it.each([
    'ubuntu@203.0.113.10',
    'user@server.example.com',
    'my-alias',
    'admin@[2001:db8::1]',
    'host%eth0',
  ])('accepts %j', (target) => {
    expect(validateSshTarget(target)).toBe(target);
  });

  it.each(['-oProxyCommand=x', '-J', 'a b', 'host;reboot', 'host$(id)', 'a/b', '', 'x\ny'])(
    'rejects %j',
    (target) => {
      expect(() => validateSshTarget(target)).toThrow(`Invalid SSH target "${target}".`);
    },
  );
});

describe('resolveSshTarget', () => {
  it('prefers the argument over the environment', () => {
    expect(resolveSshTarget('a@one', { MB_SSH_TARGET: 'b@two' })).toBe('a@one');
  });

  it('falls back to MB_SSH_TARGET', () => {
    expect(resolveSshTarget(undefined, { MB_SSH_TARGET: 'b@two' })).toBe('b@two');
  });

  it('reports a missing target', () => {
    const expected = 'Missing SSH target. Pass it as an argument or set MB_SSH_TARGET.';

    expect(() => resolveSshTarget(undefined, {})).toThrow(expected);
    expect(() => resolveSshTarget('', { MB_SSH_TARGET: '' })).toThrow(expected);
  });

  it('validates the target that came from the environment', () => {
    expect(() => resolveSshTarget(undefined, { MB_SSH_TARGET: '-oProxyCommand=x' })).toThrow(
      'Invalid SSH target "-oProxyCommand=x".',
    );
  });
});

describe('buildTunnelPlan', () => {
  it('builds the exact ssh arguments, binding both ends to the loopback', () => {
    const plan = buildTunnelPlan('ubuntu@203.0.113.10');

    expect(plan.sshArgs).toEqual([
      '-N',
      '-T',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-L',
      '127.0.0.1:8989:127.0.0.1:8989',
      '-L',
      '127.0.0.1:7878:127.0.0.1:7878',
      '-L',
      '127.0.0.1:9696:127.0.0.1:9696',
      '-L',
      '127.0.0.1:6767:127.0.0.1:6767',
      '-L',
      '127.0.0.1:8282:127.0.0.1:8282',
      '--',
      'ubuntu@203.0.113.10',
    ]);
  });

  it('puts the target after the end-of-options marker', () => {
    const { sshArgs } = buildTunnelPlan('alias');

    expect(sshArgs.slice(-2)).toEqual(['--', 'alias']);
    expect(sshArgs).not.toContain('-g');
  });

  it('describes each forward with its local URL', () => {
    const { forwards } = buildTunnelPlan('alias');

    expect(forwards[0]).toEqual({
      service: 'sonarr',
      localPort: 8989,
      remotePort: 8989,
      url: 'http://localhost:8989',
    });
    expect(forwards).toHaveLength(5);
  });

  it('refuses an invalid target', () => {
    expect(() => buildTunnelPlan('-oProxyCommand=x')).toThrow('Invalid SSH target');
  });
});

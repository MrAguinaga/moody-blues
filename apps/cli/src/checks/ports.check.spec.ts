import { describe, expect, it } from 'vitest';

import type { ExecResult } from '../utils/system.utils';
import { createPortsCheck } from './ports.check';

function setup(occupied: number[], exec: (args: string[]) => ExecResult) {
  const calls: string[][] = [];
  const check = createPortsCheck({
    isOccupied: async (port) => occupied.includes(port),
    exec: async (_file, args) => {
      calls.push(args);
      return exec(args);
    },
  });
  return { check, calls };
}

const names = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0 });

describe('portsCheck', () => {
  it('succeeds without asking Docker when both ports are free', async () => {
    const { check, calls } = setup([], () => names(''));

    const result = await check.run();

    expect(result.status).toBe('success');
    expect(result.message).toBe('Ports 80 (HTTP) and 443 (HTTPS) are available');
    expect(calls).toEqual([]);
  });

  it('succeeds when the Moody Blues project holds both ports', async () => {
    const { check, calls } = setup([80, 443], () => names('moody-blues-caddy-1\n'));

    const result = await check.run();

    expect(result.status).toBe('success');
    expect(result.message).toBe(
      'Ports 80 (HTTP) and 443 (HTTPS) are held by the Moody Blues gateway',
    );
    expect(calls[0]).toEqual([
      'ps',
      '--filter',
      'label=com.docker.compose.project=moody-blues',
      '--filter',
      'publish=80',
      '--format',
      '{{.Names}}',
    ]);
  });

  it('describes a single port held by the gateway', async () => {
    const { check } = setup([443], () => names('moody-blues-caddy-1'));

    const result = await check.run();

    expect(result.status).toBe('success');
    expect(result.message).toBe('Port 443 (HTTPS) is held by the Moody Blues gateway');
  });

  it('warns about a port held by another process', async () => {
    const { check } = setup([80, 443], () => names(''));

    const result = await check.run();

    expect(result.status).toBe('warning');
    expect(result.message).toBe('Occupied port(s) detected: 80, 443');
  });

  it('warns only about the ports the project does not hold', async () => {
    const { check } = setup([80, 443], (args) =>
      names(args.includes('publish=80') ? 'moody-blues-caddy-1' : ''),
    );

    const result = await check.run();

    expect(result.status).toBe('warning');
    expect(result.message).toBe('Occupied port(s) detected: 443');
  });

  it('keeps the warning when Docker does not answer', async () => {
    const { check } = setup([80], () => ({ stdout: '', stderr: 'daemon down', exitCode: 1 }));

    const result = await check.run();

    expect(result.status).toBe('warning');
    expect(result.message).toBe('Occupied port(s) detected: 80');
  });
});

import { describe, expect, it } from 'vitest';

import type { TunnelReport } from '../tunnel';
import { buildTunnelPlan } from '../tunnel';
import { formatTunnelLines, toTunnelJson } from './tunnel-output.utils';

function report(unreachable: string[] = []): TunnelReport {
  return {
    target: 'ubuntu@203.0.113.10',
    forwards: buildTunnelPlan('ubuntu@203.0.113.10').forwards.map((forward) => ({
      ...forward,
      reachable: !unreachable.includes(forward.service),
    })),
  };
}

describe('formatTunnelLines', () => {
  it('lists the panels aligned under the heading', () => {
    expect(formatTunnelLines(report())).toEqual([
      '✔ Tunnel is open. Administration panels:',
      '  sonarr     http://localhost:8989',
      '  radarr     http://localhost:7878',
      '  prowlarr   http://localhost:9696',
      '  bazarr     http://localhost:6767',
      '  decypharr  http://localhost:8282',
    ]);
  });

  it('marks a service that does not answer and keeps the others', () => {
    const lines = formatTunnelLines(report(['bazarr']));

    expect(lines[4]).toBe(
      '  bazarr     http://localhost:6767 — no answer (is the container running? Check it with doctor)',
    );
    expect(lines.filter((line) => line.includes('no answer'))).toHaveLength(1);
  });
});

describe('toTunnelJson', () => {
  it('has the documented shape', () => {
    const json = toTunnelJson(report(['radarr']));

    expect(json.target).toBe('ubuntu@203.0.113.10');
    expect(json.forwards).toHaveLength(5);
    expect(json.forwards[0]).toEqual({
      service: 'sonarr',
      url: 'http://localhost:8989',
      localPort: 8989,
      remotePort: 8989,
      reachable: true,
    });
    expect(Object.keys(json.forwards[0] ?? {})).toEqual([
      'service',
      'url',
      'localPort',
      'remotePort',
      'reachable',
    ]);
    expect(json.forwards[1]?.reachable).toBe(false);
  });
});

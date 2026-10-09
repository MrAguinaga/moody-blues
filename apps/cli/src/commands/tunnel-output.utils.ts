import type { TunnelReport } from '../tunnel';

const NO_ANSWER_SUFFIX = ' — no answer (is the container running? Check it with doctor)';

export function formatTunnelLines(report: TunnelReport): string[] {
  const width = Math.max(...report.forwards.map(({ service }) => service.length)) + 2;

  return [
    '✔ Tunnel is open. Administration panels:',
    ...report.forwards.map(
      ({ service, url, reachable }) =>
        `  ${service.padEnd(width)}${url}${reachable ? '' : NO_ANSWER_SUFFIX}`,
    ),
  ];
}

export function toTunnelJson(report: TunnelReport) {
  return {
    target: report.target,
    forwards: report.forwards.map(({ service, url, localPort, remotePort, reachable }) => ({
      service,
      url,
      localPort,
      remotePort,
      reachable,
    })),
  };
}

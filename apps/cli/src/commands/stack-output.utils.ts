import { render } from 'ink';
import { createElement } from 'react';

import type { ServiceStatus, StackStatus } from '../docker';
import { isServiceHealthy } from '../docker';
import { StackStatusView, type StackStatusViewProps } from '../ui/views/StackStatusView';

export interface MountedStackStatusView {
  update(patch: Partial<StackStatusViewProps>): void;
  unmount(): void;
  exited: Promise<void>;
}

export function mountStackStatusView(initial: StackStatusViewProps): MountedStackStatusView {
  let props = initial;
  const instance = render(createElement(StackStatusView, props));

  return {
    update: (patch) => {
      props = { ...props, ...patch };
      instance.rerender(createElement(StackStatusView, props));
    },
    unmount: () => instance.unmount(),
    exited: instance.waitUntilExit().then(() => undefined),
  };
}

function describeService(service: ServiceStatus): string {
  return service.health === 'none' ? service.state : `${service.state} (${service.health})`;
}

export function formatStatusTable(status: StackStatus): string[] {
  const nameWidth = Math.max('SERVICE'.length, ...status.services.map((s) => s.service.length));
  const stateWidth = Math.max(
    'STATE'.length,
    ...status.services.map((s) => describeService(s).length),
  );

  const rows = status.services.map((service) =>
    [
      service.service.padEnd(nameWidth),
      describeService(service).padEnd(stateWidth),
      service.publishedPorts.join(', '),
    ]
      .join('  ')
      .trimEnd(),
  );
  const healthy = status.services.filter(isServiceHealthy).length;

  return [
    ['SERVICE'.padEnd(nameWidth), 'STATE'.padEnd(stateWidth), 'PORTS'].join('  ').trimEnd(),
    ...rows,
    status.allHealthy
      ? `✔ All ${status.services.length} services are healthy.`
      : `⚠ ${healthy} of ${status.services.length} services are healthy.`,
  ];
}

export function createTransitionPrinter(
  print: (line: string) => void = console.log,
  now: () => number = Date.now,
): (status: StackStatus) => void {
  const startedAt = now();
  const lastSeen = new Map<string, string>();

  return (status) => {
    const elapsed = `${Math.round((now() - startedAt) / 1000)}s`.padStart(5);
    for (const service of status.services) {
      const description = describeService(service);
      if (lastSeen.get(service.service) !== description) {
        lastSeen.set(service.service, description);
        print(`[${elapsed}] ${service.service}: ${description}`);
      }
    }
  };
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

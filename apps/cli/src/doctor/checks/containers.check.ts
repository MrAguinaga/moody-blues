import {
  isServiceHealthy,
  OPTIONAL_SERVICES,
  type ServiceStatus,
  type StackStatus,
} from '../../docker';
import type { DoctorCheck, DoctorOutcome } from '../doctor.types';
import { errorText } from './check-gate.utils';

const NAME = 'Containers';

function describeService(service: ServiceStatus): string {
  const health = service.health === 'none' ? '' : ` (${service.health})`;
  const exit = service.state === 'exited' ? `, exit code ${service.exitCode}` : '';
  return `${service.service}: ${service.state}${health}${exit}`;
}

function isStarting(service: ServiceStatus): boolean {
  return service.state === 'running' && service.health === 'starting';
}

export function evaluateContainers(status: StackStatus): DoctorOutcome {
  const total = status.services.length;
  const healthy = status.services.filter(isServiceHealthy).length;
  const summary = `${healthy} of ${total} services are healthy`;

  if (total === 0) {
    return {
      status: 'error',
      message: 'Docker Compose reports no services for this installation',
      suggestion: 'Run "moody-blues setup" to provision the stack.',
    };
  }

  const failing = status.services.filter(
    (service) => !isServiceHealthy(service) && !isStarting(service),
  );
  const required = failing.filter((service) => !OPTIONAL_SERVICES.includes(service.service));
  if (required.length > 0) {
    return {
      status: 'error',
      message: summary,
      details: failing.map(describeService),
      suggestion: `Run "moody-blues start" to bring the stack up; inspect a failing service with "moody-blues logs ${required[0]?.service}".`,
    };
  }
  if (failing.length > 0) {
    return {
      status: 'warning',
      message: summary,
      details: failing.map(describeService),
      suggestion: `${failing.map((service) => service.service).join(', ')} is optional; run "moody-blues start" to restart it. Without it only indexers behind Cloudflare fail.`,
    };
  }

  const starting = status.services.filter(isStarting);
  if (starting.length > 0) {
    return {
      status: 'warning',
      message: summary,
      details: starting.map(describeService),
      suggestion: 'Wait a minute and run "moody-blues doctor" again; check "moody-blues status".',
    };
  }

  return { status: 'ok', message: summary };
}

export const containersCheck: DoctorCheck = {
  id: 'containers',
  name: NAME,
  run: async (ctx) => {
    try {
      return evaluateContainers(await ctx.stack());
    } catch (error) {
      return {
        status: 'error',
        message: 'Docker did not report the state of the containers',
        details: [errorText(error)],
        suggestion: 'Check that the Docker daemon is running and that your user can reach it.',
      };
    }
  },
};

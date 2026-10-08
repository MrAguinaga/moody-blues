import { resolve4 } from 'node:dns/promises';

import type { CheckContext, CheckDefinition, CheckResult } from './checks.types';

const DEFINITION = {
  id: 'dns',
  name: 'DNS Records',
  description: 'Checks that the public hostnames resolve to this server (remote mode)',
} as const;

const PUBLIC_IP_URL = 'https://api.ipify.org';
const PUBLIC_IP_TIMEOUT_MS = 5000;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const SUBDOMAINS = ['watch', 'discover'] as const;

export type HostResolutions = Record<string, string[]>;

export interface DnsEvaluation {
  unresolved: string[];
  mismatched: string[];
}

export function expectedHostnames(domain: string): string[] {
  return [domain, ...SUBDOMAINS.map((subdomain) => `${subdomain}.${domain}`)];
}

export function compareResolutions(
  resolutions: HostResolutions,
  publicIp: string | undefined,
): DnsEvaluation {
  const unresolved: string[] = [];
  const mismatched: string[] = [];

  for (const [hostname, addresses] of Object.entries(resolutions)) {
    if (addresses.length === 0) {
      unresolved.push(hostname);
    } else if (publicIp !== undefined && !addresses.includes(publicIp)) {
      mismatched.push(hostname);
    }
  }
  return { unresolved, mismatched };
}

export function evaluateDns(
  resolutions: HostResolutions,
  publicIp: string | undefined,
): CheckResult {
  const { unresolved, mismatched } = compareResolutions(resolutions, publicIp);

  if (unresolved.length > 0) {
    return {
      ...DEFINITION,
      status: 'error',
      message: `These names do not resolve: ${unresolved.join(', ')}`,
      suggestion: `Create A records for ${unresolved.join(', ')} pointing to ${publicIp ?? 'this server public IP'}.`,
    };
  }

  if (mismatched.length > 0) {
    const detail = mismatched
      .map((hostname) => `${hostname} -> ${resolutions[hostname]?.join(', ')}`)
      .join('; ');
    return {
      ...DEFINITION,
      status: 'error',
      message: `These names point to a different IP than ${publicIp}: ${detail}`,
      suggestion: `Point the A records to ${publicIp}. If you use a proxying CDN, disable the proxy so Caddy can issue certificates.`,
    };
  }

  if (publicIp === undefined) {
    return {
      ...DEFINITION,
      status: 'warning',
      message: 'All names resolve, but the public IP of this server could not be determined.',
      suggestion: 'Verify manually that the A records point to this server.',
    };
  }

  return { ...DEFINITION, status: 'success', message: `All names resolve to ${publicIp}` };
}

export function parsePublicIp(body: string): string | undefined {
  const candidate = body.trim();
  return IPV4_PATTERN.test(candidate) ? candidate : undefined;
}

async function fetchPublicIp(): Promise<string | undefined> {
  try {
    const response = await fetch(PUBLIC_IP_URL, {
      signal: AbortSignal.timeout(PUBLIC_IP_TIMEOUT_MS),
    });
    return response.ok ? parsePublicIp(await response.text()) : undefined;
  } catch {
    return undefined;
  }
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  try {
    return await resolve4(hostname);
  } catch {
    return [];
  }
}

export const dnsCheck: CheckDefinition = {
  ...DEFINITION,
  run: async (context: CheckContext = {}): Promise<CheckResult> => {
    if (context.mode !== 'remote') {
      return { ...DEFINITION, status: 'success', message: 'Not required in local mode' };
    }
    if (!context.domain) {
      return {
        ...DEFINITION,
        status: 'warning',
        message: 'No domain is configured, so the DNS records cannot be verified.',
      };
    }

    const hostnames = expectedHostnames(context.domain);
    const [publicIp, ...addresses] = await Promise.all([
      fetchPublicIp(),
      ...hostnames.map(resolveAddresses),
    ]);
    const resolutions = Object.fromEntries(
      hostnames.map((hostname, index) => [hostname, addresses[index] ?? []]),
    );

    return evaluateDns(resolutions, publicIp);
  },
};

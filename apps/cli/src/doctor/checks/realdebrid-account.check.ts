import type { FetchLike } from '@moody-blues/provisioner';

import {
  REAL_DEBRID_EXPIRY_WARNING_DAYS,
  REAL_DEBRID_USER_URL,
  REQUEST_TIMEOUT_MS,
} from '../doctor.constants';
import type { DoctorCheck, DoctorContext, DoctorOutcome } from '../doctor.types';
import { errorText } from './check-gate.utils';

const DAY_MS = 86_400_000;
const REJECTED_STATUSES: readonly number[] = [401, 403];

export interface RealDebridAccountOptions {
  fetch?: FetchLike;
}

interface AccountView {
  type?: string;
  premiumSeconds?: number;
  expiration?: string;
}

function readAccount(body: unknown): AccountView | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  return {
    type: typeof record.type === 'string' ? record.type : undefined,
    premiumSeconds: typeof record.premium === 'number' ? record.premium : undefined,
    expiration: typeof record.expiration === 'string' ? record.expiration : undefined,
  };
}

function describeShape(body: unknown): string {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? `fields received: ${Object.keys(body).join(', ') || 'none'}`
    : `received a ${Array.isArray(body) ? 'list' : typeof body} instead of an object`;
}

export function evaluateAccount(body: unknown, now: number): DoctorOutcome {
  const account = readAccount(body);
  if (account?.type === undefined) {
    return {
      status: 'warning',
      message: 'Real-Debrid answered with an unexpected account format',
      details: [describeShape(body)],
    };
  }

  const expiresAt =
    account.expiration !== undefined
      ? Date.parse(account.expiration)
      : account.premiumSeconds !== undefined
        ? now + account.premiumSeconds * 1000
        : Number.NaN;
  if (account.type !== 'premium' || account.premiumSeconds === 0 || expiresAt <= now) {
    return {
      status: 'error',
      message: 'The Real-Debrid account has no active subscription',
      suggestion: 'Renew the Real-Debrid premium subscription.',
    };
  }
  if (Number.isNaN(expiresAt)) {
    return {
      status: 'warning',
      message: 'The Real-Debrid subscription is active, but its expiration date is unknown',
      details: [describeShape(body)],
    };
  }

  const daysLeft = Math.floor((expiresAt - now) / DAY_MS);
  const date = new Date(expiresAt).toISOString().slice(0, 10);
  if (daysLeft < REAL_DEBRID_EXPIRY_WARNING_DAYS) {
    return {
      status: 'warning',
      message: `The Real-Debrid subscription expires on ${date} (${daysLeft} days left)`,
      suggestion: 'Renew the Real-Debrid premium subscription before it expires.',
    };
  }
  return {
    status: 'ok',
    message: `The Real-Debrid subscription is active until ${date} (${daysLeft} days left)`,
  };
}

async function requestAccount(
  ctx: DoctorContext,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(REAL_DEBRID_USER_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ctx.provision.secrets.rdApiToken}`,
    },
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: undefined };
  }
}

export function createRealDebridAccountCheck(options: RealDebridAccountOptions = {}): DoctorCheck {
  const fetchImpl = options.fetch ?? fetch;
  return {
    id: 'realdebrid-account',
    name: 'Real-Debrid account',
    run: async (ctx) => {
      let reply: { status: number; body: unknown };
      try {
        reply = await requestAccount(ctx, fetchImpl);
      } catch (error) {
        return {
          status: 'warning',
          message: 'Real-Debrid could not be reached',
          details: [errorText(error)],
          suggestion: 'Check the outbound connectivity of this host and run the check again.',
        };
      }

      if (REJECTED_STATUSES.includes(reply.status)) {
        return {
          status: 'error',
          message: `Real-Debrid rejected the token (HTTP ${reply.status})`,
          suggestion:
            'Review RD_API_TOKEN in the Moody Blues .env, then run "moody-blues setup" again.',
        };
      }
      if (reply.status !== 200) {
        return {
          status: 'warning',
          message: `Real-Debrid answered HTTP ${reply.status}`,
          suggestion: 'Run the check again in a few minutes.',
        };
      }
      return evaluateAccount(reply.body, ctx.now());
    },
  };
}

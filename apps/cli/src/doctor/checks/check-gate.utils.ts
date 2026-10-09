import { HttpStatusError } from '@moody-blues/provisioner';

import type { DoctorContext, DoctorOutcome } from '../doctor.types';

const REJECTED_KEY_STATUSES: readonly number[] = [401, 403];

export function skipped(message: string): DoctorOutcome {
  return { status: 'skipped', message };
}

export function storageDisabled(ctx: DoctorContext): boolean {
  return !ctx.provision.config.storage.enabled;
}

export const STORAGE_DISABLED_MESSAGE =
  'The storage profile is disabled, so Decypharr is not deployed';

export async function gateService(
  ctx: DoctorContext,
  service: string,
): Promise<DoctorOutcome | undefined> {
  try {
    const status = await ctx.stack();
    const current = status.services.find((candidate) => candidate.service === service);
    return current?.state === 'running'
      ? undefined
      : skipped(`The ${service} container is not running (see the Containers check)`);
  } catch {
    return skipped('Docker did not report the stack state (see the Containers check)');
  }
}

export function isRejectedKey(error: unknown): boolean {
  return error instanceof HttpStatusError && REJECTED_KEY_STATUSES.includes(error.status);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logsSuggestion(service: string): string {
  return `Inspect the container with "moody-blues logs ${service}".`;
}

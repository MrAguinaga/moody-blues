import {
  buildPlaybackPolicy,
  driftedKeys,
  type PlaybackPolicy,
  type TranscodingMode,
  type UserDto,
} from '@moody-blues/provisioner';

import { MAX_DETAIL_LINES } from '../doctor.constants';
import type { DoctorCheck, DoctorOutcome } from '../doctor.types';
import { errorText, gateService, logsSuggestion, skipped } from './check-gate.utils';

export interface DriftedUser {
  name: string;
  drifted: string[];
}

export function evaluatePolicies(
  users: readonly UserDto[],
  mode: TranscodingMode,
): { desired: PlaybackPolicy; drifted: DriftedUser[] } {
  const desired = buildPlaybackPolicy(mode);
  const drifted = users.flatMap((user) => {
    const keys = driftedKeys(user.Policy ?? {}, desired);
    return keys.length > 0 ? [{ name: user.Name, drifted: keys }] : [];
  });
  return { desired, drifted };
}

function describeDrift({ name, drifted }: DriftedUser, current: UserDto | undefined): string {
  const policy = current?.Policy ?? {};
  const detail = drifted.map((key) => `${key}=${String(policy[key] ?? 'unset')}`).join(', ');
  return `${name}: ${detail}`;
}

export const jellyfinPolicyCheck: DoctorCheck = {
  id: 'jellyfin-policy',
  name: 'Jellyfin playback policy',
  run: async (ctx): Promise<DoctorOutcome> => {
    const gate = await gateService(ctx, 'jellyfin');
    if (gate) {
      return gate;
    }
    const apiKey = ctx.installation.env.JELLYFIN_API_KEY;
    if (!apiKey) {
      return skipped('JELLYFIN_API_KEY is missing (see the Jellyfin API check)');
    }

    const mode = ctx.provision.config.transcoding;
    let users: UserDto[];
    try {
      ctx.clients.jellyfin.useToken(apiKey);
      users = await ctx.clients.jellyfin.listUsers();
    } catch (error) {
      return {
        status: 'warning',
        message: 'The Jellyfin users could not be read',
        details: [ctx.redact(errorText(error))],
        suggestion: logsSuggestion('jellyfin'),
      };
    }

    const { drifted } = evaluatePolicies(users, mode);
    if (drifted.length === 0) {
      return {
        status: 'ok',
        message: `${users.length} ${users.length === 1 ? 'user follows' : 'users follow'} the "${mode}" playback policy`,
      };
    }
    const shown = drifted.slice(0, MAX_DETAIL_LINES).map((entry) =>
      describeDrift(
        entry,
        users.find((user) => user.Name === entry.name),
      ),
    );
    const hidden = drifted.length - shown.length;
    return {
      status: 'warning',
      message: `${drifted.length} ${drifted.length === 1 ? 'user does' : 'users do'} not follow the "${mode}" playback policy`,
      details: [...shown, ...(hidden > 0 ? [`and ${hidden} more`] : [])],
      suggestion: `Run "moody-blues config transcoding ${mode}" to apply the policy to every user.`,
    };
  },
};

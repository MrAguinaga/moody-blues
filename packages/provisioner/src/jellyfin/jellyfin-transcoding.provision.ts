import type { ProvisionContext, StepOutcome } from '../pipeline/pipeline.types';
import { ensureJellyfinAccess } from './jellyfin.access';
import type { JellyfinClient, JellyfinReadyOptions } from './jellyfin.client';
import { driftedKeys } from './jellyfin.settings';
import { buildEncodingSettings, buildPlaybackPolicy } from './jellyfin-transcoding.settings';

export interface ProvisionTranscodingOptions {
  client: JellyfinClient;
  signal: AbortSignal;
  ready?: JellyfinReadyOptions;
}

export async function provisionTranscoding(
  ctx: ProvisionContext,
  options: ProvisionTranscodingOptions,
): Promise<StepOutcome> {
  const { client, signal } = options;
  const mode = ctx.config.transcoding;
  const changes: string[] = [];
  const notes: string[] = [];
  const progress = (message: string) => ctx.reportProgress?.(message);

  const desiredEncoding = buildEncodingSettings(mode, ctx.hardware);
  const desiredPolicy = buildPlaybackPolicy(mode);

  progress('Waiting for Jellyfin');
  await client.waitReady({ signal, ...options.ready });

  progress('Checking the API key');
  const access = await ensureJellyfinAccess(ctx, client);
  if (access.created) {
    changes.push('created the API key');
  }
  if (access.persisted) {
    changes.push('stored the API key in the environment file');
  }
  notes.push(...access.warnings);

  progress('Checking the encoding options');
  const encoding = await client.getNamedConfiguration('encoding');
  const encodingDrift = driftedKeys(encoding, desiredEncoding);
  if (encodingDrift.length > 0) {
    await client.saveNamedConfiguration('encoding', { ...encoding, ...desiredEncoding });
    changes.push(`encoding options ${encodingDrift.join(', ')}`);
  }

  progress('Checking the playback policy of every user');
  const users = await client.listUsers();
  let updated = 0;
  for (const user of users) {
    if (!user.Policy) {
      throw new Error(`Jellyfin returned no policy for the user "${user.Name}"`);
    }
    if (driftedKeys(user.Policy, desiredPolicy).length > 0) {
      await client.updateUserPolicy(user.Id, { ...user.Policy, ...desiredPolicy });
      updated += 1;
    }
  }
  if (updated > 0) {
    changes.push(`playback policy of ${updated} of ${users.length} users`);
  }

  if (ctx.hardware && mode === 'hardware') {
    notes.push(`accelerator ${ctx.hardware}`);
  }

  const detail = [changes.join(', '), ...notes].filter(Boolean).join('; ');
  return {
    status: changes.length > 0 ? 'changed' : 'unchanged',
    ...(detail ? { detail } : {}),
  };
}

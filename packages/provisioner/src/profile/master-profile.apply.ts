import type { ArrClient } from '../arr/arr.client';
import type { LanguageResource } from '../arr/arr.types';
import { HttpStatusError } from '../http/http.errors';
import type { StepOutcome } from '../pipeline/pipeline.types';
import { customFormatMatches, toCustomFormatResource } from './custom-format.fields';
import {
  findUnplannedQualities,
  materializeProfile,
  profilesEquivalent,
} from './master-profile.materialize';
import type { ProfilePlan } from './profile.types';

export const FACTORY_PROFILE_NAMES: readonly string[] = [
  'Any',
  'SD',
  'HD-720p',
  'HD-1080p',
  'Ultra-HD',
  'HD - 720p/1080p',
];

type Progress = (message: string) => void;

function indexLanguages(languages: readonly LanguageResource[]): Record<string, number> {
  return Object.fromEntries(languages.map((language) => [language.name, language.id]));
}

async function upsertCustomFormats(client: ArrClient, plan: ProfilePlan): Promise<string[]> {
  const schema = await client.getCustomFormatSchema();
  const existing = await client.listCustomFormats();
  const created: string[] = [];
  const updated: string[] = [];

  for (const { format } of plan.formats) {
    const desired = toCustomFormatResource(format, schema);
    const current = existing.find((candidate) => candidate.name === desired.name);
    if (!current) {
      await client.createCustomFormat(desired);
      created.push(desired.name);
    } else if (!customFormatMatches(current, desired)) {
      await client.updateCustomFormat({ ...desired, id: current.id });
      updated.push(desired.name);
    }
  }
  return [
    ...(created.length > 0 ? [`created ${created.length} custom formats`] : []),
    ...(updated.length > 0 ? [`updated custom formats ${updated.join(', ')}`] : []),
  ];
}

function isInUse(error: unknown): boolean {
  return (
    error instanceof HttpStatusError && error.status === 500 && /is in use/i.test(error.message)
  );
}

async function removeFactoryProfiles(client: ArrClient): Promise<{
  removed: string[];
  kept: string[];
}> {
  const removed: string[] = [];
  const kept: string[] = [];
  const factory = (await client.listQualityProfiles()).filter(
    (profile) => profile.id !== undefined && FACTORY_PROFILE_NAMES.includes(profile.name),
  );

  for (const profile of factory) {
    try {
      await client.deleteQualityProfile(profile.id as number);
      removed.push(profile.name);
    } catch (error) {
      if (!isInUse(error)) throw error;
      kept.push(profile.name);
    }
  }
  return { removed, kept };
}

export async function applyMasterProfile(
  client: ArrClient,
  plan: ProfilePlan,
  progress?: Progress,
): Promise<StepOutcome> {
  const changes: string[] = [];
  const notes: string[] = [];

  progress?.('Applying custom formats');
  const languageIds = indexLanguages(await client.listLanguages());
  changes.push(...(await upsertCustomFormats(client, plan)));

  progress?.(`Applying quality profile ${plan.name}`);
  const schema = await client.getQualityProfileSchema();
  const profiles = await client.listQualityProfiles();
  const formats = await client.listCustomFormats();
  const existing = profiles.find((profile) => profile.name === plan.name);
  const desired = materializeProfile(plan, schema, formats, languageIds, existing);

  if (!existing) {
    await client.createQualityProfile(desired);
    changes.push(`created profile ${plan.name}`);
  } else if (!profilesEquivalent(existing, desired)) {
    await client.updateQualityProfile(desired);
    changes.push(`updated profile ${plan.name}`);
  }

  const unplanned = findUnplannedQualities(plan, schema);
  if (unplanned.length > 0) {
    notes.push(`disabled unplanned qualities: ${unplanned.join(', ')}`);
  }

  progress?.('Removing factory quality profiles');
  const { removed, kept } = await removeFactoryProfiles(client);
  if (removed.length > 0) {
    changes.push(`removed ${removed.length} factory profiles`);
  }
  if (kept.length > 0) {
    notes.push(`kept factory profiles in use: ${kept.join(', ')}`);
  }

  const detail = [...changes, ...notes].join(', ');
  return {
    status: changes.length > 0 ? 'changed' : 'unchanged',
    ...(detail ? { detail } : {}),
  };
}

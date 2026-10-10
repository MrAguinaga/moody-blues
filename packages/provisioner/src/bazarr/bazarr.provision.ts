import { PollTimeoutError } from '../http/http.errors';
import type { Sleep } from '../http/http.types';
import { pollUntil } from '../http/ready.http';
import type { ProvisionContext, StepOutcome } from '../pipeline/pipeline.types';
import type { BazarrClient, BazarrReadyOptions, BazarrTaskOptions } from './bazarr.client';
import { enabledLanguagesEntry, languageProfilesEntry, settingsEntry } from './bazarr.form';
import {
  buildLanguageProfile,
  languageProfilesEquivalent,
  mergeLanguageProfiles,
  SPANISH_LATINO_PROFILE_ID,
  toBazarrLanguageCodes,
} from './bazarr.languages';
import { DEFAULT_PROFILES_GROUP, desiredSettings, findDrift } from './bazarr.settings';
import type { SettingsEntry } from './bazarr.types';

export const LINK_TIMEOUT_MS = 60_000;
export const LINK_INTERVAL_MS = 2_000;

const SYNC_TASKS: readonly string[] = ['update_series', 'update_movies'];

export interface LinkWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: Sleep;
  now?: () => number;
}

export interface ProvisionBazarrOptions {
  client: BazarrClient;
  serviceKeys: { sonarr: string; radarr: string };
  signal: AbortSignal;
  ready?: BazarrReadyOptions;
  link?: LinkWaitOptions;
  tasks?: BazarrTaskOptions;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

async function awaitLinks(
  client: BazarrClient,
  signal: AbortSignal,
  options: LinkWaitOptions = {},
): Promise<void> {
  let unlinked = ['Sonarr', 'Radarr'];
  try {
    await pollUntil(
      async () => {
        const status = await client.getStatus();
        unlinked = [
          ...(status.sonarr_version ? [] : ['Sonarr']),
          ...(status.radarr_version ? [] : ['Radarr']),
        ];
        return unlinked.length === 0 ? true : undefined;
      },
      {
        timeoutMs: options.timeoutMs ?? LINK_TIMEOUT_MS,
        intervalMs: options.intervalMs ?? LINK_INTERVAL_MS,
        signal,
        sleep: options.sleep,
        now: options.now,
      },
    );
  } catch (error) {
    if (error instanceof PollTimeoutError) {
      throw new Error(
        `Bazarr could not reach ${unlinked.join(' and ')} after ` +
          `${Math.round(error.waitedMs / 1000)} s; check the connection settings and that the service is healthy`,
      );
    }
    throw error;
  }
}

export async function provisionBazarr(
  ctx: ProvisionContext,
  options: ProvisionBazarrOptions,
): Promise<StepOutcome> {
  const { client, signal } = options;
  const changes: string[] = [];
  const notes: string[] = [];
  const entries: SettingsEntry[] = [];
  let defaultsChanged = false;
  const progress = (message: string) => ctx.reportProgress?.(message);
  const { secrets, config } = ctx;

  progress('Waiting for Bazarr');
  await client.waitReady({ signal, ...options.ready });

  progress('Checking subtitle languages');
  const codes = toBazarrLanguageCodes(config.languages.subtitles);
  const desiredProfile = buildLanguageProfile(config.languages.subtitles);
  const languages = await client.listLanguages();
  const unknown = codes.filter((code) => !languages.some((language) => language.code2 === code));
  if (unknown.length > 0) {
    throw new Error(`Bazarr does not offer the subtitle languages ${unknown.join(', ')}`);
  }
  const enabled = languages
    .filter((language) => language.enabled)
    .map((language) => language.code2);
  if (codes.some((code) => !enabled.includes(code))) {
    entries.push(enabledLanguagesEntry([...new Set([...enabled, ...codes])]));
    changes.push(`enabled languages ${codes.join(', ')}`);
  }
  const profiles = await client.listProfiles();
  const currentProfile = profiles.find(
    (profile) => profile.profileId === SPANISH_LATINO_PROFILE_ID,
  );
  if (!currentProfile || !languageProfilesEquivalent(currentProfile, desiredProfile)) {
    entries.push(languageProfilesEntry(mergeLanguageProfiles(profiles, desiredProfile)));
    changes.push(`language profile ${desiredProfile.name}`);
    defaultsChanged = true;
  }

  progress('Checking settings');
  const settings = await client.getSettings();
  const { opensubtitlesUsername, opensubtitlesPassword } = secrets;
  const opensubtitles =
    opensubtitlesUsername && opensubtitlesPassword
      ? { username: opensubtitlesUsername, password: opensubtitlesPassword }
      : undefined;
  const drift = findDrift(
    settings,
    desiredSettings(settings, {
      sonarrApiKey: options.serviceKeys.sonarr,
      radarrApiKey: options.serviceKeys.radarr,
      adminUsername: secrets.adminUsername,
      adminPassword: secrets.adminPassword,
      opensubtitles,
    }),
  );
  for (const { section, key, value } of drift) {
    entries.push(settingsEntry(section, key, value));
  }
  const driftGroups = [...new Set(drift.map(({ group }) => group))];
  changes.push(...driftGroups);
  defaultsChanged ||= driftGroups.includes(DEFAULT_PROFILES_GROUP);

  if (entries.length > 0) {
    progress('Saving settings');
    await client.saveSettings(entries);
  }

  progress('Verifying Sonarr and Radarr links');
  await awaitLinks(client, signal, options.link);

  if (defaultsChanged) {
    progress('Synchronizing libraries');
    for (const taskId of SYNC_TASKS) {
      await client.runTask(taskId);
      await client.waitTask(taskId, { signal, ...options.tasks });
    }
  }

  progress('Assigning the language profile');
  const [series, movies] = await Promise.all([client.listSeries(), client.listMovies()]);
  const seriesToAssign = series
    .filter((item) => item.profileId == null)
    .map((item) => ({ id: item.sonarrSeriesId, profileId: SPANISH_LATINO_PROFILE_ID }));
  const moviesToAssign = movies
    .filter((item) => item.profileId == null)
    .map((item) => ({ id: item.radarrId, profileId: SPANISH_LATINO_PROFILE_ID }));
  if (seriesToAssign.length > 0) {
    await client.assignSeriesProfile(seriesToAssign);
    changes.push(`assigned the profile to ${plural(seriesToAssign.length, 'series')}`);
  }
  if (moviesToAssign.length > 0) {
    await client.assignMovieProfile(moviesToAssign);
    changes.push(`assigned the profile to ${plural(moviesToAssign.length, 'movie')}`);
  }

  if (!opensubtitles) {
    notes.push('no OpenSubtitles credentials: movie subtitles rely on the keyless providers');
  }

  const detail = [changes.join(', '), ...notes].filter(Boolean).join('; ');
  return {
    status: changes.length > 0 ? 'changed' : 'unchanged',
    ...(detail ? { detail } : {}),
  };
}

import { createHash } from 'node:crypto';

import { SERVICE_CATALOG } from '../services/service-catalog';
import { SPANISH_LATINO_PROFILE_ID } from './bazarr.languages';
import type { BazarrSettings, SettingsValue } from './bazarr.types';

export const GESTDOWN_PROVIDER = 'gestdown';
export const OPENSUBTITLES_PROVIDER = 'opensubtitlescom';

export const DEFAULT_PROFILES_GROUP = 'default profiles';

export const SUBTITLE_SYNC_GROUP = 'subtitle synchronization';
export const SERIES_MINIMUM_SCORE = 80;

const MANAGED_PROVIDERS: readonly string[] = [GESTDOWN_PROVIDER, OPENSUBTITLES_PROVIDER];

export interface DesiredSetting {
  section: string;
  key: string;
  value: SettingsValue;
  group: string;
  compare?: unknown;
}

export interface BazarrSettingsInput {
  sonarrApiKey: string;
  radarrApiKey: string;
  adminUsername: string;
  adminPassword: string;
  opensubtitles?: { username: string; password: string };
}

function connectionSettings(
  service: 'sonarr' | 'radarr',
  apiKey: string,
  label: string,
): DesiredSetting[] {
  const { id, port } = SERVICE_CATALOG[service];
  const group = `${label} connection`;
  return [
    { section: 'general', key: `use_${service}`, value: true, group },
    { section: service, key: 'ip', value: id, group },
    { section: service, key: 'port', value: port, group },
    { section: service, key: 'base_url', value: '', group },
    { section: service, key: 'ssl', value: false, group },
    { section: service, key: 'apikey', value: apiKey, group },
  ];
}

export function currentProviders(settings: BazarrSettings): string[] {
  const providers = settings.general?.enabled_providers;
  return Array.isArray(providers) ? providers.map(String) : [];
}

export function desiredProviders(current: readonly string[], withOpenSubtitles: boolean): string[] {
  const kept = current.filter((provider) => !MANAGED_PROVIDERS.includes(provider));
  return [
    ...new Set([
      ...kept,
      GESTDOWN_PROVIDER,
      ...(withOpenSubtitles ? [OPENSUBTITLES_PROVIDER] : []),
    ]),
  ];
}

export function desiredSettings(
  settings: BazarrSettings,
  input: BazarrSettingsInput,
): DesiredSetting[] {
  const { opensubtitles } = input;
  const authGroup = 'administrator account';
  return [
    ...connectionSettings('sonarr', input.sonarrApiKey, 'Sonarr'),
    ...connectionSettings('radarr', input.radarrApiKey, 'Radarr'),
    { section: 'auth', key: 'type', value: 'form', group: authGroup },
    { section: 'auth', key: 'username', value: input.adminUsername, group: authGroup },
    {
      section: 'auth',
      key: 'password',
      value: input.adminPassword,
      compare: createHash('md5').update(input.adminPassword).digest('hex'),
      group: authGroup,
    },
    ...(['serie', 'movie'] as const).flatMap((kind): DesiredSetting[] => [
      {
        section: 'general',
        key: `${kind}_default_enabled`,
        value: true,
        group: DEFAULT_PROFILES_GROUP,
      },
      {
        section: 'general',
        key: `${kind}_default_profile`,
        value: SPANISH_LATINO_PROFILE_ID,
        group: DEFAULT_PROFILES_GROUP,
      },
    ]),
    {
      section: 'general',
      key: 'enabled_providers',
      value: desiredProviders(currentProviders(settings), opensubtitles !== undefined),
      group: 'subtitle providers',
    },
    { section: 'subsync', key: 'use_subsync', value: true, group: SUBTITLE_SYNC_GROUP },
    { section: 'subsync', key: 'use_subsync_threshold', value: false, group: SUBTITLE_SYNC_GROUP },
    {
      section: 'subsync',
      key: 'use_subsync_movie_threshold',
      value: false,
      group: SUBTITLE_SYNC_GROUP,
    },
    {
      section: 'general',
      key: 'minimum_score',
      value: SERIES_MINIMUM_SCORE,
      group: SUBTITLE_SYNC_GROUP,
    },
    ...(opensubtitles
      ? [
          {
            section: OPENSUBTITLES_PROVIDER,
            key: 'username',
            value: opensubtitles.username,
            group: 'OpenSubtitles credentials',
          },
          {
            section: OPENSUBTITLES_PROVIDER,
            key: 'password',
            value: opensubtitles.password,
            group: 'OpenSubtitles credentials',
          },
        ]
      : []),
  ];
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      [...actual].map(String).sort().join('\n') === [...expected].map(String).sort().join('\n')
    );
  }
  if (actual == null || actual === '') {
    return expected === '' || expected == null;
  }
  return String(actual) === String(expected);
}

export function findDrift(
  settings: BazarrSettings,
  desired: readonly DesiredSetting[],
): DesiredSetting[] {
  return desired.filter(
    ({ section, key, value, compare }) => !sameValue(settings[section]?.[key], compare ?? value),
  );
}

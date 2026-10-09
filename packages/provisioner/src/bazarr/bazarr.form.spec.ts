import { describe, expect, it } from 'vitest';

import {
  enabledLanguagesEntry,
  encodeSettingsForm,
  languageProfilesEntry,
  settingsEntry,
  settingsKey,
} from './bazarr.form';
import { buildLanguageProfile } from './bazarr.languages';

describe('settingsKey', () => {
  it('prefixes the section and key', () => {
    expect(settingsKey('general', 'enabled_providers')).toBe('settings-general-enabled_providers');
  });
});

describe('encodeSettingsForm', () => {
  it('writes scalars as strings', () => {
    const form = encodeSettingsForm([
      settingsEntry('sonarr', 'port', 8989),
      settingsEntry('sonarr', 'ssl', false),
      settingsEntry('sonarr', 'ip', 'sonarr'),
      settingsEntry('sonarr', 'base_url', ''),
    ]);

    expect(Object.fromEntries(form)).toEqual({
      'settings-sonarr-port': '8989',
      'settings-sonarr-ssl': 'false',
      'settings-sonarr-ip': 'sonarr',
      'settings-sonarr-base_url': '',
    });
  });

  it('repeats the key once per array item', () => {
    const form = encodeSettingsForm([
      settingsEntry('general', 'enabled_providers', ['gestdown', 'opensubtitlescom']),
      enabledLanguagesEntry(['ea', 'es']),
    ]);

    expect(form.getAll('settings-general-enabled_providers')).toEqual([
      'gestdown',
      'opensubtitlescom',
    ]);
    expect(form.getAll('languages-enabled')).toEqual(['ea', 'es']);
  });

  it('sends an empty array as a single empty value', () => {
    const form = encodeSettingsForm([settingsEntry('general', 'path_mappings', [])]);

    expect(form.getAll('settings-general-path_mappings')).toEqual(['']);
  });

  it('percent-encodes values on the wire', () => {
    const form = encodeSettingsForm([settingsEntry('auth', 'password', 'p@ss&word=1 2')]);

    expect(form.toString()).toBe('settings-auth-password=p%40ss%26word%3D1+2');
  });
});

describe('languageProfilesEntry', () => {
  it('carries the whole profile list as one JSON field', () => {
    const profiles = [
      buildLanguageProfile(['es-419']),
      { ...buildLanguageProfile(['en']), profileId: 2 },
    ];

    const form = encodeSettingsForm([languageProfilesEntry(profiles)]);

    expect(form.getAll('languages-profiles')).toHaveLength(1);
    expect(JSON.parse(form.get('languages-profiles') as string)).toEqual(profiles);
  });
});

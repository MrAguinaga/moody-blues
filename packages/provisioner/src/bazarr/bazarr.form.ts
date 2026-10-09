import type { LanguageProfile, SettingsEntry, SettingsValue } from './bazarr.types';

export function settingsKey(section: string, key: string): string {
  return `settings-${section}-${key}`;
}

export function settingsEntry(section: string, key: string, value: SettingsValue): SettingsEntry {
  return { key: settingsKey(section, key), value };
}

function formValues(value: SettingsValue): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  return value.length === 0 ? [''] : [...value];
}

export function encodeSettingsForm(entries: readonly SettingsEntry[]): URLSearchParams {
  const form = new URLSearchParams();
  for (const { key, value } of entries) {
    for (const item of formValues(value)) {
      form.append(key, item);
    }
  }
  return form;
}

export function enabledLanguagesEntry(codes: readonly string[]): SettingsEntry {
  return { key: 'languages-enabled', value: codes };
}

export function languageProfilesEntry(profiles: readonly LanguageProfile[]): SettingsEntry {
  return { key: 'languages-profiles', value: JSON.stringify(profiles) };
}

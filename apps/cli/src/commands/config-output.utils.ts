import {
  CONFIG_SETTINGS,
  type ConfigPlanView,
  type ConfigRunReport,
  type SettingView,
} from '../config';

export function formatSettingsLines(settings: SettingView[]): string[] {
  const keyWidth = Math.max(...settings.map(({ key }) => key.length)) + 2;
  const valueWidth = Math.max(...settings.map(({ value }) => value.length)) + 2;

  return settings.map(({ key, value, allowed, writable }) => {
    const description = writable
      ? allowed.join(' | ')
      : (CONFIG_SETTINGS[key].readOnlyNote ?? 'read-only');
    return `  ${key.padEnd(keyWidth)}${value.padEnd(valueWidth)}${description}`;
  });
}

export function toSettingsJson(settings: SettingView[]) {
  return {
    settings: settings.map(({ key, value, allowed, writable }) => ({
      key,
      value,
      allowed,
      writable,
    })),
  };
}

export function formatPlanLines(plan: ConfigPlanView): string[] {
  return [
    `${plan.key}: ${plan.previous} -> ${plan.value}`,
    `Affected steps: ${plan.stepIds.join(', ')}`,
    ...plan.notes.map((note) => `⚠ ${note}`),
  ];
}

export function toConfigRunJson(report: ConfigRunReport) {
  const { success, key, previous, value, changed, steps, pipeline } = report;
  return { success, key, previous, value, changed, steps, pipeline };
}

export function toConfigRefusedJson(plan: ConfigPlanView, error: string) {
  return {
    success: false,
    key: plan.key,
    previous: plan.previous,
    value: plan.value,
    changed: plan.previous !== plan.value,
    steps: plan.stepIds,
    error,
  };
}

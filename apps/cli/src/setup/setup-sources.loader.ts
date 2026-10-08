import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createLayout,
  type MbHomeLayout,
  parseEnvFile,
  readEnv,
  readState,
  resolveMbHome,
} from '@moody-blues/provisioner';

import type { SetupSources, SetupValues } from './setup.types';
import { ENV_FILE_ACCEPTED_KEYS, SETUP_VALUE_ENV_KEYS } from './setup-env.constants';

const SECRET_FIELDS = [
  'rdApiToken',
  'adminUsername',
  'adminPassword',
  'opensubtitlesUsername',
  'opensubtitlesPassword',
] as const;

export interface LoadSetupSourcesOptions {
  flags: SetupValues;
  envFile?: string;
  home?: string;
}

export interface LoadedSetupSources {
  layout: MbHomeLayout;
  sources: SetupSources;
}

function pickFields(
  record: Record<string, string>,
  fields: readonly (keyof typeof SETUP_VALUE_ENV_KEYS)[],
): SetupValues {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = record[SETUP_VALUE_ENV_KEYS[field]];
    if (value !== undefined) {
      values[field] = value;
    }
  }
  return values;
}

export function parseSetupEnvRecord(record: Record<string, string>): {
  values: SetupValues;
  ignoredKeys: string[];
} {
  return {
    values: pickFields(record, ['mode', 'domain', 'acmeEmail', 'transcoding', ...SECRET_FIELDS]),
    ignoredKeys: Object.keys(record)
      .filter((key) => !ENV_FILE_ACCEPTED_KEYS.includes(key))
      .sort(),
  };
}

function readEnvFile(path: string): Record<string, string> {
  const absolute = resolve(path);
  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(
      code === 'ENOENT'
        ? `Environment file not found: ${absolute}`
        : `Could not read the environment file ${absolute}: ${(error as Error).message}`,
    );
  }

  try {
    return parseEnvFile(text);
  } catch (error) {
    throw new Error(`Invalid environment file ${absolute}: ${(error as Error).message}`);
  }
}

export function loadSetupSources(options: LoadSetupSourcesOptions): LoadedSetupSources {
  const layout = createLayout(resolveMbHome({ explicit: options.home }));
  const previousConfig = readState(layout.stateFile);

  const fromFile = options.envFile
    ? parseSetupEnvRecord(readEnvFile(options.envFile))
    : { values: {}, ignoredKeys: [] };

  const previous: SetupValues = {
    ...pickFields(readEnv(layout.envFile), SECRET_FIELDS),
    ...(previousConfig && {
      mode: previousConfig.mode,
      domain: previousConfig.domain,
      acmeEmail: previousConfig.acme.email,
      acmeStaging: previousConfig.acme.staging,
      transcoding: previousConfig.transcoding,
    }),
  };

  return {
    layout,
    sources: {
      flags: options.flags,
      envFile: fromFile.values,
      previous,
      previousConfig,
      ignoredKeys: fromFile.ignoredKeys,
    },
  };
}

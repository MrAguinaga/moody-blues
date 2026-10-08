import {
  createDefaultConfig,
  DEPLOY_MODES,
  type DeployMode,
  type MoodyBluesConfig,
  parseConfig,
  TRANSCODING_MODES,
  type TranscodingMode,
} from '@moody-blues/provisioner';

import type {
  SetupIssue,
  SetupResolution,
  SetupResolverDeps,
  SetupSources,
  SetupValues,
} from './setup.types';
import { SETUP_VALUE_ENV_KEYS } from './setup-env.constants';

const LOCAL_DOMAIN = 'localhost';
const REQUIRED_SECRETS = ['rdApiToken', 'adminUsername', 'adminPassword'] as const;
const CONFIG_ISSUE_KEYS: Record<string, string> = {
  domain: SETUP_VALUE_ENV_KEYS.domain,
  'acme.email': SETUP_VALUE_ENV_KEYS.acmeEmail,
};

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function mergeSetupValues(...layers: (SetupValues | undefined)[]): SetupValues {
  const merged: Record<string, string | boolean> = {};
  for (const layer of [...layers].reverse()) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      const normalized = typeof value === 'string' ? normalize(value) : value;
      if (normalized !== undefined) {
        merged[key] = normalized;
      }
    }
  }
  return merged as SetupValues;
}

function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  key: string,
  issues: SetupIssue[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = allowed.find((candidate) => candidate === value);
  if (!match) {
    issues.push({
      key,
      problem: 'invalid',
      message: `${key} must be one of: ${allowed.join(', ')}`,
    });
  }
  return match;
}

function domainCandidate(explicit: SetupValues, previous: SetupValues): string | undefined {
  const inherited = previous.domain?.toLowerCase();
  return explicit.domain?.toLowerCase() ?? (inherited !== LOCAL_DOMAIN ? inherited : undefined);
}

function validateLocalDomain(explicit: SetupValues, issues: SetupIssue[]): void {
  const requested = explicit.domain?.toLowerCase();
  if (requested && requested !== LOCAL_DOMAIN) {
    issues.push({
      key: SETUP_VALUE_ENV_KEYS.domain,
      problem: 'invalid',
      message: `${SETUP_VALUE_ENV_KEYS.domain} cannot be set in local mode; use mode "remote" for a public domain`,
    });
  }
}

function buildConfig(
  sources: SetupSources,
  resolved: {
    mode: DeployMode;
    domain: string;
    transcoding: TranscodingMode;
    values: SetupValues;
    storageEnabled: boolean;
  },
): MoodyBluesConfig {
  const base = sources.previousConfig ?? createDefaultConfig();
  const { mode, domain, transcoding, values, storageEnabled } = resolved;

  return {
    ...base,
    mode,
    domain,
    transcoding,
    acme: {
      staging: values.acmeStaging ?? false,
      ...(values.acmeEmail && { email: values.acmeEmail }),
    },
    storage: { ...base.storage, enabled: storageEnabled },
  };
}

function issueFromConfigError(message: string): SetupIssue {
  const path = message.split(':')[0] ?? '';
  const key = CONFIG_ISSUE_KEYS[path] ?? 'config';
  return { key, problem: 'invalid', message: `${key}: ${message.slice(path.length + 1).trim()}` };
}

export async function resolveSetupInput(
  sources: SetupSources,
  deps: SetupResolverDeps,
): Promise<SetupResolution> {
  const { ignoredKeys } = sources;
  const explicit = mergeSetupValues(sources.answers, sources.flags, sources.envFile);
  const values = mergeSetupValues(explicit, sources.previous);
  const issues: SetupIssue[] = [];

  const mode = pickEnum(values.mode, DEPLOY_MODES, SETUP_VALUE_ENV_KEYS.mode, issues);
  const transcoding = pickEnum(
    values.transcoding,
    TRANSCODING_MODES,
    SETUP_VALUE_ENV_KEYS.transcoding,
    issues,
  );
  const candidate = domainCandidate(explicit, sources.previous);
  const effectiveMode = mode ?? 'local';
  if (effectiveMode === 'local') {
    validateLocalDomain(explicit, issues);
  } else if (!candidate) {
    issues.push({
      key: SETUP_VALUE_ENV_KEYS.domain,
      problem: 'missing',
      message: `${SETUP_VALUE_ENV_KEYS.domain} is required in remote mode`,
    });
  }
  for (const field of REQUIRED_SECRETS) {
    if (!values[field]) {
      const key = SETUP_VALUE_ENV_KEYS[field];
      issues.push({ key, problem: 'missing', message: `${key} is required` });
    }
  }

  const draft: SetupValues = { ...values, domain: candidate };
  if (issues.length > 0) {
    return { complete: false, issues, draft, ignoredKeys };
  }

  const storageEnabled = await deps.detectStorage();
  const config = buildConfig(sources, {
    mode: effectiveMode,
    domain: effectiveMode === 'local' ? LOCAL_DOMAIN : candidate!,
    transcoding: transcoding ?? 'off',
    values,
    storageEnabled,
  });

  const parsed = parseConfig(config);
  if (!parsed.ok) {
    return { complete: false, issues: parsed.error.map(issueFromConfigError), draft, ignoredKeys };
  }

  return {
    complete: true,
    ignoredKeys,
    input: {
      config: parsed.value,
      secrets: {
        rdApiToken: values.rdApiToken!,
        adminUsername: values.adminUsername!,
        adminPassword: values.adminPassword!,
        ...(values.opensubtitlesUsername && {
          opensubtitlesUsername: values.opensubtitlesUsername,
        }),
        ...(values.opensubtitlesPassword && {
          opensubtitlesPassword: values.opensubtitlesPassword,
        }),
      },
    },
  };
}

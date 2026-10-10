import { z } from 'zod';

import type { Result } from '../result.types';
import {
  CONFIG_SCHEMA_VERSION,
  DEPLOY_MODES,
  type MoodyBluesConfig,
  TRANSCODING_MODES,
} from './config.types';

const FQDN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const nonEmpty = z.string().trim().min(1);

const acmeSchema = z.object({
  email: z.email().optional(),
  staging: z.boolean(),
});

const storageSchema = z.object({
  enabled: z.boolean(),
  downloadUncached: z.boolean(),
});

const tierSchema = z.object({
  id: nonEmpty,
  label: nonEmpty,
  maxResolution: nonEmpty,
});

const languagesSchema = z.object({
  ui: nonEmpty,
  audioPriority: z.array(nonEmpty).min(1),
  subtitles: z.array(nonEmpty),
});

const hostSchema = z.object({
  puid: z.number().int().nonnegative(),
  pgid: z.number().int().nonnegative(),
});

const updateCheckSchema = z.object({
  checkedAt: z.iso.datetime(),
  tag: nonEmpty,
  url: nonEmpty,
  body: z.string(),
});

export const configSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION, {
      error: `Unsupported schemaVersion, expected ${CONFIG_SCHEMA_VERSION}`,
    }),
    mode: z.enum(DEPLOY_MODES),
    domain: nonEmpty,
    acme: acmeSchema,
    transcoding: z.enum(TRANSCODING_MODES),
    storage: storageSchema,
    tiers: z.array(tierSchema).min(1),
    languages: languagesSchema,
    timezone: nonEmpty,
    host: hostSchema,
    provisionedVersion: nonEmpty,
    updateCheck: updateCheckSchema.optional(),
  })
  .superRefine((config, ctx) => {
    if (config.mode === 'local' && config.domain !== 'localhost') {
      ctx.addIssue({
        code: 'custom',
        path: ['domain'],
        message: 'Domain must be "localhost" in local mode',
      });
    }
    if (
      config.mode === 'remote' &&
      (config.domain === 'localhost' || !FQDN_PATTERN.test(config.domain))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['domain'],
        message: 'Domain must be a valid FQDN other than "localhost" in remote mode',
      });
    }
  });

export function parseConfig(input: unknown): Result<MoodyBluesConfig> {
  const parsed = configSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    error: parsed.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

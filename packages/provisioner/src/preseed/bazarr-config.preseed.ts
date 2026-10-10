import { createHash } from 'node:crypto';

import { parse, stringify } from 'yaml';

import { BASE_PROVIDERS, OPENSUBTITLES_PROVIDER } from '../bazarr/bazarr.settings';
import { SERVICE_CATALOG } from '../services';
import type { BazarrSeedInput } from './preseed.types';

const DEFAULT_LANGUAGE_PROFILE = 1;

export function readBazarrApiKey(content: string): string | undefined {
  const parsed = parse(content) as { auth?: { apikey?: unknown } } | null;
  const apiKey = parsed?.auth?.apikey;
  return apiKey === undefined || apiKey === null ? undefined : String(apiKey);
}

export function renderBazarrConfig(input: BazarrSeedInput): string {
  const apiKey = input.apiKey.trim();
  if (!/[a-z]/i.test(apiKey)) {
    throw new Error('The Bazarr API key must contain at least one letter');
  }
  if (!input.sonarrApiKey.trim() || !input.radarrApiKey.trim()) {
    throw new Error('The Sonarr and Radarr API keys must not be empty');
  }

  const { sonarr, radarr } = SERVICE_CATALOG;
  const { opensubtitles } = input;
  const providers = [...BASE_PROVIDERS, ...(opensubtitles ? [OPENSUBTITLES_PROVIDER] : [])];

  const config: Record<string, unknown> = {
    general: {
      ip: '*',
      port: SERVICE_CATALOG.bazarr.port,
      base_url: '',
      instance_name: 'Bazarr',
      auto_update: false,
      use_sonarr: true,
      use_radarr: true,
      enabled_providers: providers,
      serie_default_enabled: true,
      serie_default_profile: DEFAULT_LANGUAGE_PROFILE,
      movie_default_enabled: true,
      movie_default_profile: DEFAULT_LANGUAGE_PROFILE,
      use_embedded_subs: true,
      path_mappings: [],
      path_mappings_movie: [],
    },
    auth: {
      type: 'form',
      username: input.adminUsername,
      password: createHash('md5').update(input.adminPassword).digest('hex'),
      apikey: apiKey,
    },
    sonarr: {
      ip: sonarr.id,
      port: sonarr.port,
      base_url: '',
      ssl: false,
      apikey: input.sonarrApiKey,
    },
    radarr: {
      ip: radarr.id,
      port: radarr.port,
      base_url: '',
      ssl: false,
      apikey: input.radarrApiKey,
    },
  };

  if (opensubtitles) {
    config[OPENSUBTITLES_PROVIDER] = {
      username: opensubtitles.username,
      password: opensubtitles.password,
    };
  }

  return stringify(config, { defaultStringType: 'QUOTE_SINGLE', defaultKeyType: 'PLAIN' });
}

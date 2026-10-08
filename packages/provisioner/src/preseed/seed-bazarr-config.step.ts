import { join } from 'node:path';

import type { ProvisionStep } from '../pipeline/pipeline.types';
import { loadServiceKeys } from '../services';
import { readBazarrApiKey, renderBazarrConfig } from './bazarr-config.preseed';
import type { OpenSubtitlesCredentials } from './preseed.types';
import { ensureSeedFile } from './seed-file';

export const seedBazarrConfigStep: ProvisionStep = {
  id: 'seed-bazarr-config',
  title: 'Seed Bazarr configuration',
  scopes: ['setup', 'reset'],
  run: async ({ layout, identity, secrets }) => {
    const keys = loadServiceKeys(layout);
    const opensubtitles: OpenSubtitlesCredentials | undefined =
      secrets.opensubtitlesUsername && secrets.opensubtitlesPassword
        ? { username: secrets.opensubtitlesUsername, password: secrets.opensubtitlesPassword }
        : undefined;

    const outcome = ensureSeedFile(
      join(layout.configFor('bazarr'), 'config', 'config.yaml'),
      renderBazarrConfig({
        apiKey: keys.bazarrApiKey,
        sonarrApiKey: keys.sonarrApiKey,
        radarrApiKey: keys.radarrApiKey,
        adminUsername: secrets.adminUsername,
        adminPassword: secrets.adminPassword,
        opensubtitles,
      }),
      {
        ownership: { identity },
        expectedKey: { label: 'API key', value: keys.bazarrApiKey, read: readBazarrApiKey },
      },
    );

    return { status: outcome.status === 'created' ? 'changed' : 'unchanged' };
  },
};

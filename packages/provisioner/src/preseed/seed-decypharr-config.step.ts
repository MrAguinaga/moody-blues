import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import type { ProvisionStep } from '../pipeline/pipeline.types';
import { loadServiceKeys } from '../services';
import {
  readDecypharrAuthToken,
  readDecypharrConfigToken,
  renderDecypharrAuth,
  renderDecypharrConfig,
} from './decypharr-config.preseed';
import { ensureSeedFile } from './seed-file';

const SECRET_BYTES = 32;

function randomHex(): string {
  return randomBytes(SECRET_BYTES).toString('hex');
}

export const seedDecypharrConfigStep: ProvisionStep = {
  id: 'seed-decypharr-config',
  title: 'Seed Decypharr configuration',
  scopes: ['setup', 'reset'],
  run: async ({ config, layout, identity, secrets }) => {
    const keys = loadServiceKeys(layout);
    const directory = layout.configFor('decypharr');
    const ownership = { identity };

    const configOutcome = ensureSeedFile(
      join(directory, 'config.json'),
      renderDecypharrConfig({
        rdApiToken: secrets.rdApiToken,
        apiToken: keys.decypharrApiToken,
        sonarrApiKey: keys.sonarrApiKey,
        radarrApiKey: keys.radarrApiKey,
        downloadUncached: config.storage.downloadUncached,
        host: identity,
        sessionSecret: randomHex(),
        strmSecret: randomHex(),
      }),
      {
        ownership,
        expectedKey: {
          label: 'Sonarr token',
          value: keys.sonarrApiKey,
          read: readDecypharrConfigToken,
        },
      },
    );

    const authOutcome = ensureSeedFile(
      join(directory, 'auth.json'),
      await renderDecypharrAuth({
        adminUsername: secrets.adminUsername,
        adminPassword: secrets.adminPassword,
        apiToken: keys.decypharrApiToken,
        sessionVersion: randomHex(),
      }),
      {
        ownership,
        expectedKey: {
          label: 'API token',
          value: keys.decypharrApiToken,
          read: readDecypharrAuthToken,
        },
      },
    );

    const created = [configOutcome, authOutcome].filter(({ status }) => status === 'created');
    return created.length > 0
      ? { status: 'changed', detail: `${created.length} files written` }
      : { status: 'unchanged' };
  },
};

import { join } from 'node:path';

import type { ProvisionStep } from '../pipeline/pipeline.types';
import { loadServiceKeys } from '../services';
import { readArrApiKey, renderArrConfigXml } from './arr-config.preseed';
import type { ArrService } from './preseed.types';
import { ensureSeedFile } from './seed-file';

export const seedArrConfigStep: ProvisionStep = {
  id: 'seed-arr-config',
  title: 'Seed Sonarr, Radarr and Prowlarr configuration',
  scopes: ['setup', 'reset'],
  run: async ({ layout, identity }) => {
    const keys = loadServiceKeys(layout);
    const apiKeys: Record<ArrService, string> = {
      sonarr: keys.sonarrApiKey,
      radarr: keys.radarrApiKey,
      prowlarr: keys.prowlarrApiKey,
    };

    let created = 0;
    for (const [service, apiKey] of Object.entries(apiKeys) as [ArrService, string][]) {
      const outcome = ensureSeedFile(
        join(layout.configFor(service), 'config.xml'),
        renderArrConfigXml({ service, apiKey }),
        {
          ownership: { identity },
          expectedKey: { label: 'ApiKey', value: apiKey, read: readArrApiKey },
        },
      );
      if (outcome.status === 'created') created += 1;
    }

    return created > 0
      ? { status: 'changed', detail: `${created} files written` }
      : { status: 'unchanged' };
  },
};

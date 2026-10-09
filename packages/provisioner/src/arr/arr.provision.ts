import {
  applyFieldValues,
  fieldsMatch,
  type ProviderResource,
  valuesEqual,
} from '../http/provider-fields';
import { waitUntilReady, type WaitUntilReadyOptions } from '../http/ready.http';
import { ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { loadServiceKeys, SERVICE_CATALOG } from '../services';
import { readIssuedKey } from '../state/issued-keys.service';
import {
  type ArrClient,
  type ArrClientOptions,
  createArrClient,
  patchSingleton,
} from './arr.client';
import {
  buildDecypharrClient,
  buildDownloadClientConfigSettings,
  buildIndexerSettings,
  buildJellyfinConnection,
  buildMediaManagementSettings,
  buildNamingSettings,
  buildReleaseExclusions,
  buildUiSettings,
  DECYPHARR_CLIENT_NAME,
  DECYPHARR_IMPLEMENTATION,
  JELLYFIN_CONNECTION_NAME,
  JELLYFIN_IMPLEMENTATION,
  RELEASE_EXCLUSIONS_NAME,
  resolveUiLanguageId,
  ROOT_FOLDER_PATHS,
} from './arr.settings';
import type {
  ArrKind,
  DownloadClientResource,
  NotificationResource,
  ReleaseProfileResource,
} from './arr.types';

const ARR_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];
const ARR_TITLES: Readonly<Record<ArrKind, string>> = {
  sonarr: 'Provision Sonarr',
  radarr: 'Provision Radarr',
};

export type ArrReadyOptions = Pick<WaitUntilReadyOptions, 'timeoutMs' | 'sleep' | 'now' | 'random'>;

export type ArrStepOverrides = Pick<ArrClientOptions, 'fetch' | 'sleep' | 'random' | 'retry'> & {
  ready?: ArrReadyOptions;
};

export interface ProvisionArrOptions {
  kind: ArrKind;
  client: ArrClient;
  apiKey: string;
  jellyfinApiKey?: string;
  signal: AbortSignal;
  ready?: ArrReadyOptions;
}

const trimSlash = (path: string) => path.replace(/\/+$/, '');

async function ensureRootFolder(client: ArrClient, path: string): Promise<boolean> {
  const folders = await client.listRootFolders();
  if (folders.some((folder) => trimSlash(folder.path) === path)) {
    return false;
  }
  await client.createRootFolder(path);
  return true;
}

function downloadClientMatches(
  existing: DownloadClientResource,
  settings: ReturnType<typeof buildDecypharrClient>,
): boolean {
  const propertiesMatch = Object.entries(settings.properties).every(([key, value]) =>
    valuesEqual(existing[key], value),
  );
  return propertiesMatch && fieldsMatch(existing, settings.comparableFields);
}

async function ensureDecypharrClient(
  client: ArrClient,
  apiKey: string,
  storageEnabled: boolean,
): Promise<string | undefined> {
  const settings = buildDecypharrClient(client.kind, apiKey);
  const existing = (await client.listDownloadClients()).find(
    (candidate) => candidate.name === DECYPHARR_CLIENT_NAME,
  );
  const forceSave = !storageEnabled;

  if (existing) {
    if (downloadClientMatches(existing, settings)) {
      return undefined;
    }
    await client.updateDownloadClient(
      { ...applyFieldValues(existing, settings.fields), ...settings.properties },
      { forceSave },
    );
    return 'updated download client';
  }

  const template = (await client.getDownloadClientSchema()).find(
    (candidate) => candidate.implementation === DECYPHARR_IMPLEMENTATION,
  );
  if (!template) {
    throw new Error(`${client.kind} offers no ${DECYPHARR_IMPLEMENTATION} download client schema`);
  }
  const resource: DownloadClientResource = {
    ...applyFieldValues(template, settings.fields),
    ...settings.properties,
  };
  if (storageEnabled) {
    await client.createDownloadClient(resource);
    return 'created download client';
  }
  // Creating an enabled client always runs a connection test that forceSave does not skip;
  // only updates honor it, so the client is created disabled and then enabled without the test.
  const created = await client.createDownloadClient({ ...resource, enable: false });
  await client.updateDownloadClient(
    { ...applyFieldValues(created, settings.fields), ...settings.properties },
    { forceSave },
  );
  return 'created download client without connection test';
}

const sameSet = <T>(left: readonly T[], right: readonly T[]) =>
  left.every((item) => right.includes(item)) && right.every((item) => left.includes(item));

function releaseProfileMatches(
  existing: ReleaseProfileResource,
  desired: ReleaseProfileResource,
): boolean {
  return (
    existing.enabled === desired.enabled &&
    existing.indexerId === desired.indexerId &&
    sameSet(existing.ignored, desired.ignored) &&
    sameSet(existing.required, desired.required) &&
    sameSet(existing.tags, desired.tags)
  );
}

async function ensureReleaseExclusions(client: ArrClient): Promise<string | undefined> {
  const desired = buildReleaseExclusions();
  const existing = (await client.listReleaseProfiles()).find(
    (candidate) => candidate.name === RELEASE_EXCLUSIONS_NAME,
  );
  if (!existing) {
    await client.createReleaseProfile(desired);
    return 'release exclusions';
  }
  if (releaseProfileMatches(existing, desired)) {
    return undefined;
  }
  await client.updateReleaseProfile({ ...existing, ...desired });
  return 'release exclusions';
}

const isBlank = (value: unknown) => value === undefined || value === null || value === '';

function connectionFieldsMatch(
  existing: ProviderResource,
  desired: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(desired).every(([name, value]) => {
    const actual = existing.fields.find((candidate) => candidate.name === name)?.value;
    return isBlank(value) ? isBlank(actual) : valuesEqual(actual, value);
  });
}

function jellyfinConnectionMatches(
  existing: NotificationResource,
  settings: ReturnType<typeof buildJellyfinConnection>,
): boolean {
  const propertiesMatch = Object.entries(settings.properties).every(([key, value]) =>
    valuesEqual(existing[key], value),
  );
  return propertiesMatch && connectionFieldsMatch(existing, settings.comparableFields);
}

async function saveJellyfinConnection(
  client: ArrClient,
  settings: ReturnType<typeof buildJellyfinConnection>,
): Promise<string | undefined> {
  const existing = (await client.listNotifications()).find(
    (candidate) => candidate.name === JELLYFIN_CONNECTION_NAME,
  );

  if (existing) {
    if (jellyfinConnectionMatches(existing, settings)) {
      return undefined;
    }
    await client.updateNotification({
      ...applyFieldValues(existing, settings.fields),
      ...settings.properties,
    });
    return 'Jellyfin connection';
  }

  const template = (await client.getNotificationSchema()).find(
    (candidate) => candidate.implementation === JELLYFIN_IMPLEMENTATION,
  );
  if (!template) {
    throw new Error(`${client.kind} offers no ${JELLYFIN_IMPLEMENTATION} connection schema`);
  }
  await client.createNotification({
    ...applyFieldValues(template, settings.fields),
    ...settings.properties,
  });
  return 'Jellyfin connection';
}

async function ensureJellyfinConnection(
  client: ArrClient,
  jellyfinApiKey: string | undefined,
): Promise<string | undefined> {
  if (!jellyfinApiKey) {
    throw new Error(
      'The Jellyfin API key is missing from the environment file; ' +
        'run the Jellyfin provisioning step before the Jellyfin connection',
    );
  }
  try {
    return await saveJellyfinConnection(
      client,
      buildJellyfinConnection(client.kind, jellyfinApiKey),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes(jellyfinApiKey)) {
      error.message = error.message.split(jellyfinApiKey).join('***');
    }
    throw error;
  }
}

export async function provisionArr(
  ctx: ProvisionContext,
  options: ProvisionArrOptions,
): Promise<StepOutcome> {
  const { kind, client, apiKey, jellyfinApiKey, signal } = options;
  const label = kind === 'sonarr' ? 'Sonarr' : 'Radarr';
  const changes: string[] = [];
  const record = (change: string | false | undefined) => {
    if (change) changes.push(change);
  };
  const progress = (message: string) => ctx.reportProgress?.(message);

  progress(`Waiting for ${label}`);
  await waitUntilReady(client.http, {
    service: label,
    readyPath: '/ping',
    verify: () => client.getSystemStatus(),
    signal,
    ...options.ready,
  });

  progress('Configuring administrator account');
  const { adminUsername, adminPassword } = ctx.secrets;
  record(
    (await client.ensureAdminUser({
      username: adminUsername,
      password: adminPassword,
      rotate: ctx.flags.get(ROTATE_CREDENTIALS_FLAG) === true,
    })) && 'administrator account',
  );

  progress('Configuring root folder');
  record((await ensureRootFolder(client, ROOT_FOLDER_PATHS[kind])) && 'root folder');

  progress('Configuring download client');
  record(await ensureDecypharrClient(client, apiKey, ctx.config.storage.enabled));

  progress('Configuring download handling');
  record(
    (await patchSingleton(client, 'downloadclient', buildDownloadClientConfigSettings(kind))) &&
      'download handling',
  );

  progress('Configuring media management');
  record(
    (await patchSingleton(client, 'mediamanagement', buildMediaManagementSettings())) &&
      'media management',
  );

  progress('Configuring naming');
  record((await patchSingleton(client, 'naming', buildNamingSettings(kind))) && 'naming');

  progress('Configuring interface language');
  const languageId = resolveUiLanguageId(await client.listLanguages(), ctx.config.languages.ui);
  if (languageId === undefined) {
    throw new Error(`${label} offers no language matching "${ctx.config.languages.ui}"`);
  }
  record((await patchSingleton(client, 'ui', buildUiSettings(languageId))) && 'interface language');

  progress('Configuring indexer options');
  record(
    (await patchSingleton(client, 'indexer', buildIndexerSettings(kind))) && 'indexer options',
  );

  progress('Configuring release exclusions');
  record(await ensureReleaseExclusions(client));

  progress('Configuring Jellyfin connection');
  record(await ensureJellyfinConnection(client, jellyfinApiKey));

  const issues = (await client.getHealth()).filter((entry) => entry.type !== 'ok');
  if (issues.length > 0) {
    progress(`${label} health: ${issues.map((issue) => issue.message).join('; ')}`);
  }

  return changes.length > 0
    ? { status: 'changed', detail: changes.join(', ') }
    : { status: 'unchanged' };
}

export function createArrProvisionStep(
  kind: ArrKind,
  overrides: ArrStepOverrides = {},
): ProvisionStep {
  const { ready, ...clientOverrides } = overrides;
  return {
    id: `${kind}-provision`,
    title: ARR_TITLES[kind],
    scopes: ARR_STEP_SCOPES,
    run: async (ctx, signal) => {
      const keys = loadServiceKeys(ctx.layout);
      const apiKey = kind === 'sonarr' ? keys.sonarrApiKey : keys.radarrApiKey;
      const client = createArrClient({
        kind,
        baseUrl: SERVICE_CATALOG[kind].hostUrl,
        apiKey,
        signal,
        ...clientOverrides,
      });
      return provisionArr(ctx, {
        kind,
        client,
        apiKey,
        jellyfinApiKey: readIssuedKey(ctx.layout.envFile, 'JELLYFIN_API_KEY'),
        signal,
        ready,
      });
    },
  };
}

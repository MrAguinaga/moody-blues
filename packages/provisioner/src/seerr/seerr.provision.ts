import type { ArrClient } from '../arr/arr.client';
import { ROOT_FOLDER_PATHS } from '../arr/arr.settings';
import { HttpStatusError } from '../http/http.errors';
import { driftedKeys } from '../jellyfin/jellyfin.settings';
import type { ProvisionContext, StepOutcome } from '../pipeline/pipeline.types';
import { MASTER_PROFILE_NAME } from '../profile/master-profile.plan';
import { SERVICE_CATALOG } from '../services/service-catalog';
import type { SeerrClient, SeerrReadyOptions } from './seerr.client';
import { ARR_INSTANCE_NAMES, MEDIA_SERVER_UNCONFIGURED } from './seerr.constants';
import {
  arrApiKeyReadable,
  arrInstanceDrift,
  buildArrConnection,
  buildArrInstance,
  buildJellyfinConnectionUpdate,
  desiredExternalHostname,
  desiredMainSettings,
  type ProfileReference,
} from './seerr.settings';
import type { SeerrArrKind, SeerrLibrary } from './seerr.types';

export interface ProvisionSeerrOptions {
  client: SeerrClient;
  arrs: Readonly<Record<SeerrArrKind, ArrClient>>;
  arrApiKeys: Readonly<Record<SeerrArrKind, string>>;
  signal: AbortSignal;
  ready?: SeerrReadyOptions;
}

const ARR_KINDS: readonly SeerrArrKind[] = ['sonarr', 'radarr'];
const UNAUTHENTICATED_STATUSES: readonly number[] = [401, 403];
const RESET_HINT = 'Run "moody-blues reset --fresh" to start over';

const isStatus = (error: unknown, statuses: readonly number[]): error is HttpStatusError =>
  error instanceof HttpStatusError && statuses.includes(error.status);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

async function ensureAdministrator(
  client: SeerrClient,
  mediaServerType: number,
  credentials: { username: string; password: string },
): Promise<boolean> {
  try {
    await client.whoAmI();
    return false;
  } catch (error) {
    if (!isStatus(error, UNAUTHENTICATED_STATUSES)) {
      throw error;
    }
    if (mediaServerType !== MEDIA_SERVER_UNCONFIGURED) {
      throw new Error(
        `Seerr rejects its API key although a media server is already configured, so the ` +
          `instance was left half-initialized. ${RESET_HINT}`,
      );
    }
  }

  try {
    await client.loginWithJellyfin({
      ...credentials,
      hostname: SERVICE_CATALOG.jellyfin.id,
      port: SERVICE_CATALOG.jellyfin.port,
    });
  } catch (error) {
    throw new Error(
      `Seerr could not sign in to Jellyfin as the administrator: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
  await client.whoAmI();
  return true;
}

async function syncAndEnableLibraries(client: SeerrClient): Promise<SeerrLibrary[]> {
  let libraries: SeerrLibrary[];
  try {
    libraries = await client.syncLibraries();
  } catch (error) {
    if (isStatus(error, [404])) {
      throw new Error(
        'Jellyfin has no libraries for Seerr to sync; run the jellyfin-provision step first',
        { cause: error },
      );
    }
    throw error;
  }
  if (libraries.length === 0) {
    throw new Error(
      'Jellyfin has no libraries for Seerr to sync; run the jellyfin-provision step first',
    );
  }
  const disabled = libraries.filter((library) => !library.enabled);
  for (const library of disabled) {
    await client.enableLibrary(library.id);
  }
  return disabled;
}

async function resolveProfile(arr: ArrClient, label: string): Promise<ProfileReference> {
  const profiles = await arr.listQualityProfiles();
  const profile = profiles.find((candidate) => candidate.name === MASTER_PROFILE_NAME);
  if (!profile?.id) {
    throw new Error(
      `${label} has no quality profile named "${MASTER_PROFILE_NAME}"; run the master-profile step first`,
    );
  }
  return { id: profile.id, name: profile.name };
}

async function requireRootFolder(arr: ArrClient, label: string, path: string): Promise<void> {
  const folders = await arr.listRootFolders();
  if (!folders.some((folder) => trimSlash(folder.path) === path)) {
    throw new Error(`${label} has no root folder ${path}; run its provisioning step first`);
  }
}

async function ensureArrInstance(
  options: ProvisionSeerrOptions,
  kind: SeerrArrKind,
  notes: string[],
): Promise<string | undefined> {
  const { client, arrs } = options;
  const label = ARR_INSTANCE_NAMES[kind];
  const directory = ROOT_FOLDER_PATHS[kind];
  const arr = arrs[kind];
  const profile = await resolveProfile(arr, label);
  await requireRootFolder(arr, label, directory);

  const desired = buildArrInstance(kind, {
    apiKey: options.arrApiKeys[kind],
    profile,
    directory,
  });
  const existing = (await client.listArrInstances(kind)).find(
    (instance) => instance.name === desired.name,
  );

  if (!existing) {
    await client.testArr(kind, buildArrConnection(desired));
    await client.createArrInstance(kind, desired);
    return `created ${label} server`;
  }

  if (!arrApiKeyReadable(existing)) {
    notes.push(
      `the ${label} API key stored in Seerr could not be read back, so it was not compared`,
    );
  }
  const drift = arrInstanceDrift(existing, desired);
  if (drift.length === 0) {
    return undefined;
  }
  await client.updateArrInstance(kind, existing.id as number, desired);
  return `updated ${label} server (${drift.join(', ')})`;
}

export async function provisionSeerr(
  ctx: ProvisionContext,
  options: ProvisionSeerrOptions,
): Promise<StepOutcome> {
  const { client, signal } = options;
  const { config, secrets } = ctx;
  const changes: string[] = [];
  const notes: string[] = [];
  const progress = (message: string) => ctx.reportProgress?.(message);

  const desiredMain = desiredMainSettings(config);

  progress('Waiting for Seerr');
  await client.waitReady({ signal, ...options.ready });
  const publicSettings = await client.getPublicSettings();

  progress('Checking the administrator');
  const signedIn = await ensureAdministrator(client, publicSettings.mediaServerType, {
    username: secrets.adminUsername,
    password: secrets.adminPassword,
  });
  if (signedIn) {
    changes.push('signed in with the Jellyfin administrator');
  }

  progress('Checking main settings');
  const main = await client.getMainSettings();
  const mainDrift = driftedKeys(main, desiredMain);
  if (mainDrift.length > 0) {
    await client.saveMainSettings(
      Object.fromEntries(
        mainDrift.map((key) => [key, desiredMain[key as keyof typeof desiredMain]]),
      ),
    );
    changes.push(`main settings ${mainDrift.join(', ')}`);
  }

  progress('Checking the Jellyfin connection');
  const jellyfin = await client.getJellyfinSettings();
  const externalHostname = desiredExternalHostname(config.domain);
  if (jellyfin.externalHostname !== externalHostname) {
    try {
      if (!jellyfin.apiKey) {
        throw new Error('Seerr did not return its Jellyfin connection key');
      }
      await client.saveJellyfinSettings(
        buildJellyfinConnectionUpdate({ ...jellyfin, apiKey: jellyfin.apiKey }, externalHostname),
      );
      changes.push('Jellyfin external hostname');
    } catch (error) {
      notes.push(`the Jellyfin external hostname was not set: ${errorMessage(error)}`);
    }
  }

  progress('Checking libraries');
  const libraries = jellyfin.libraries ?? [];
  if (libraries.length === 0 || libraries.some((library) => !library.enabled)) {
    const enabled = await syncAndEnableLibraries(client);
    if (enabled.length > 0) {
      changes.push(`enabled libraries ${enabled.map((library) => library.name).join(', ')}`);
      try {
        await client.startLibraryScan();
      } catch (error) {
        notes.push(`the initial library scan was not started: ${errorMessage(error)}`);
      }
    }
  }

  for (const kind of ARR_KINDS) {
    progress(`Checking the ${ARR_INSTANCE_NAMES[kind]} server`);
    const change = await ensureArrInstance(options, kind, notes);
    if (change) {
      changes.push(change);
    }
  }

  if (!publicSettings.initialized) {
    progress('Finishing the initialization');
    await client.initialize();
    changes.push('marked Seerr as initialized');
  }

  const detail = [changes.join(', '), ...notes].filter(Boolean).join('; ');
  return {
    status: changes.length > 0 ? 'changed' : 'unchanged',
    ...(detail ? { detail } : {}),
  };
}

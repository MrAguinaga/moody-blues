import { HttpStatusError } from '../http/http.errors';
import { LIBRARY_MARKERS_CREATED_FLAG, ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import type { ProvisionContext, StepOutcome } from '../pipeline/pipeline.types';
import { ensureJellyfinAccess, isRejectedCredential, RESET_HINT } from './jellyfin.access';
import type { JellyfinClient, JellyfinReadyOptions } from './jellyfin.client';
import { ADMIN_USERNAME_PATTERN, JELLYFIN_LIBRARIES } from './jellyfin.constants';
import {
  buildLibraryOptions,
  correctLibraryOptions,
  desiredEncodingSettings,
  desiredServerSettings,
  driftedKeys,
  type MetadataLocale,
  parseMetadataLocale,
} from './jellyfin.settings';
import type { LibraryChange, LibrarySpec, VirtualFolder } from './jellyfin.types';

export interface ProvisionJellyfinOptions {
  client: JellyfinClient;
  signal: AbortSignal;
  ready?: JellyfinReadyOptions;
}

const normalizeName = (name: string): string => name.trim();

function validateAdminUsername(username: string): void {
  if (!ADMIN_USERNAME_PATTERN.test(username)) {
    throw new Error(
      'ADMIN_USERNAME is not a valid Jellyfin user name: use letters, digits, spaces and ' +
        "- ' . _ @ + only, with no leading or trailing space",
    );
  }
}

async function completeWizard(
  client: JellyfinClient,
  credentials: { username: string; password: string },
): Promise<void> {
  await client.getFirstUser();
  try {
    await client.setFirstUser(credentials.username, credentials.password);
  } catch (error) {
    if (!(error instanceof HttpStatusError && error.status === 403)) {
      throw error;
    }
    try {
      await client.authenticate(credentials);
    } catch (loginError) {
      if (isRejectedCredential(loginError)) {
        throw new Error(
          `The Jellyfin setup wizard was left half-finished with other credentials. ${RESET_HINT}`,
        );
      }
      throw loginError;
    }
  }
  await client.completeStartup();
}

async function rotateAdminPassword(
  client: JellyfinClient,
  credentials: { username: string; password: string },
): Promise<void> {
  const admin = await client.findUserByName(credentials.username);
  if (!admin) {
    throw new Error(
      'Jellyfin has no administrator with the configured ADMIN_USERNAME; renaming the ' +
        `administrator is not supported. ${RESET_HINT}`,
    );
  }
  await client.setPassword(admin.Id, credentials.password);
}

async function ensureLibrary(
  client: JellyfinClient,
  existing: readonly VirtualFolder[],
  spec: LibrarySpec,
  locale: MetadataLocale,
): Promise<LibraryChange> {
  const found = existing.find((folder) => normalizeName(folder.Name) === normalizeName(spec.name));
  if (!found) {
    await client.createLibrary(spec, buildLibraryOptions(spec, locale));
    return { result: 'created', name: spec.name };
  }
  const note = found.Locations.includes(spec.path)
    ? undefined
    : `library "${spec.name}" does not include ${spec.path} (found ${found.Locations.join(', ') || 'no paths'})`;
  const correction = correctLibraryOptions(found.LibraryOptions, spec, locale);
  if (!correction) {
    return { result: 'unchanged', name: spec.name, ...(note ? { note } : {}) };
  }
  await client.updateLibraryOptions(found.ItemId, correction.options);
  return {
    result: 'updated',
    name: spec.name,
    drifted: correction.drifted,
    ...(note ? { note } : {}),
  };
}

export async function provisionJellyfin(
  ctx: ProvisionContext,
  options: ProvisionJellyfinOptions,
): Promise<StepOutcome> {
  const { client, signal } = options;
  const { config, secrets } = ctx;
  const credentials = { username: secrets.adminUsername, password: secrets.adminPassword };
  const changes: string[] = [];
  const notes: string[] = [];
  const progress = (message: string) => ctx.reportProgress?.(message);

  validateAdminUsername(credentials.username);
  const locale = parseMetadataLocale(config.languages.ui);

  progress('Waiting for Jellyfin');
  await client.waitReady({ signal, ...options.ready });
  const info = await client.getPublicInfo();

  const wizardWasOpen = !info.StartupWizardCompleted;
  if (wizardWasOpen) {
    progress('Completing the setup wizard');
    await completeWizard(client, credentials);
    changes.push('completed the setup wizard');
  }

  progress('Checking the API key');
  const access = await ensureJellyfinAccess(ctx, client);
  if (access.created) {
    changes.push('created the API key');
  }
  if (access.persisted) {
    changes.push('stored the API key in the environment file');
  }
  notes.push(...access.warnings);

  if (!wizardWasOpen && ctx.flags.get(ROTATE_CREDENTIALS_FLAG) === true) {
    progress('Rotating the administrator password');
    await rotateAdminPassword(client, credentials);
    changes.push('rotated the administrator password');
  }

  progress('Checking server settings');
  const serverConfig = await client.getServerConfiguration();
  const serverDrift = driftedKeys(serverConfig, desiredServerSettings(config.languages.ui, locale));
  if (serverDrift.length > 0) {
    await client.saveServerConfiguration({
      ...serverConfig,
      ...desiredServerSettings(config.languages.ui, locale),
    });
    changes.push(`server settings ${serverDrift.join(', ')}`);
  }

  progress('Checking disk safeguards');
  const encoding = await client.getNamedConfiguration('encoding');
  const encodingDrift = driftedKeys(encoding, desiredEncodingSettings());
  if (encodingDrift.length > 0) {
    await client.saveNamedConfiguration('encoding', { ...encoding, ...desiredEncodingSettings() });
    changes.push(`encoding safeguards ${encodingDrift.join(', ')}`);
  }

  progress('Checking libraries');
  const folders = await client.listLibraries();
  let createdLibraries = 0;
  for (const spec of JELLYFIN_LIBRARIES) {
    const change = await ensureLibrary(client, folders, spec, locale);
    if (change.result === 'created') {
      createdLibraries += 1;
    }
    if (change.result !== 'unchanged') {
      changes.push(
        `${change.result} library ${change.name}${change.drifted ? ` (${change.drifted.join(', ')})` : ''}`,
      );
    }
    if (change.note) {
      notes.push(change.note);
    }
  }

  // A library that was never scanned is invisible to the real-time monitor and to the
  // Library/Media/Updated notices of Sonarr and Radarr, so the first scan starts it. Jellyfin
  // also skips empty folders, so a scan is needed again when the host step just placed the
  // marker file in a folder of a library that already existed.
  if (createdLibraries > 0 || ctx.flags.get(LIBRARY_MARKERS_CREATED_FLAG) === true) {
    progress('Starting the first library scan');
    await client.refreshLibrary();
    changes.push('started the first library scan');
  }

  progress('Verifying the published URL');
  const expectedUrl = `https://watch.${config.domain}`;
  const published = (await client.getPublicInfo()).LocalAddress;
  if (!published?.startsWith(expectedUrl)) {
    notes.push(`published URL is ${published ?? 'unset'}, expected ${expectedUrl}`);
  }

  const detail = [changes.join(', '), ...notes].filter(Boolean).join('; ');
  return {
    status: changes.length > 0 ? 'changed' : 'unchanged',
    ...(detail ? { detail } : {}),
  };
}

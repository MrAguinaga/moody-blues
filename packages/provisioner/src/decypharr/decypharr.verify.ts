import { readdir } from 'node:fs/promises';

import type { ArrClient } from '../arr/arr.client';
import { DECYPHARR_CLIENT_NAME } from '../arr/arr.settings';
import type { ArrKind, DownloadClientResource } from '../arr/arr.types';
import { HttpAbortError, HttpStatusError, PollTimeoutError } from '../http/http.errors';
import type { Sleep } from '../http/http.types';
import { pollUntil } from '../http/ready.http';
import type { ProvisionContext } from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import type { DecypharrReadyOptions } from './decypharr.client';
import { type DecypharrClient, DecypharrConfigInvalidError } from './decypharr.client';
import { evaluateInvariants } from './decypharr.invariants';
import type {
  DecypharrArr,
  ExpectedSettings,
  LinkApp,
  LinkCheck,
  MountCheck,
  VerificationReport,
} from './decypharr.types';

export const MOUNT_TIMEOUT_MS = 60_000;
export const MOUNT_INTERVAL_MS = 2_000;
export const MOUNT_ALL_FOLDER = '__all__';
export const WEBDAV_MULTISTATUS = 207;
export const RESET_HINT = 'Run "moody-blues reset --fresh" to reseed the Decypharr configuration';

const LINK_APPS: readonly LinkApp[] = ['sonarr', 'radarr'];
const CATEGORY_FIELDS: Record<ArrKind, string> = { sonarr: 'tvCategory', radarr: 'movieCategory' };

export interface MountWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: Sleep;
  now?: () => number;
  readDir?: (directory: string) => Promise<string[]>;
}

export interface VerifyDecypharrOptions {
  decypharr: DecypharrClient;
  arrs: Record<LinkApp, ArrClient>;
  serviceKeys: { decypharr: string; sonarr: string; radarr: string };
  signal: AbortSignal;
  ready?: DecypharrReadyOptions;
  mount?: MountWaitOptions;
}

export class DecypharrDriftError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`Decypharr verification failed:\n${failures.map((line) => `- ${line}`).join('\n')}`);
    this.name = 'DecypharrDriftError';
  }
}

function scrub(message: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret !== '')
    .reduce((current, secret) => current.split(secret).join('***'), message);
}

function categoryOf(client: DownloadClientResource | undefined, app: ArrKind): string | undefined {
  const value = client?.fields.find((field) => field.name === CATEGORY_FIELDS[app])?.value;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function checkRegistration(
  app: LinkApp,
  entry: DecypharrArr | undefined,
  apiKey: string,
): string[] {
  if (!entry) {
    return [`GET /api/arrs does not list "${app}"`];
  }
  const issues: string[] = [];
  const host = SERVICE_CATALOG[app].internalUrl;
  if (entry.host !== host) {
    issues.push(`arrs[${app}].host expected "${host}", observed "${entry.host}"`);
  }
  if (entry.source !== 'config') {
    issues.push(`arrs[${app}].source expected "config", observed "${entry.source ?? 'absent'}"`);
  }
  if (entry.token !== apiKey) {
    issues.push(`arrs[${app}].token does not match the ${app} API key`);
  }
  return issues;
}

async function checkLink(
  app: LinkApp,
  client: DownloadClientResource | undefined,
  arr: ArrClient,
  entry: DecypharrArr | undefined,
  secrets: readonly string[],
  apiKey: string,
): Promise<LinkCheck> {
  const registration = checkRegistration(app, entry, apiKey);
  const issues = [...registration];
  const check: LinkCheck = {
    app,
    knownByDecypharr: registration.length === 0,
    clientLoginOk: false,
    removeCompleted: false,
    removeFailedDisabled: false,
    issues,
  };
  if (!client) {
    issues.push(`${app} has no download client named "${DECYPHARR_CLIENT_NAME}"`);
    return check;
  }
  check.removeCompleted = client.removeCompletedDownloads === true;
  check.removeFailedDisabled = client.removeFailedDownloads === false;
  if (!check.removeCompleted) {
    issues.push(`${app} client removeCompletedDownloads expected true, observed false`);
  }
  if (!check.removeFailedDisabled) {
    issues.push(`${app} client removeFailedDownloads expected false, observed true`);
  }
  try {
    await arr.testDownloadClient(client);
    check.clientLoginOk = true;
  } catch (error) {
    if (!(error instanceof HttpStatusError)) {
      throw error;
    }
    issues.push(`${app} client test failed: ${scrub(error.message, secrets)}`);
  }
  return check;
}

async function checkMount(
  decypharr: DecypharrClient,
  directory: string,
  signal: AbortSignal,
  options: MountWaitOptions = {},
): Promise<MountCheck> {
  let webdavStatus: number;
  try {
    webdavStatus = await decypharr.propfindWebdav();
  } catch (error) {
    if (!(error instanceof HttpStatusError)) {
      throw error;
    }
    webdavStatus = error.status;
  }
  const readDir = options.readDir ?? ((target: string) => readdir(target));
  let allFolderVisible = true;
  try {
    await pollUntil(
      async () => {
        const entries = await readDir(directory).catch((): string[] => []);
        return entries.includes(MOUNT_ALL_FOLDER) ? true : undefined;
      },
      {
        timeoutMs: options.timeoutMs ?? MOUNT_TIMEOUT_MS,
        intervalMs: options.intervalMs ?? MOUNT_INTERVAL_MS,
        signal,
        sleep: options.sleep,
        now: options.now,
      },
    );
  } catch (error) {
    if (!(error instanceof PollTimeoutError)) {
      throw error;
    }
    allFolderVisible = false;
  }
  return { webdavStatus, allFolderVisible };
}

export function describeFailures(report: VerificationReport, mountDir: string): string[] {
  const failures: string[] = [];
  for (const check of report.invariants.filter(({ status }) => status === 'drift')) {
    const origin = check.adr ? ` (${check.adr})` : '';
    failures.push(
      `invariant ${check.id}${origin}: expected ${check.expected}, observed ${check.actual}`,
    );
  }
  for (const link of report.links) {
    failures.push(...link.issues);
    if (!link.clientLoginOk && link.issues.length === 0) {
      failures.push(`${link.app} download client login failed`);
    }
  }
  if (failures.length > 0) {
    failures.push(`${RESET_HINT} if the configuration was edited by hand`);
  }
  if (report.mount.webdavStatus !== WEBDAV_MULTISTATUS) {
    failures.push(
      `PROPFIND /webdav/ expected status ${WEBDAV_MULTISTATUS}, observed ${report.mount.webdavStatus}`,
    );
  }
  if (!report.mount.allFolderVisible) {
    failures.push(
      `folder ${MOUNT_ALL_FOLDER} did not appear in ${mountDir} within ${MOUNT_TIMEOUT_MS / 1000} s; ` +
        'check the mount propagation (findmnt -no PROPAGATION), the /dev/fuse permissions and ' +
        'config/decypharr/logs/rclone.log',
    );
  }
  return failures;
}

export async function verifyDecypharr(
  ctx: ProvisionContext,
  options: VerifyDecypharrOptions,
): Promise<VerificationReport> {
  const { decypharr, arrs, serviceKeys, signal } = options;
  const secrets = [
    serviceKeys.decypharr,
    serviceKeys.sonarr,
    serviceKeys.radarr,
    ctx.secrets.rdApiToken,
  ];
  const progress = (message: string) => ctx.reportProgress?.(message);

  progress('Waiting for Decypharr');
  await decypharr.waitReady({ signal, ...options.ready });
  const { version } = await decypharr.getVersion();
  await decypharr.getQbitVersion();

  progress('Reading the effective configuration');
  const view = await decypharr.getConfig();

  progress('Checking the Sonarr and Radarr links');
  const registered = await decypharr.listArrs();
  const clients = new Map<LinkApp, DownloadClientResource | undefined>();
  for (const app of LINK_APPS) {
    const list = await arrs[app].listDownloadClients();
    clients.set(
      app,
      list.find((client) => client.name === DECYPHARR_CLIENT_NAME),
    );
  }
  const links: LinkCheck[] = [];
  for (const app of LINK_APPS) {
    links.push(
      await checkLink(
        app,
        clients.get(app),
        arrs[app],
        registered.find((entry) => entry.name === app),
        secrets,
        serviceKeys[app],
      ),
    );
  }

  const expected: ExpectedSettings = {
    downloadUncached: ctx.config.storage.downloadUncached,
    clientCategories: {
      sonarr: categoryOf(clients.get('sonarr'), 'sonarr'),
      radarr: categoryOf(clients.get('radarr'), 'radarr'),
    },
  };
  const invariants = evaluateInvariants(view, expected);

  progress('Checking the WebDAV and the debrid mount');
  const mount = await checkMount(decypharr, ctx.layout.debridMountDir, signal, options.mount);

  progress('Reading the repair health');
  let brokenEntries = 0;
  let repairHealthNote: string | undefined;
  try {
    brokenEntries = (await decypharr.listBrokenEntries()).length;
  } catch (error) {
    if (error instanceof HttpAbortError || error instanceof DecypharrConfigInvalidError) {
      throw error;
    }
    repairHealthNote = `repair health unavailable: ${scrub(
      error instanceof Error ? error.message : String(error),
      secrets,
    )}`;
  }

  const ok =
    invariants.every(({ status }) => status === 'ok') &&
    links.every(
      (link) =>
        link.issues.length === 0 &&
        link.knownByDecypharr &&
        link.clientLoginOk &&
        link.removeCompleted &&
        link.removeFailedDisabled,
    ) &&
    mount.webdavStatus === WEBDAV_MULTISTATUS &&
    mount.allFolderVisible;
  return { version, invariants, links, mount, brokenEntries, repairHealthNote, ok };
}

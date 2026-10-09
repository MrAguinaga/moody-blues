import { join } from 'node:path';

import {
  DecypharrConfigInvalidError,
  describeFailures,
  loadServiceKeys,
  MOUNT_ALL_FOLDER,
  ServiceNotReadyError,
  type VerificationReport,
  verifyDecypharr,
  WEBDAV_MULTISTATUS,
} from '@moody-blues/provisioner';

import { MOUNT_READ_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '../doctor.constants';
import type { DoctorCheck, DoctorContext, DoctorOutcome } from '../doctor.types';
import {
  errorText,
  isRejectedKey,
  logsSuggestion,
  skipped,
  STORAGE_DISABLED_MESSAGE,
  storageDisabled,
} from './check-gate.utils';

const VERIFICATION_KEY = 'decypharr-verification';
const CONFIG_UNAVAILABLE_MESSAGE = 'The Decypharr configuration check could not run';

export interface DecypharrVerification {
  report?: VerificationReport;
  failure?: unknown;
  mountListFailure?: string;
}

export function describeFsError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message = errorText(error);
  return code && !message.includes(code) ? `${code} (${message})` : message;
}

export function readDecypharrVerification(ctx: DoctorContext): Promise<DecypharrVerification> {
  return ctx.memo(VERIFICATION_KEY, async () => {
    const keys = loadServiceKeys(ctx.provision.layout);
    const outcome: DecypharrVerification = {};
    try {
      outcome.report = await verifyDecypharr(ctx.provision, {
        decypharr: ctx.clients.decypharr,
        arrs: { sonarr: ctx.clients.sonarr, radarr: ctx.clients.radarr },
        serviceKeys: {
          decypharr: keys.decypharrApiToken,
          sonarr: keys.sonarrApiKey,
          radarr: keys.radarrApiKey,
        },
        signal: ctx.signal,
        ready: { timeoutMs: REQUEST_TIMEOUT_MS },
        mount: {
          timeoutMs: MOUNT_READ_TIMEOUT_MS,
          readDir: async (directory) => {
            try {
              return await ctx.readDirectory(directory, MOUNT_READ_TIMEOUT_MS);
            } catch (error) {
              outcome.mountListFailure = describeFsError(error);
              throw error;
            }
          },
        },
      });
    } catch (failure) {
      outcome.failure = failure;
    }
    return outcome;
  });
}

function sectionFailures(
  report: VerificationReport,
  section: 'invariants' | 'links',
  mountDirectory: string,
): string[] {
  return describeFailures(
    {
      ...report,
      invariants: section === 'invariants' ? report.invariants : [],
      links: section === 'links' ? report.links : [],
      mount: { webdavStatus: WEBDAV_MULTISTATUS, allFolderVisible: true },
    },
    mountDirectory,
  );
}

function verificationFailure(failure: unknown): DoctorOutcome {
  if (failure instanceof DecypharrConfigInvalidError) {
    return {
      status: 'error',
      message: 'Decypharr is waiting in its setup wizard, so its seeded configuration is invalid',
      details: [errorText(failure)],
      suggestion:
        'Review config/decypharr/config.json in the Moody Blues home; "moody-blues reset --fresh" reseeds it (it deletes the managed data).',
    };
  }
  if (failure instanceof ServiceNotReadyError) {
    return {
      status: 'error',
      message: 'Decypharr did not answer',
      details: [errorText(failure)],
      suggestion: logsSuggestion('decypharr'),
    };
  }
  if (isRejectedKey(failure)) {
    return {
      status: 'error',
      message: 'Decypharr rejected the API token',
      details: [errorText(failure)],
      suggestion:
        'The DECYPHARR_API_TOKEN in the Moody Blues .env does not match the one Decypharr uses.',
    };
  }
  return {
    status: 'error',
    message: 'Decypharr could not be verified',
    details: [errorText(failure)],
    suggestion: logsSuggestion('decypharr'),
  };
}

export const decypharrConfigCheck: DoctorCheck = {
  id: 'decypharr-config',
  name: 'Decypharr configuration',
  run: async (ctx) => {
    if (storageDisabled(ctx)) {
      return skipped(STORAGE_DISABLED_MESSAGE);
    }
    const { report, failure } = await readDecypharrVerification(ctx);
    if (!report) {
      return verificationFailure(failure);
    }
    const drifted = report.invariants.filter(({ status }) => status === 'drift');
    if (drifted.length > 0) {
      return {
        status: 'error',
        message: `${drifted.length} of ${report.invariants.length} Decypharr invariants drifted`,
        details: sectionFailures(report, 'invariants', ctx.provision.layout.debridMountDir),
        suggestion:
          'Restore the setting in the Decypharr configuration; "moody-blues reset --fresh" reseeds it (it deletes the managed data).',
      };
    }
    return {
      status: 'ok',
      message: `${report.invariants.length} invariants hold, Decypharr ${report.version}`,
    };
  },
};

export const decypharrLinkCheck: DoctorCheck = {
  id: 'decypharr-link',
  name: 'Decypharr link',
  run: async (ctx) => {
    if (storageDisabled(ctx)) {
      return skipped(STORAGE_DISABLED_MESSAGE);
    }
    const { report } = await readDecypharrVerification(ctx);
    if (!report) {
      return skipped(CONFIG_UNAVAILABLE_MESSAGE);
    }
    const healthy = report.links.every(
      (link) => link.knownByDecypharr && link.clientLoginOk && link.issues.length === 0,
    );
    if (!healthy) {
      return {
        status: 'error',
        message: 'Sonarr and Radarr are not correctly linked to Decypharr',
        details: sectionFailures(report, 'links', ctx.provision.layout.debridMountDir),
        suggestion:
          'Run "moody-blues setup" again to restore the Decypharr download client in Sonarr and Radarr.',
      };
    }
    return {
      status: 'ok',
      message: 'Sonarr and Radarr are registered in Decypharr and their download clients sign in',
    };
  },
};

export const debridMountCheck: DoctorCheck = {
  id: 'debrid-mount',
  name: 'Debrid mount',
  run: async (ctx) => {
    if (storageDisabled(ctx)) {
      return skipped(STORAGE_DISABLED_MESSAGE);
    }
    const { report, mountListFailure } = await readDecypharrVerification(ctx);
    if (!report) {
      return skipped(CONFIG_UNAVAILABLE_MESSAGE);
    }

    const mountDirectory = ctx.provision.layout.debridMountDir;
    const problems: string[] = [];
    if (report.mount.webdavStatus !== WEBDAV_MULTISTATUS) {
      problems.push(
        `PROPFIND /webdav/ answered ${report.mount.webdavStatus}, expected ${WEBDAV_MULTISTATUS}`,
      );
    }
    if (!report.mount.allFolderVisible) {
      problems.push(
        mountListFailure
          ? `Reading ${mountDirectory} failed: ${mountListFailure}`
          : `Folder ${MOUNT_ALL_FOLDER} is not visible in ${mountDirectory}`,
      );
    } else {
      try {
        await ctx.readDirectory(join(mountDirectory, MOUNT_ALL_FOLDER), MOUNT_READ_TIMEOUT_MS);
      } catch (error) {
        problems.push(`Reading ${MOUNT_ALL_FOLDER} failed: ${describeFsError(error)}`);
      }
    }

    if (problems.length > 0) {
      const dead = problems.some((problem) => problem.includes('ENOTCONN'));
      return {
        status: 'error',
        message: 'The debrid mount is not healthy',
        details: problems,
        suggestion: dead
          ? `The FUSE mount is dead: release it with "sudo umount -l ${mountDirectory}" and restart Decypharr with "docker compose -p moody-blues restart decypharr".`
          : 'Check the mount propagation (findmnt -no PROPAGATION), the /dev/fuse permissions, "moody-blues logs decypharr" and config/decypharr/logs/rclone.log.',
      };
    }

    const warnings = [
      ...(report.brokenEntries > 0
        ? [`${report.brokenEntries} broken repair entries await the automatic repair`]
        : []),
      ...(report.repairHealthNote ? [report.repairHealthNote] : []),
    ];
    if (warnings.length > 0) {
      return {
        status: 'warning',
        message: 'The debrid mount works, but the repair health needs attention',
        details: warnings,
        suggestion:
          'Decypharr repairs broken entries on its own schedule; inspect them in its Repair page.',
      };
    }
    return {
      status: 'ok',
      message: `WebDAV answers ${WEBDAV_MULTISTATUS}, ${MOUNT_ALL_FOLDER} is readable, no broken repair entries`,
    };
  },
};

import { type ArrClientOptions, createArrClient } from '../arr/arr.client';
import type { ArrKind } from '../arr/arr.types';
import { ROTATE_CREDENTIALS_FLAG } from '../pipeline/pipeline.flags';
import type {
  ProvisionContext,
  ProvisionScope,
  ProvisionStep,
  StepOutcome,
} from '../pipeline/pipeline.types';
import { SERVICE_CATALOG } from '../services/service-catalog';
import { loadServiceKeys } from '../services/service-keys';
import { createDecypharrClient, type DecypharrClientOptions } from './decypharr.client';
import type { VerificationReport } from './decypharr.types';
import {
  DecypharrDriftError,
  describeFailures,
  MOUNT_ALL_FOLDER,
  verifyDecypharr,
  type VerifyDecypharrOptions,
} from './decypharr.verify';

const VERIFY_STEP_SCOPES: readonly ProvisionScope[] = ['setup', 'reset', 'config', 'update'];
const ARR_KINDS: readonly ArrKind[] = ['sonarr', 'radarr'];

type TransportOverrides<T> = Pick<T, Extract<keyof T, 'fetch' | 'sleep' | 'random' | 'retry'>>;

export interface DecypharrStepOverrides extends Pick<VerifyDecypharrOptions, 'ready' | 'mount'> {
  decypharr?: TransportOverrides<DecypharrClientOptions>;
  arr?: Partial<Record<ArrKind, TransportOverrides<ArrClientOptions>>>;
}

function describeReport(report: VerificationReport): string {
  const { brokenEntries } = report;
  const broken = `${brokenEntries} broken repair ${brokenEntries === 1 ? 'entry' : 'entries'}`;
  return [
    `Decypharr ${report.version}`,
    `${report.invariants.length} invariants ok`,
    'Sonarr and Radarr linked',
    `WebDAV ${report.mount.webdavStatus}`,
    `${MOUNT_ALL_FOLDER} visible`,
    brokenEntries > 0 ? `warning: ${broken} awaiting automatic repair` : broken,
    ...(report.repairHealthNote ? [`warning: ${report.repairHealthNote}`] : []),
  ].join(', ');
}

export function createDecypharrVerifyStep(overrides: DecypharrStepOverrides = {}): ProvisionStep {
  return {
    id: 'decypharr-verify',
    title: 'Verify Decypharr',
    scopes: VERIFY_STEP_SCOPES,
    run: async (ctx: ProvisionContext, signal: AbortSignal): Promise<StepOutcome> => {
      if (!ctx.config.storage.enabled) {
        return {
          status: 'skipped',
          detail: 'storage.enabled is false, so Decypharr is not deployed',
        };
      }
      const keys = loadServiceKeys(ctx.layout);
      const serviceKeys = {
        decypharr: keys.decypharrApiToken,
        sonarr: keys.sonarrApiKey,
        radarr: keys.radarrApiKey,
      };
      const arrs = Object.fromEntries(
        ARR_KINDS.map((kind) => [
          kind,
          createArrClient({
            kind,
            baseUrl: SERVICE_CATALOG[kind].hostUrl,
            apiKey: serviceKeys[kind],
            signal,
            ...overrides.arr?.[kind],
          }),
        ]),
      ) as VerifyDecypharrOptions['arrs'];
      const decypharr = createDecypharrClient({
        baseUrl: SERVICE_CATALOG.decypharr.hostUrl,
        apiToken: serviceKeys.decypharr,
        signal,
        ...overrides.decypharr,
      });
      const rotate = ctx.flags.get(ROTATE_CREDENTIALS_FLAG) === true;
      if (rotate) {
        ctx.reportProgress?.('Waiting for Decypharr');
        await decypharr.waitReady({ signal, ...overrides.ready });
        ctx.reportProgress?.('Rotating the Decypharr administrator');
        await decypharr.updateAuth({
          username: ctx.secrets.adminUsername,
          password: ctx.secrets.adminPassword,
        });
      }
      const report = await verifyDecypharr(ctx, {
        decypharr,
        arrs,
        serviceKeys,
        signal,
        ready: overrides.ready,
        mount: overrides.mount,
      });
      if (!report.ok) {
        throw new DecypharrDriftError(describeFailures(report, ctx.layout.debridMountDir));
      }
      return {
        status: rotate ? 'changed' : 'unchanged',
        detail: rotate ? 'administrator credentials' : describeReport(report),
      };
    },
  };
}

export const decypharrVerifyStep: ProvisionStep = createDecypharrVerifyStep();

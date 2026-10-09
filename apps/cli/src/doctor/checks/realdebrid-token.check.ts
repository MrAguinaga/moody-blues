import type { DoctorCheck } from '../doctor.types';
import { readDecypharrLog, scanAuthRejections, scanOptionsFor } from '../doctor-log.utils';
import { skipped, STORAGE_DISABLED_MESSAGE, storageDisabled } from './check-gate.utils';
import { readDecypharrVerification } from './decypharr.check';

export const realDebridTokenCheck: DoctorCheck = {
  id: 'realdebrid-token',
  name: 'Real-Debrid token',
  run: async (ctx) => {
    if (storageDisabled(ctx)) {
      return skipped(STORAGE_DISABLED_MESSAGE);
    }
    const { report } = await readDecypharrVerification(ctx);
    if (!report) {
      return {
        status: 'warning',
        message: 'The token cannot be assessed because Decypharr could not be verified',
        suggestion: 'Resolve the Decypharr configuration check first.',
      };
    }

    const log = await readDecypharrLog(ctx);
    if (!log.readable) {
      return {
        status: 'warning',
        message: 'The Decypharr log could not be read, so nothing can be said about the token',
        details: [`${ctx.decypharrLogPath}: ${log.reason}`],
      };
    }

    const { count, lastAt } = scanAuthRejections(log.text, scanOptionsFor(ctx, log));
    if (count > 0) {
      return {
        status: 'error',
        message: 'Real-Debrid rejected the token',
        details: [
          `${count} recent log line${count === 1 ? '' : 's'} report an authentication rejection${lastAt ? `, the last one at ${lastAt}` : ''}`,
        ],
        suggestion:
          'Review RD_API_TOKEN in the Moody Blues .env, then run "moody-blues setup" again.',
      };
    }
    return {
      status: 'ok',
      message: 'Indirect check: no authentication errors in the Decypharr log',
    };
  },
};

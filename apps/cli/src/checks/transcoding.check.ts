import { type TranscodingMode, VAAPI_DEVICE_PATH } from '@moody-blues/provisioner';

import { detectHardwareAccel, type HardwareAccel } from '../docker';
import type { CheckContext, CheckDefinition, CheckResult } from './checks.types';

const DEFINITION = {
  id: 'transcoding',
  name: 'Transcoding',
  description: 'Checks the transcoding mode against the GPU detected on this host',
} as const;

export interface TranscodingCheckInput {
  mode?: TranscodingMode;
  hardware?: HardwareAccel;
}

const GPU_LABELS: Record<HardwareAccel['kind'], string> = {
  vaapi: `VAAPI (${VAAPI_DEVICE_PATH})`,
  nvidia: 'NVIDIA (nvidia-smi)',
};

const describeDetection = (hardware?: HardwareAccel): string =>
  hardware
    ? `GPU detected: ${GPU_LABELS[hardware.kind]}`
    : `No GPU detected (${VAAPI_DEVICE_PATH} or nvidia-smi)`;

export function evaluateTranscoding({ mode, hardware }: TranscodingCheckInput): CheckResult {
  const detection = describeDetection(hardware);

  if (mode === 'hardware') {
    return hardware
      ? {
          ...DEFINITION,
          status: 'success',
          message: `Hardware transcoding is available. ${detection}`,
        }
      : {
          ...DEFINITION,
          status: 'error',
          message: `Hardware transcoding is selected but no GPU was found (${VAAPI_DEVICE_PATH} or nvidia-smi)`,
          suggestion: 'Choose "cpu" or "off", or install the GPU drivers.',
        };
  }

  if (mode === 'cpu') {
    return hardware
      ? {
          ...DEFINITION,
          status: 'success',
          message: `Video is transcoded on the CPU. ${detection}`,
          suggestion: 'Choose "hardware" to offload transcoding to the GPU.',
        }
      : {
          ...DEFINITION,
          status: 'warning',
          message: 'CPU transcoding is selected and no GPU was found; the CPU may saturate',
          suggestion: 'Choose "off" to never re-encode video, or run on a host with a GPU.',
        };
  }

  const prefix =
    mode === 'off'
      ? 'Video is never re-encoded by policy; remux and audio transcoding are allowed. '
      : '';
  return { ...DEFINITION, status: 'success', message: `${prefix}${detection}` };
}

export const transcodingCheck: CheckDefinition = {
  ...DEFINITION,
  run: async (context: CheckContext = {}): Promise<CheckResult> =>
    evaluateTranscoding({ mode: context.transcoding, hardware: detectHardwareAccel() }),
};

import { readFileSync } from 'node:fs';

import { parseConfig } from '../config/config.schema';
import type { MoodyBluesConfig } from '../config/config.types';
import type { OwnershipOptions } from '../home/host-identity.utils';
import { writePrivateFileAtomic } from './atomic-write.utils';

function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export function readState(stateFile: string): MoodyBluesConfig | undefined {
  const text = readTextIfExists(stateFile);
  if (text === undefined) {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`State file ${stateFile} is not valid JSON`);
  }

  const result = parseConfig(json);
  if (!result.ok) {
    throw new Error(`State file ${stateFile} is invalid:\n- ${result.error.join('\n- ')}`);
  }
  return result.value;
}

export function writeState(
  stateFile: string,
  config: MoodyBluesConfig,
  ownership: OwnershipOptions = {},
): void {
  const result = parseConfig(config);
  if (!result.ok) {
    throw new Error(`Refusing to write an invalid state:\n- ${result.error.join('\n- ')}`);
  }
  writePrivateFileAtomic(stateFile, `${JSON.stringify(result.value, null, 2)}\n`, ownership);
}

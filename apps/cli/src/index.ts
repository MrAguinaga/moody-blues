import { createProvisioner } from '@moody-blues/provisioner';

import pkg from '../package.json' with { type: 'json' };

export const CLI_VERSION: string = pkg.version;

export function main() {
  const provisioner = createProvisioner({
    domain: 'localhost',
    isLocalhost: true,
  });

  console.log(`Moody Blues CLI v${CLI_VERSION}`);
  console.log(`Loaded Provisioner v${provisioner.version}`);
}

// Allow direct execution
main();
